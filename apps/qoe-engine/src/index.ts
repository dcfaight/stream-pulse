import {
  assessRecommendationEffectivenessForSession,
  createIncident,
  findRecentOpenIncidentForSession,
  insertIncidentTimelineEntry,
  insertQoeSegment,
  listMetricEventsSince,
  listScorableSessions,
  updateIncident,
} from '@stream-pulse/db';
import type { Severity } from '@stream-pulse/types';

const POLL_INTERVAL_MS = Number(process.env.QOE_POLL_INTERVAL_MS ?? 5000);
const MAX_EVENTS_PER_PASS = Number(process.env.QOE_MAX_EVENTS_PER_PASS ?? 500);
const INCIDENT_GROUP_WINDOW_MINUTES = Number(process.env.INCIDENT_GROUP_WINDOW_MINUTES ?? 10);

interface MetricAggregate {
  sum: number;
  count: number;
}

interface AnomalySignal {
  metricType: string;
  value: number;
  threshold: number;
  severity: Severity;
  reason: string;
}

interface IncidentSummary {
  oneLineSummary: string;
  rootCauseSummary: string;
  supportingSignalsSummary: string;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function average(map: Map<string, MetricAggregate>, metricType: string): number | undefined {
  const aggregate = map.get(metricType);
  if (!aggregate || aggregate.count === 0) return undefined;
  return aggregate.sum / aggregate.count;
}

function toSeverity(score: number): Severity {
  if (score >= 85) return 'good';
  if (score >= 70) return 'degraded';
  if (score >= 50) return 'poor';
  return 'critical';
}

function severityRank(severity: Severity): number {
  if (severity === 'critical') return 4;
  if (severity === 'poor') return 3;
  if (severity === 'degraded') return 2;
  return 1;
}

function maxSeverity(left: Severity, right: Severity): Severity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function classifyMetricSeverity(
  value: number,
  warnThreshold: number,
  criticalThreshold: number,
): Severity | null {
  if (value >= criticalThreshold) return 'critical';
  if (value >= warnThreshold) return 'poor';
  return null;
}

function classifyMetricSeverityLow(
  value: number,
  warnThreshold: number,
  criticalThreshold: number,
): Severity | null {
  if (value <= criticalThreshold) return 'critical';
  if (value <= warnThreshold) return 'poor';
  return null;
}

function detectAnomalies(segmentSeverity: Severity, signals: Record<string, number>): AnomalySignal[] {
  const anomalies: AnomalySignal[] = [];
  const avgRttMs = signals.avg_rtt_ms;
  const avgPacketLossPct = signals.avg_packet_loss_pct;
  const avgJitterMs = signals.avg_jitter_ms;
  const avgBitrateVideoKbps = signals.avg_bitrate_video_kbps;
  const avgFrameDropsPerSec = signals.avg_frame_drops_per_sec;

  if (typeof avgRttMs === 'number') {
    const severity = classifyMetricSeverity(avgRttMs, 180, 260);
    if (severity) {
      anomalies.push({
        metricType: 'rtt_ms',
        value: avgRttMs,
        threshold: severity === 'critical' ? 260 : 180,
        severity,
        reason: 'Sustained high RTT',
      });
    }
  }
  if (typeof avgPacketLossPct === 'number') {
    const severity = classifyMetricSeverity(avgPacketLossPct, 3, 6);
    if (severity) {
      anomalies.push({
        metricType: 'packet_loss_pct',
        value: avgPacketLossPct,
        threshold: severity === 'critical' ? 6 : 3,
        severity,
        reason: 'Packet loss above threshold',
      });
    }
  }
  if (typeof avgJitterMs === 'number') {
    const severity = classifyMetricSeverity(avgJitterMs, 35, 50);
    if (severity) {
      anomalies.push({
        metricType: 'jitter_ms',
        value: avgJitterMs,
        threshold: severity === 'critical' ? 50 : 35,
        severity,
        reason: 'Elevated jitter',
      });
    }
  }
  if (typeof avgBitrateVideoKbps === 'number') {
    const severity = classifyMetricSeverityLow(avgBitrateVideoKbps, 1200, 900);
    if (severity) {
      anomalies.push({
        metricType: 'bitrate_video_kbps',
        value: avgBitrateVideoKbps,
        threshold: severity === 'critical' ? 900 : 1200,
        severity,
        reason: 'Video bitrate below threshold',
      });
    }
  }
  if (typeof avgFrameDropsPerSec === 'number') {
    const severity = classifyMetricSeverity(avgFrameDropsPerSec, 3, 6);
    if (severity) {
      anomalies.push({
        metricType: 'frame_drops_per_sec',
        value: avgFrameDropsPerSec,
        threshold: severity === 'critical' ? 6 : 3,
        severity,
        reason: 'Frame drops above threshold',
      });
    }
  }
  if (segmentSeverity === 'poor' || segmentSeverity === 'critical') {
    anomalies.push({
      metricType: 'qoe_severity',
      value: signals.score ?? 0,
      threshold: segmentSeverity === 'critical' ? 50 : 70,
      severity: segmentSeverity,
      reason: `QoE segment classified as ${segmentSeverity}`,
    });
  }

  return anomalies;
}

function pickRootCause(
  signals: Record<string, number>,
  anomalies: AnomalySignal[],
): { hypothesis: string; confidence: number } {
  const metricTypes = new Set(anomalies.map((anomaly) => anomaly.metricType));
  const hasNetworkInstability =
    metricTypes.has('packet_loss_pct') && (metricTypes.has('rtt_ms') || metricTypes.has('jitter_ms'));
  const hasBandwidthDegradation =
    metricTypes.has('bitrate_video_kbps') &&
    ((signals.avg_packet_loss_pct ?? 0) >= 2 || (signals.avg_rtt_ms ?? 0) >= 160);
  const hasEncoderIssue =
    metricTypes.has('frame_drops_per_sec') &&
    !metricTypes.has('packet_loss_pct') &&
    !metricTypes.has('rtt_ms');

  if (hasNetworkInstability) return { hypothesis: 'network instability', confidence: 0.84 };
  if (hasBandwidthDegradation) return { hypothesis: 'bandwidth degradation', confidence: 0.78 };
  if (hasEncoderIssue) return { hypothesis: 'encoder/client performance issue', confidence: 0.72 };
  return { hypothesis: 'generalized stream degradation', confidence: 0.62 };
}

function formatSignalsSummary(signals: Record<string, number>): string {
  const candidates = [
    ['avg_rtt_ms', 'RTT', 'ms'],
    ['avg_packet_loss_pct', 'packet loss', '%'],
    ['avg_jitter_ms', 'jitter', 'ms'],
    ['avg_bitrate_video_kbps', 'video bitrate', 'kbps'],
    ['avg_frame_drops_per_sec', 'frame drops', '/s'],
    ['score', 'QoE score', ''],
  ] as const;

  const parts = candidates
    .filter(([key]) => typeof signals[key] === 'number')
    .slice(0, 4)
    .map(([key, label, suffix]) => `${label}=${signals[key]}${suffix}`);

  return parts.length > 0 ? parts.join(', ') : 'limited supporting signals';
}

function buildIncidentSummary(input: {
  qoeSeverity: Severity;
  incidentSeverity: Severity;
  hypothesis: string;
  confidence: number;
  signals: Record<string, number>;
}): IncidentSummary {
  const confidencePct = Math.round(input.confidence * 100);
  const rootCauseSummary = `${input.hypothesis} (${confidencePct}% confidence)`;
  const supportingSignalsSummary = formatSignalsSummary(input.signals);
  const oneLineSummary = `Session degradation detected: incident ${input.incidentSeverity} with QoE ${input.qoeSeverity}; likely ${input.hypothesis}.`;
  return { oneLineSummary, rootCauseSummary, supportingSignalsSummary };
}

async function detectAndPersistIncident(input: {
  sessionId: string;
  startTs: Date;
  endTs: Date;
  qoeSeverity: Severity;
  signals: Record<string, number>;
}): Promise<void> {
  const anomalies = detectAnomalies(input.qoeSeverity, input.signals);
  if (anomalies.length === 0) return;

  const incidentSeverity = anomalies.reduce<Severity>(
    (current, anomaly) => maxSeverity(current, anomaly.severity),
    'good',
  );
  const { hypothesis, confidence } = pickRootCause(input.signals, anomalies);
  const existingIncident = await findRecentOpenIncidentForSession(
    input.sessionId,
    INCIDENT_GROUP_WINDOW_MINUTES,
  );

  if (!existingIncident) {
    const incident = await createIncident({
      sessionId: input.sessionId,
      startedAt: input.startTs,
      severity: incidentSeverity,
      rootCause: hypothesis,
      confidence,
    });
    await insertIncidentTimelineEntry({
      incidentId: incident.id,
      ts: input.endTs,
      eventType: 'incident_opened',
      payload: {
        grouped: false,
        qoeSeverity: input.qoeSeverity,
        incidentSeverity,
        rootCauseHypothesis: hypothesis,
        confidence,
        ...buildIncidentSummary({
          qoeSeverity: input.qoeSeverity,
          incidentSeverity,
          hypothesis,
          confidence,
          signals: input.signals,
        }),
        anomalies,
        signals: input.signals,
      },
    });

    for (const anomaly of anomalies) {
      await insertIncidentTimelineEntry({
        incidentId: incident.id,
        ts: input.endTs,
        eventType: 'anomaly_detected',
        payload: { ...anomaly },
      });
    }
    return;
  }

  const mergedSeverity = maxSeverity(existingIncident.severity as Severity, incidentSeverity);
  const mergedConfidence = Math.max(Number(existingIncident.confidence), confidence);
  const incidentSummary = buildIncidentSummary({
    qoeSeverity: input.qoeSeverity,
    incidentSeverity: mergedSeverity,
    hypothesis,
    confidence: mergedConfidence,
    signals: input.signals,
  });
  await updateIncident({
    incidentId: existingIncident.id,
    updatedAt: input.endTs,
    severity: mergedSeverity,
    rootCause: hypothesis,
    confidence: mergedConfidence,
  });
  await insertIncidentTimelineEntry({
    incidentId: existingIncident.id,
    ts: input.endTs,
    eventType: 'incident_updated',
    payload: {
      grouped: true,
      qoeSeverity: input.qoeSeverity,
      incidentSeverity: mergedSeverity,
      rootCauseHypothesis: hypothesis,
      confidence: mergedConfidence,
      ...incidentSummary,
      anomalies,
      signals: input.signals,
    },
  });

  for (const anomaly of anomalies) {
    await insertIncidentTimelineEntry({
      incidentId: existingIncident.id,
      ts: input.endTs,
      eventType: 'anomaly_detected',
      payload: { ...anomaly },
    });
  }
}

function computeScoreAndSignals(events: Array<{ metric_type: string; value: string }>): {
  score: number;
  severity: Severity;
  signals: Record<string, number>;
} {
  const aggregates = new Map<string, MetricAggregate>();

  for (const event of events) {
    const value = Number(event.value);
    if (Number.isNaN(value)) continue;

    const current = aggregates.get(event.metric_type) ?? { sum: 0, count: 0 };
    current.sum += value;
    current.count += 1;
    aggregates.set(event.metric_type, current);
  }

  const avgRttMs = average(aggregates, 'rtt_ms');
  const avgPacketLossPct = average(aggregates, 'packet_loss_pct');
  const avgJitterMs = average(aggregates, 'jitter_ms');
  const avgBitrateVideoKbps = average(aggregates, 'bitrate_video_kbps');
  const avgFrameDropsPerSec = average(aggregates, 'frame_drops_per_sec');

  let score = 100;
  if (typeof avgRttMs === 'number' && avgRttMs > 100) {
    score -= Math.min(25, (avgRttMs - 100) * 0.2);
  }
  if (typeof avgPacketLossPct === 'number' && avgPacketLossPct > 1) {
    score -= Math.min(35, (avgPacketLossPct - 1) * 8);
  }
  if (typeof avgJitterMs === 'number' && avgJitterMs > 30) {
    score -= Math.min(20, (avgJitterMs - 30) * 0.4);
  }
  if (typeof avgBitrateVideoKbps === 'number' && avgBitrateVideoKbps < 1500) {
    score -= Math.min(25, (1500 - avgBitrateVideoKbps) / 40);
  }
  if (typeof avgFrameDropsPerSec === 'number' && avgFrameDropsPerSec > 2) {
    score -= Math.min(20, (avgFrameDropsPerSec - 2) * 3);
  }

  const boundedScore = round(Math.max(0, Math.min(100, score)));
  const severity = toSeverity(boundedScore);
  const signals: Record<string, number> = {
    event_count: events.length,
    score: boundedScore,
  };

  if (typeof avgRttMs === 'number') signals.avg_rtt_ms = round(avgRttMs);
  if (typeof avgPacketLossPct === 'number') signals.avg_packet_loss_pct = round(avgPacketLossPct);
  if (typeof avgJitterMs === 'number') signals.avg_jitter_ms = round(avgJitterMs);
  if (typeof avgBitrateVideoKbps === 'number')
    signals.avg_bitrate_video_kbps = round(avgBitrateVideoKbps);
  if (typeof avgFrameDropsPerSec === 'number')
    signals.avg_frame_drops_per_sec = round(avgFrameDropsPerSec);

  return { score: boundedScore, severity, signals };
}

async function scoreSessionsOnce(): Promise<void> {
  const sessions = await listScorableSessions(100);

  for (const session of sessions) {
    const events = await listMetricEventsSince(
      session.id,
      session.latest_qoe_end_ts,
      MAX_EVENTS_PER_PASS,
    );

    if (events.length === 0) continue;

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    if (!firstEvent || !lastEvent) continue;

    const { score, severity, signals } = computeScoreAndSignals(events);
    await insertQoeSegment({
      sessionId: session.id,
      startTs: firstEvent.ts,
      endTs: lastEvent.ts,
      score,
      severity,
      signals,
    });
    await detectAndPersistIncident({
      sessionId: session.id,
      startTs: firstEvent.ts,
      endTs: lastEvent.ts,
      qoeSeverity: severity,
      signals,
    });
    await assessRecommendationEffectivenessForSession(session.id);

    console.log(
      `Scored session ${session.id}: score=${score} severity=${severity} events=${events.length}`,
    );
  }
}

let running = false;

async function runLoop(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await scoreSessionsOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown QoE scoring error';
    console.error(`QoE pass failed: ${message}`);
  } finally {
    running = false;
  }
}

console.log(`StreamPulse QoE Engine running with poll interval ${POLL_INTERVAL_MS}ms`);
await runLoop();
setInterval(() => {
  void runLoop();
}, POLL_INTERVAL_MS);

import {
  buildRecommendationDedupeKey,
  createRecommendation,
  insertIncidentTimelineEntry,
  listIncidentsForRecommendation,
} from '@stream-pulse/db';
import type { Severity } from '@stream-pulse/types';

const POLL_INTERVAL_MS = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 5000);

interface AnalystSummary {
  severity: Severity;
  supportingSignals: Record<string, number>;
  interpretation: string;
}

interface SellerRecommendation {
  recommendationText: string;
  rationale: string;
  actionType: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function recommendationConfidenceScore(input: {
  severity: Severity;
  rootCause: string;
  supportingSignals: Record<string, number>;
  incidentConfidence: number;
}): number {
  const signalCount = Object.keys(input.supportingSignals).filter((key) => key !== 'event_count').length;
  const signalScore = Math.min(0.25, signalCount * 0.05);
  const severityScore =
    input.severity === 'critical'
      ? 0.3
      : input.severity === 'poor'
        ? 0.23
        : input.severity === 'degraded'
          ? 0.16
          : 0.08;
  const rootCauseScore =
    input.rootCause === 'network instability'
      ? 0.2
      : input.rootCause === 'bandwidth degradation'
        ? 0.17
        : input.rootCause === 'encoder/client performance issue'
          ? 0.14
          : 0.1;
  const incidentConfidenceScore = Math.max(0, Math.min(0.25, input.incidentConfidence * 0.25));
  return clampScore(0.2 + signalScore + severityScore + rootCauseScore + incidentConfidenceScore);
}

function toSeverity(value: string | null): Severity {
  if (value === 'critical' || value === 'poor' || value === 'degraded') return value;
  return 'good';
}

function parseSignals(payload: unknown): Record<string, number> {
  if (!payload || typeof payload !== 'object') return {};
  const maybeSignals = (payload as { signals?: unknown }).signals;
  if (!maybeSignals || typeof maybeSignals !== 'object') return {};

  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(maybeSignals as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = Math.round(value * 100) / 100;
    }
  }
  return output;
}

function runSessionHealthAnalyst(
  severity: Severity,
  rootCause: string,
  signals: Record<string, number>,
): AnalystSummary {
  const highlights = [
    ['avg_rtt_ms', 'RTT'],
    ['avg_packet_loss_pct', 'packet loss'],
    ['avg_jitter_ms', 'jitter'],
    ['avg_bitrate_video_kbps', 'video bitrate'],
    ['avg_frame_drops_per_sec', 'frame drops'],
    ['score', 'QoE score'],
  ]
    .filter(([key]) => typeof signals[key] === 'number')
    .slice(0, 4)
    .map(([key, label]) => `${label}=${signals[key]}`);

  return {
    severity,
    supportingSignals: signals,
    interpretation: `Incident is ${severity} with root-cause hypothesis "${rootCause}". Supporting metrics: ${highlights.join(', ') || 'limited signals available'}.`,
  };
}

function runSellerAssistant(
  summary: AnalystSummary,
  rootCause: string,
  broadcasterId: string,
): SellerRecommendation {
  if (rootCause === 'network instability') {
    return {
      recommendationText: `Notify broadcaster ${broadcasterId} to stabilize network conditions and reduce upload contention for this session.`,
      rationale: `${summary.interpretation} Recommend immediate network triage and temporary quality moderation to reduce viewer impact.`,
      actionType: 'network-troubleshoot',
      priority: summary.severity === 'critical' ? 'critical' : 'high',
    };
  }
  if (rootCause === 'bandwidth degradation') {
    return {
      recommendationText: `Ask broadcaster ${broadcasterId} to lower outbound quality preset and pause background traffic.`,
      rationale: `${summary.interpretation} Throughput constraints are likely driving degradation; conservative encoding is the fastest mitigation.`,
      actionType: 'quality-downshift',
      priority: summary.severity === 'critical' ? 'high' : 'medium',
    };
  }
  if (rootCause === 'encoder/client performance issue') {
    return {
      recommendationText: `Prompt broadcaster ${broadcasterId} to reduce local CPU load and restart capture software if frame drops continue.`,
      rationale: `${summary.interpretation} Local client performance indicators suggest encoder-side instability.`,
      actionType: 'client-performance-check',
      priority: summary.severity === 'critical' ? 'high' : 'medium',
    };
  }

  return {
    recommendationText: `Contact broadcaster ${broadcasterId} with a generic stream health checklist and monitor for additional incidents.`,
    rationale: `${summary.interpretation} No dominant root cause detected, so use a broad mitigation checklist and close monitoring.`,
    actionType: 'general-health-check',
    priority: summary.severity === 'critical' ? 'high' : summary.severity === 'poor' ? 'medium' : 'low',
  };
}

async function processIncidentsOnce(): Promise<void> {
  const incidents = await listIncidentsForRecommendation(25);
  for (const incident of incidents) {
    const severity = toSeverity(incident.severity);
    const rootCause = incident.root_cause || 'generalized stream degradation';
    const broadcasterId = incident.broadcaster_id || 'unknown-broadcaster';
    const signals = parseSignals(incident.latest_event_payload);
    const analystSummary = runSessionHealthAnalyst(severity, rootCause, signals);
    const sellerRecommendation = runSellerAssistant(analystSummary, rootCause, broadcasterId);
    const incidentConfidence = Number(incident.confidence ?? 0);
    const recommendationConfidence = recommendationConfidenceScore({
      severity,
      rootCause,
      supportingSignals: analystSummary.supportingSignals,
      incidentConfidence: Number.isFinite(incidentConfidence) ? incidentConfidence : 0,
    });
    const dedupeKey = buildRecommendationDedupeKey({
      incidentId: incident.id,
      actionType: sellerRecommendation.actionType,
      recommendationText: sellerRecommendation.recommendationText,
      rationale: sellerRecommendation.rationale,
    });

    await insertIncidentTimelineEntry({
      incidentId: incident.id,
      ts: new Date(),
      eventType: 'agent_analysis',
      payload: {
        agent: 'session-health-analyst',
        summary: analystSummary.interpretation,
        supportingSignals: analystSummary.supportingSignals,
      },
    });

    const recommendationResult = await createRecommendation({
      incidentId: incident.id,
      agentName: 'seller-assistant',
      recommendationText: sellerRecommendation.recommendationText,
      rationale: sellerRecommendation.rationale,
      actionType: sellerRecommendation.actionType,
      priority: sellerRecommendation.priority,
      confidence: recommendationConfidence,
      triggerSignals: analystSummary.supportingSignals,
      dedupeKey,
    });
    if (recommendationResult.deduped) {
      console.log(
        `Recommendation deduped for incident ${incident.id}: existing=${recommendationResult.recommendation.id}`,
      );
    } else {
      console.log(
        `Recommendation created for incident ${incident.id}: action=${sellerRecommendation.actionType} priority=${sellerRecommendation.priority} confidence=${recommendationConfidence}`,
      );
    }
  }
}

let running = false;

async function runLoop(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await processIncidentsOnce();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown orchestrator error';
    console.error(`Agent pass failed: ${message}`);
  } finally {
    running = false;
  }
}

console.log(`StreamPulse Agent Orchestrator running with poll interval ${POLL_INTERVAL_MS}ms`);
await runLoop();
setInterval(() => {
  void runLoop();
}, POLL_INTERVAL_MS);

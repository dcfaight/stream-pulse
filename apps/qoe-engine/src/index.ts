import { insertQoeSegment, listMetricEventsSince, listScorableSessions } from '@stream-pulse/db';
import type { Severity } from '@stream-pulse/types';

const POLL_INTERVAL_MS = Number(process.env.QOE_POLL_INTERVAL_MS ?? 5000);
const MAX_EVENTS_PER_PASS = Number(process.env.QOE_MAX_EVENTS_PER_PASS ?? 500);

interface MetricAggregate {
  sum: number;
  count: number;
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

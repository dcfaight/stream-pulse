import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { MetricType } from '@stream-pulse/types';

type ScenarioName = 'healthy' | 'high-rtt' | 'packet-loss' | 'bitrate-drop' | 'unstable-session';

interface ScenarioMetric {
  metricType: MetricType;
  value: number;
}

interface SimulatorConfig {
  scenario: ScenarioName;
  events: number;
  intervalMs: number;
  ingestorUrl: string;
  sessionId: string;
  broadcasterId: string;
  sourceType: string;
  sourceLabel: string;
  runtimeLabel: string;
  sessionLabel: string;
  sourceRole: 'simulator' | 'broadcaster' | 'viewer' | 'unknown';
  streamDirection: 'outbound' | 'inbound' | 'bidirectional' | 'unknown';
}

const SCENARIOS: ScenarioName[] = [
  'healthy',
  'high-rtt',
  'packet-loss',
  'bitrate-drop',
  'unstable-session',
];

function parseSourceRole(value: string | undefined): SimulatorConfig['sourceRole'] {
  if (value === 'simulator' || value === 'broadcaster' || value === 'viewer' || value === 'unknown') {
    return value;
  }
  return 'simulator';
}

function parseStreamDirection(value: string | undefined): SimulatorConfig['streamDirection'] {
  if (value === 'outbound' || value === 'inbound' || value === 'bidirectional' || value === 'unknown') {
    return value;
  }
  return 'bidirectional';
}

function parseArgs(argv: string[]): SimulatorConfig {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) continue;
    flags.set(key.slice(2), value);
  }

  const scenarioInput = (flags.get('scenario') ?? 'healthy') as ScenarioName;
  if (!SCENARIOS.includes(scenarioInput)) {
    throw new Error(`Unknown scenario "${scenarioInput}". Valid: ${SCENARIOS.join(', ')}`);
  }

  const events = Number(flags.get('events') ?? 30);
  const intervalMs = Number(flags.get('intervalMs') ?? 1000);
  if (!Number.isFinite(events) || events < 1) {
    throw new Error('--events must be a positive number');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 50) {
    throw new Error('--intervalMs must be at least 50');
  }

  return {
    scenario: scenarioInput,
    events: Math.floor(events),
    intervalMs: Math.floor(intervalMs),
    ingestorUrl: (flags.get('ingestorUrl') ?? process.env.INGESTOR_URL ?? 'http://localhost:4001').replace(
      /\/$/,
      '',
    ),
    sessionId: flags.get('sessionId') ?? randomUUID(),
    broadcasterId: flags.get('broadcasterId') ?? `demo-${scenarioInput}`,
    sourceType: flags.get('sourceType') ?? 'simulator',
    sourceLabel: flags.get('sourceLabel') ?? `scenario:${scenarioInput}`,
    runtimeLabel: flags.get('runtimeLabel') ?? 'node:session-simulator',
    sessionLabel: flags.get('sessionLabel') ?? `Simulator ${scenarioInput}`,
    sourceRole: parseSourceRole(flags.get('sourceRole')),
    streamDirection: parseStreamDirection(flags.get('streamDirection')),
  };
}

function metricsForScenario(scenario: ScenarioName, tick: number, totalEvents: number): ScenarioMetric[] {
  if (scenario === 'healthy') {
    return [
      { metricType: 'rtt_ms', value: 45 + (tick % 4) * 2 },
      { metricType: 'packet_loss_pct', value: 0.2 + (tick % 3) * 0.1 },
      { metricType: 'jitter_ms', value: 6 + (tick % 4) },
      { metricType: 'bitrate_video_kbps', value: 2400 - (tick % 6) * 20 },
      { metricType: 'frame_drops_per_sec', value: tick % 10 === 0 ? 1 : 0 },
    ];
  }

  if (scenario === 'high-rtt') {
    return [
      { metricType: 'rtt_ms', value: 190 + (tick % 8) * 12 },
      { metricType: 'packet_loss_pct', value: 0.8 + (tick % 3) * 0.2 },
      { metricType: 'jitter_ms', value: 24 + (tick % 5) * 2 },
      { metricType: 'bitrate_video_kbps', value: 1700 - (tick % 6) * 40 },
      { metricType: 'frame_drops_per_sec', value: 1 + (tick % 3) },
    ];
  }

  if (scenario === 'packet-loss') {
    return [
      { metricType: 'rtt_ms', value: 90 + (tick % 4) * 6 },
      { metricType: 'packet_loss_pct', value: 4 + (tick % 5) * 1.2 },
      { metricType: 'jitter_ms', value: 28 + (tick % 5) * 3 },
      { metricType: 'bitrate_video_kbps', value: 1500 - (tick % 6) * 55 },
      { metricType: 'frame_drops_per_sec', value: 2 + (tick % 5) },
    ];
  }

  if (scenario === 'bitrate-drop') {
    const progress = tick / Math.max(totalEvents - 1, 1);
    return [
      { metricType: 'rtt_ms', value: 70 + progress * 35 },
      { metricType: 'packet_loss_pct', value: 0.7 + progress * 2.8 },
      { metricType: 'jitter_ms', value: 12 + progress * 26 },
      { metricType: 'bitrate_video_kbps', value: 2600 - progress * 2200 },
      { metricType: 'frame_drops_per_sec', value: progress > 0.6 ? 4 : 1 },
    ];
  }

  const phase = tick % 12;
  const unstableSpike = phase >= 8 ? 1 : 0;
  return [
    { metricType: 'rtt_ms', value: unstableSpike ? 230 + phase * 5 : 70 + phase * 2 },
    { metricType: 'packet_loss_pct', value: unstableSpike ? 6 + phase * 0.4 : 0.8 + phase * 0.08 },
    { metricType: 'jitter_ms', value: unstableSpike ? 45 + phase : 10 + phase * 1.1 },
    { metricType: 'bitrate_video_kbps', value: unstableSpike ? 900 - phase * 20 : 2200 - phase * 40 },
    { metricType: 'frame_drops_per_sec', value: unstableSpike ? 5 + (phase % 4) : phase % 2 },
  ];
}

async function postMetric(config: SimulatorConfig, metric: ScenarioMetric): Promise<void> {
  const response = await fetch(`${config.ingestorUrl}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: config.sessionId,
      broadcasterId: config.broadcasterId,
      sourceType: config.sourceType,
      sourceLabel: config.sourceLabel,
      runtimeLabel: config.runtimeLabel,
      sessionLabel: config.sessionLabel,
      sourceRole: config.sourceRole,
      streamDirection: config.streamDirection,
      metricType: metric.metricType,
      value: metric.value,
      ts: Date.now(),
      rawPayload: {
        sessionId: config.sessionId,
        ts: Date.now(),
        sourceType: config.sourceType,
        sourceLabel: config.sourceLabel,
        runtimeLabel: config.runtimeLabel,
        sessionLabel: config.sessionLabel,
        sourceRole: config.sourceRole,
        streamDirection: config.streamDirection,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telemetry post failed (${response.status}): ${body}`);
  }
}

function printHelp(): void {
  console.log(`StreamPulse session simulator

Usage:
  pnpm --filter @stream-pulse/session-simulator start -- --scenario healthy

Options:
  --scenario      healthy | high-rtt | packet-loss | bitrate-drop | unstable-session
  --events        number of event ticks to send (default: 30)
  --intervalMs    wait between ticks in milliseconds (default: 1000)
  --ingestorUrl   ingestor base URL (default: http://localhost:4001)
  --sessionId     UUID session id (default: generated)
  --broadcasterId broadcaster id (default: demo-<scenario>)
  --sourceType    source classification label (default: simulator)
  --sourceLabel   source label (default: scenario:<scenario>)
  --runtimeLabel  runtime label (default: node:session-simulator)
  --sessionLabel  session label (default: Simulator <scenario>)
  --sourceRole    simulator | broadcaster | viewer | unknown (default: simulator)
  --streamDirection outbound | inbound | bidirectional | unknown (default: bidirectional)
`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }

  const config = parseArgs(process.argv.slice(2));
  console.log(
    `Starting simulator: scenario=${config.scenario} session=${config.sessionId} events=${config.events} interval=${config.intervalMs}ms`,
  );

  for (let tick = 0; tick < config.events; tick += 1) {
    const metrics = metricsForScenario(config.scenario, tick, config.events);
    for (const metric of metrics) {
      await postMetric(config, metric);
    }

    console.log(
      `[${tick + 1}/${config.events}] sent ${metrics.length} metrics (${config.scenario}) for session ${config.sessionId}`,
    );
    if (tick < config.events - 1) {
      await sleep(config.intervalMs);
    }
  }

  console.log(`Completed simulator run for session ${config.sessionId}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown simulator error';
  console.error(message);
  process.exitCode = 1;
});

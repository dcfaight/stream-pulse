export type { StatSnapshot } from '@stream-pulse/types';
import type { MetricType, StatSnapshot } from '@stream-pulse/types';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_INGESTOR_URL = 'http://localhost:4001';
const DEFAULT_BROADCASTER_ID = 'browser-demo-broadcaster';
const DEFAULT_SOURCE_TYPE = 'browser-demo';

interface SessionClientConfig {
  intervalMs: number;
  ingestorUrl: string;
  sessionId: string;
  broadcasterId: string;
  sourceType: string;
  sourceLabel: string;
  runtimeLabel: string;
  sessionLabel: string;
  broadcasterRole: string;
}

interface MinimalRemoteInboundStats extends RTCStats {
  packetsLost?: number;
  fractionLost?: number;
  roundTripTime?: number;
  jitter?: number;
}

interface MinimalTrackStats extends RTCStats {
  kind?: string;
  mediaType?: string;
  audioLevel?: number;
}

interface MetricEmission {
  metricType: MetricType;
  value: number;
}

interface StatSelection {
  outboundVideo?: RTCOutboundRtpStreamStats;
  inboundVideo?: RTCInboundRtpStreamStats;
  remoteInboundVideo?: MinimalRemoteInboundStats;
  outboundAudio?: RTCOutboundRtpStreamStats;
  inboundAudio?: RTCInboundRtpStreamStats;
  remoteInboundAudio?: MinimalRemoteInboundStats;
  audioTrack?: MinimalTrackStats;
  candidatePair?: RTCIceCandidatePairStats;
}

export interface SessionClientOptions {
  intervalMs?: number;
  ingestorUrl?: string;
  sessionId?: string;
  broadcasterId?: string;
  sourceType?: string;
  sourceLabel?: string;
  runtimeLabel?: string;
  sessionLabel?: string;
  broadcasterRole?: string;
  fetchImpl?: typeof fetch;
  onMetric?: (metric: { metricType: MetricType; value: number; ts: number; snapshot: StatSnapshot }) => void;
  onError?: (error: unknown) => void;
}

export interface SessionClient {
  start: (overrides?: Partial<SessionClientOptions>) => void;
  stop: () => void;
  isActive: () => boolean;
  getConfig: () => SessionClientConfig;
}

function resolveSessionId(sessionId?: string): string {
  if (sessionId?.trim()) return sessionId;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('sessionId is required when crypto.randomUUID is unavailable');
}

function metricValueForConnectionState(state: RTCPeerConnectionState): number {
  if (state === 'new') return 0;
  if (state === 'connecting') return 1;
  if (state === 'connected') return 2;
  if (state === 'disconnected') return 3;
  if (state === 'failed') return 4;
  if (state === 'closed') return 5;
  return -1;
}

function statKind(stat: RTCStats): string | undefined {
  const value =
    (stat as { kind?: unknown; mediaType?: unknown }).kind ??
    (stat as { mediaType?: unknown }).mediaType;
  return typeof value === 'string' ? value : undefined;
}

function toFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toMsFromSeconds(value: number | undefined): number | undefined {
  if (typeof value !== 'number') return undefined;
  return value * 1000;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function asLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function inferBrowserName(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'unknown';
}

function inferRuntimeLabel(): string {
  if (typeof navigator === 'undefined') return 'browser:unknown';
  return `browser:${navigator.userAgent}`.slice(0, 180);
}

function reportEntries(report: RTCStatsReport): RTCStats[] {
  const iterable = report as unknown as { values?: () => IterableIterator<RTCStats> };
  if (typeof iterable.values === 'function') {
    return Array.from(iterable.values());
  }
  const keyed = report as unknown as Record<string, RTCStats>;
  return Object.values(keyed).filter(
    (value): value is RTCStats =>
      Boolean(value && typeof value === 'object' && typeof (value as RTCStats).type === 'string'),
  );
}

function reportGet(report: RTCStatsReport, id: string): RTCStats | undefined {
  const keyed = report as unknown as { get?: (key: string) => RTCStats | undefined };
  if (typeof keyed.get === 'function') return keyed.get(id);
  const fallback = report as unknown as Record<string, RTCStats | undefined>;
  return fallback[id];
}

function asStat<T extends RTCStats>(report: RTCStatsReport, id: string | undefined): T | undefined {
  if (!id) return undefined;
  return reportGet(report, id) as T | undefined;
}

function candidatePairPreference(stat: RTCIceCandidatePairStats): number {
  const nominated = stat.nominated ? 2 : 0;
  const selected = (stat as RTCIceCandidatePairStats & { selected?: boolean }).selected ? 1 : 0;
  const succeeded = stat.state === 'succeeded' ? 1 : 0;
  return nominated + selected + succeeded;
}

function pickStats(report: RTCStatsReport): StatSelection {
  let outboundVideo: RTCOutboundRtpStreamStats | undefined;
  let inboundVideo: RTCInboundRtpStreamStats | undefined;
  let remoteInboundVideo: MinimalRemoteInboundStats | undefined;
  let outboundAudio: RTCOutboundRtpStreamStats | undefined;
  let inboundAudio: RTCInboundRtpStreamStats | undefined;
  let remoteInboundAudio: MinimalRemoteInboundStats | undefined;
  let audioTrack: MinimalTrackStats | undefined;
  let candidatePair: RTCIceCandidatePairStats | undefined;

  for (const stat of reportEntries(report)) {
    if (stat.type === 'outbound-rtp' && statKind(stat) === 'video' && !outboundVideo) {
      outboundVideo = stat as RTCOutboundRtpStreamStats;
      continue;
    }
    if (stat.type === 'inbound-rtp' && statKind(stat) === 'video' && !inboundVideo) {
      inboundVideo = stat as RTCInboundRtpStreamStats;
      continue;
    }
    if (stat.type === 'outbound-rtp' && statKind(stat) === 'audio' && !outboundAudio) {
      outboundAudio = stat as RTCOutboundRtpStreamStats;
      continue;
    }
    if (stat.type === 'inbound-rtp' && statKind(stat) === 'audio' && !inboundAudio) {
      inboundAudio = stat as RTCInboundRtpStreamStats;
      continue;
    }
    if (!audioTrack && stat.type === 'track' && statKind(stat) === 'audio') {
      audioTrack = stat as MinimalTrackStats;
      continue;
    }
    if (stat.type === 'candidate-pair') {
      const pair = stat as RTCIceCandidatePairStats;
      if (!candidatePair || candidatePairPreference(pair) > candidatePairPreference(candidatePair)) {
        candidatePair = pair;
      }
    }
  }

  if (outboundVideo) {
    remoteInboundVideo = asStat<MinimalRemoteInboundStats>(report, outboundVideo.remoteId);
  }
  if (outboundAudio) {
    remoteInboundAudio = asStat<MinimalRemoteInboundStats>(report, outboundAudio.remoteId);
  }

  return {
    outboundVideo,
    inboundVideo,
    remoteInboundVideo,
    outboundAudio,
    inboundAudio,
    remoteInboundAudio,
    audioTrack,
    candidatePair,
  };
}

function buildSnapshot(config: SessionClientConfig, connectionState: RTCPeerConnectionState): StatSnapshot {
  return {
    sessionId: config.sessionId,
    ts: Date.now(),
    connectionState,
    sourceType: config.sourceType,
    sourceLabel: config.sourceLabel,
    runtimeLabel: config.runtimeLabel,
    sessionLabel: config.sessionLabel,
    broadcasterRole: config.broadcasterRole,
    browserName: inferBrowserName(),
  };
}

function emitMetric(metrics: MetricEmission[], metricType: MetricType, value: number | undefined): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  metrics.push({ metricType, value: round(value) });
}

export function createSessionClient(
  peerConnection: RTCPeerConnection,
  options?: SessionClientOptions,
): SessionClient {
  const fetchImpl = options?.fetchImpl ?? fetch;
  let config: SessionClientConfig = {
    intervalMs:
      typeof options?.intervalMs === 'number' && options.intervalMs > 250
        ? options.intervalMs
        : DEFAULT_INTERVAL_MS,
    ingestorUrl: options?.ingestorUrl ?? DEFAULT_INGESTOR_URL,
    sessionId: resolveSessionId(options?.sessionId),
    broadcasterId: options?.broadcasterId ?? DEFAULT_BROADCASTER_ID,
    sourceType: asLabel(options?.sourceType, DEFAULT_SOURCE_TYPE),
    sourceLabel: asLabel(options?.sourceLabel, 'local-loopback'),
    runtimeLabel: asLabel(options?.runtimeLabel, inferRuntimeLabel()),
    sessionLabel: asLabel(options?.sessionLabel, 'Browser Telemetry Demo'),
    broadcasterRole: asLabel(options?.broadcasterRole, 'publisher'),
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let previous: {
    ts: number;
    videoBytesSent?: number;
    videoBytesReceived?: number;
    audioBytesSent?: number;
    frameDrops?: number;
  } | null = null;

  async function sendMetric(
    metricType: MetricType,
    value: number,
    ts: number,
    rawPayload: Partial<StatSnapshot>,
  ): Promise<void> {
    const endpoint = `${config.ingestorUrl.replace(/\/+$/, '')}/telemetry`;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: config.sessionId,
        broadcasterId: config.broadcasterId,
        sourceType: config.sourceType,
        sourceLabel: config.sourceLabel,
        runtimeLabel: config.runtimeLabel,
        sessionLabel: config.sessionLabel,
        metricType,
        value,
        ts,
        rawPayload,
      }),
      keepalive: true,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Telemetry ingest failed (${response.status}): ${body || response.statusText}`);
    }
  }

  async function pollStats(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const report = await peerConnection.getStats();
      const selected = pickStats(report);
      const now = Date.now();
      const snapshot = buildSnapshot(config, peerConnection.connectionState);
      const metrics: MetricEmission[] = [];

      const outboundVideoBytes = toFinite(selected.outboundVideo?.bytesSent);
      const inboundVideoBytes = toFinite(selected.inboundVideo?.bytesReceived);
      const outboundAudioBytes = toFinite(selected.outboundAudio?.bytesSent);
      const inboundAudioBytes = toFinite(selected.inboundAudio?.bytesReceived);

      if (typeof outboundVideoBytes === 'number') {
        snapshot.videoBytesSent = outboundVideoBytes;
        emitMetric(metrics, 'bytes_sent_video', outboundVideoBytes);
      }
      if (typeof inboundVideoBytes === 'number') {
        snapshot.videoBytesReceived = inboundVideoBytes;
        emitMetric(metrics, 'bytes_received_video', inboundVideoBytes);
      }
      if (typeof outboundAudioBytes === 'number') snapshot.audioBytesSent = outboundAudioBytes;
      if (typeof inboundAudioBytes === 'number') snapshot.audioBytesReceived = inboundAudioBytes;

      const packetsSent = toFinite(selected.outboundVideo?.packetsSent);
      const inboundPacketsLost = toFinite(selected.inboundVideo?.packetsLost);
      const inboundPacketsReceived = toFinite(selected.inboundVideo?.packetsReceived);
      const outboundPacketsLost = toFinite(selected.remoteInboundVideo?.packetsLost);
      const fractionLost = toFinite(selected.remoteInboundVideo?.fractionLost);
      const packetsLost = inboundPacketsLost ?? outboundPacketsLost;
      const packetsReceived = inboundPacketsReceived;

      if (typeof packetsLost === 'number') snapshot.packetsLost = packetsLost;
      if (typeof packetsSent === 'number') snapshot.packetsSent = packetsSent;
      if (typeof packetsReceived === 'number') snapshot.packetsReceived = packetsReceived;

      const jitterMs = toMsFromSeconds(
        toFinite(selected.inboundVideo?.jitter) ?? toFinite(selected.remoteInboundVideo?.jitter),
      );
      if (typeof jitterMs === 'number') {
        snapshot.jitterMs = jitterMs;
        emitMetric(metrics, 'jitter_ms', jitterMs);
      }

      const rttMs = toMsFromSeconds(
        toFinite(selected.remoteInboundVideo?.roundTripTime) ??
          toFinite(selected.remoteInboundAudio?.roundTripTime) ??
          toFinite(selected.candidatePair?.currentRoundTripTime),
      );
      if (typeof rttMs === 'number') {
        snapshot.roundTripTimeMs = rttMs;
        emitMetric(metrics, 'rtt_ms', rttMs);
      }

      const framesPerSecond =
        toFinite(
          (selected.outboundVideo as (RTCOutboundRtpStreamStats & { framesPerSecond?: number }) | undefined)
            ?.framesPerSecond,
        ) ??
        toFinite(
          (selected.inboundVideo as (RTCInboundRtpStreamStats & { framesPerSecond?: number }) | undefined)
            ?.framesPerSecond,
        );
      if (typeof framesPerSecond === 'number') {
        snapshot.framesPerSecond = framesPerSecond;
        emitMetric(metrics, 'frames_per_second', framesPerSecond);
      }

      const frameWidth =
        toFinite(
          (selected.outboundVideo as (RTCOutboundRtpStreamStats & { frameWidth?: number }) | undefined)
            ?.frameWidth,
        ) ??
        toFinite(
          (selected.inboundVideo as (RTCInboundRtpStreamStats & { frameWidth?: number }) | undefined)
            ?.frameWidth,
        );
      const frameHeight =
        toFinite(
          (selected.outboundVideo as (RTCOutboundRtpStreamStats & { frameHeight?: number }) | undefined)
            ?.frameHeight,
        ) ??
        toFinite(
          (selected.inboundVideo as (RTCInboundRtpStreamStats & { frameHeight?: number }) | undefined)
            ?.frameHeight,
        );
      if (typeof frameWidth === 'number') {
        snapshot.frameWidth = frameWidth;
        emitMetric(metrics, 'frame_width', frameWidth);
      }
      if (typeof frameHeight === 'number') {
        snapshot.frameHeight = frameHeight;
        emitMetric(metrics, 'frame_height', frameHeight);
      }

      if (
        previous &&
        now > previous.ts &&
        previous.videoBytesSent != null &&
        typeof outboundVideoBytes === 'number'
      ) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaBytes = Math.max(0, outboundVideoBytes - previous.videoBytesSent);
        emitMetric(metrics, 'bitrate_video_kbps', (deltaBytes * 8) / 1000 / elapsedSeconds);
      }
      if (
        previous &&
        now > previous.ts &&
        previous.audioBytesSent != null &&
        typeof outboundAudioBytes === 'number'
      ) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaBytes = Math.max(0, outboundAudioBytes - previous.audioBytesSent);
        emitMetric(metrics, 'bitrate_audio_kbps', (deltaBytes * 8) / 1000 / elapsedSeconds);
      }

      const frameDrops = toFinite(
        (selected.outboundVideo as { framesDropped?: number } | undefined)?.framesDropped ??
          selected.inboundVideo?.framesDropped,
      );
      if (typeof frameDrops === 'number') snapshot.frameDrops = frameDrops;
      if (previous && typeof frameDrops === 'number' && now > previous.ts && previous.frameDrops != null) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaDrops = Math.max(0, frameDrops - previous.frameDrops);
        emitMetric(metrics, 'frame_drops_per_sec', deltaDrops / elapsedSeconds);
      }

      const audioLevel =
        toFinite(selected.audioTrack?.audioLevel) ??
        toFinite(
          (selected.inboundAudio as (RTCInboundRtpStreamStats & { audioLevel?: number }) | undefined)
            ?.audioLevel,
        );
      if (typeof audioLevel === 'number') {
        snapshot.audioLevel = audioLevel;
        emitMetric(metrics, 'audio_level', audioLevel);
      }

      const packetLossPct =
        typeof packetsLost === 'number' && typeof packetsReceived === 'number'
          ? (packetsLost / Math.max(1, packetsLost + packetsReceived)) * 100
          : typeof packetsLost === 'number' && typeof packetsSent === 'number'
            ? (packetsLost / Math.max(1, packetsLost + packetsSent)) * 100
            : typeof fractionLost === 'number'
              ? fractionLost * 100
              : undefined;
      emitMetric(metrics, 'packet_loss_pct', packetLossPct);

      snapshot.connectionState = peerConnection.connectionState;
      emitMetric(metrics, 'connection_state', metricValueForConnectionState(peerConnection.connectionState));

      for (const metric of metrics) {
        await sendMetric(metric.metricType, metric.value, now, snapshot);
        options?.onMetric?.({ metricType: metric.metricType, value: metric.value, ts: now, snapshot });
      }

      previous = {
        ts: now,
        videoBytesSent: outboundVideoBytes,
        videoBytesReceived: inboundVideoBytes,
        audioBytesSent: outboundAudioBytes,
        frameDrops,
      };
    } catch (error) {
      options?.onError?.(error);
    } finally {
      polling = false;
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start(overrides?: Partial<SessionClientOptions>): void {
    if (overrides) {
      config = {
        intervalMs:
          typeof overrides.intervalMs === 'number' && overrides.intervalMs > 250
            ? overrides.intervalMs
            : config.intervalMs,
        ingestorUrl: overrides.ingestorUrl ?? config.ingestorUrl,
        sessionId: resolveSessionId(overrides.sessionId ?? config.sessionId),
        broadcasterId: overrides.broadcasterId ?? config.broadcasterId,
        sourceType: asLabel(overrides.sourceType ?? config.sourceType, DEFAULT_SOURCE_TYPE),
        sourceLabel: asLabel(overrides.sourceLabel ?? config.sourceLabel, 'local-loopback'),
        runtimeLabel: asLabel(overrides.runtimeLabel ?? config.runtimeLabel, inferRuntimeLabel()),
        sessionLabel: asLabel(overrides.sessionLabel ?? config.sessionLabel, 'Browser Telemetry Demo'),
        broadcasterRole: asLabel(overrides.broadcasterRole ?? config.broadcasterRole, 'publisher'),
      };
    }
    stop();
    void pollStats();
    timer = setInterval(() => {
      void pollStats();
    }, config.intervalMs);
  }

  return {
    start,
    stop,
    isActive: () => timer != null,
    getConfig: () => ({ ...config }),
  };
}

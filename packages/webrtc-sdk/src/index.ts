export type { StatSnapshot } from '@stream-pulse/types';
import type { MetricType, StatSnapshot } from '@stream-pulse/types';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_INGESTOR_URL = 'http://localhost:4001';
const DEFAULT_BROADCASTER_ID = 'browser-demo-broadcaster';

interface SessionClientConfig {
  intervalMs: number;
  ingestorUrl: string;
  sessionId: string;
  broadcasterId: string;
}

export interface SessionClientOptions {
  intervalMs?: number;
  ingestorUrl?: string;
  sessionId?: string;
  broadcasterId?: string;
  fetchImpl?: typeof fetch;
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
  const value = (stat as { kind?: unknown; mediaType?: unknown }).kind ??
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

function asStat<T extends RTCStats>(report: RTCStatsReport, id: string | undefined): T | undefined {
  if (!id) return undefined;
  const value = report.get(id);
  return value as T | undefined;
}

function pickVideoStats(report: RTCStatsReport): {
  outboundVideo?: RTCOutboundRtpStreamStats;
  inboundVideo?: RTCInboundRtpStreamStats;
  remoteInboundVideo?: RTCRemoteInboundRtpStreamStats;
  candidatePair?: RTCIceCandidatePairStats;
} {
  let outboundVideo: RTCOutboundRtpStreamStats | undefined;
  let inboundVideo: RTCInboundRtpStreamStats | undefined;
  let remoteInboundVideo: RTCRemoteInboundRtpStreamStats | undefined;
  let candidatePair: RTCIceCandidatePairStats | undefined;

  for (const stat of report.values()) {
    if (
      !outboundVideo &&
      stat.type === 'outbound-rtp' &&
      statKind(stat) === 'video'
    ) {
      outboundVideo = stat as RTCOutboundRtpStreamStats;
      continue;
    }
    if (
      !inboundVideo &&
      stat.type === 'inbound-rtp' &&
      statKind(stat) === 'video'
    ) {
      inboundVideo = stat as RTCInboundRtpStreamStats;
      continue;
    }
    if (
      !candidatePair &&
      stat.type === 'candidate-pair' &&
      (stat as RTCIceCandidatePairStats).state === 'succeeded' &&
      (stat as RTCIceCandidatePairStats).nominated
    ) {
      candidatePair = stat as RTCIceCandidatePairStats;
      continue;
    }
  }

  if (outboundVideo) {
    remoteInboundVideo = asStat<RTCRemoteInboundRtpStreamStats>(report, outboundVideo.remoteId);
  }

  return { outboundVideo, inboundVideo, remoteInboundVideo, candidatePair };
}

function buildSnapshot(sessionId: string, connectionState: RTCPeerConnectionState): StatSnapshot {
  return {
    sessionId,
    ts: Date.now(),
    connectionState,
  };
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
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let previous: {
    ts: number;
    videoBytes?: number;
    packetsLost?: number;
    packetsSent?: number;
    packetsReceived?: number;
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
      const selected = pickVideoStats(report);
      const now = Date.now();
      const snapshot = buildSnapshot(config.sessionId, peerConnection.connectionState);
      const metrics: Array<{ metricType: MetricType; value: number }> = [];

      const outboundBytes = toFinite(selected.outboundVideo?.bytesSent);
      const inboundBytes = toFinite(selected.inboundVideo?.bytesReceived);
      const videoBytes = outboundBytes ?? inboundBytes;
      if (typeof videoBytes === 'number') {
        snapshot.videoBytesSent = outboundBytes;
        snapshot.videoBytesReceived = inboundBytes;
      }

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
        metrics.push({ metricType: 'jitter_ms', value: Math.round(jitterMs * 100) / 100 });
      }

      const rttMs = toMsFromSeconds(
        toFinite(selected.remoteInboundVideo?.roundTripTime) ??
          toFinite(selected.candidatePair?.currentRoundTripTime),
      );
      if (typeof rttMs === 'number') {
        snapshot.roundTripTimeMs = rttMs;
        metrics.push({ metricType: 'rtt_ms', value: Math.round(rttMs * 100) / 100 });
      }

      if (previous && typeof videoBytes === 'number' && now > previous.ts && previous.videoBytes != null) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaBytes = Math.max(0, videoBytes - previous.videoBytes);
        const bitrateVideoKbps = (deltaBytes * 8) / 1000 / elapsedSeconds;
        metrics.push({
          metricType: 'bitrate_video_kbps',
          value: Math.round(bitrateVideoKbps * 100) / 100,
        });
      }

      const frameDrops = toFinite(selected.outboundVideo?.framesDropped ?? selected.inboundVideo?.framesDropped);
      if (typeof frameDrops === 'number') snapshot.frameDrops = frameDrops;
      if (previous && typeof frameDrops === 'number' && now > previous.ts && previous.frameDrops != null) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaDrops = Math.max(0, frameDrops - previous.frameDrops);
        metrics.push({
          metricType: 'frame_drops_per_sec',
          value: Math.round((deltaDrops / elapsedSeconds) * 100) / 100,
        });
      }

      const packetLossPct =
        typeof packetsLost === 'number' && typeof packetsReceived === 'number'
          ? (packetsLost / Math.max(1, packetsLost + packetsReceived)) * 100
          : typeof packetsLost === 'number' && typeof packetsSent === 'number'
            ? (packetsLost / Math.max(1, packetsLost + packetsSent)) * 100
            : typeof fractionLost === 'number'
              ? fractionLost * 100
              : undefined;
      if (typeof packetLossPct === 'number') {
        metrics.push({
          metricType: 'packet_loss_pct',
          value: Math.round(packetLossPct * 100) / 100,
        });
      }

      snapshot.connectionState = peerConnection.connectionState;
      metrics.push({
        metricType: 'connection_state',
        value: metricValueForConnectionState(peerConnection.connectionState),
      });

      for (const metric of metrics) {
        await sendMetric(metric.metricType, metric.value, now, snapshot);
      }

      previous = {
        ts: now,
        videoBytes,
        packetsLost,
        packetsSent,
        packetsReceived,
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

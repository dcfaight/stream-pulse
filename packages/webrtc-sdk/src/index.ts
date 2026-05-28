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
  sourceRole: 'broadcaster' | 'viewer' | 'browser-demo' | 'simulator' | 'unknown';
  streamDirection: 'inbound' | 'outbound' | 'bidirectional' | 'unknown';
  broadcasterRole: string;
}

interface MinimalRemoteInboundStats extends RTCStats {
  packetsLost?: number;
  fractionLost?: number;
  roundTripTime?: number;
  jitter?: number;
}

interface MinimalAudioSourceStats extends RTCStats {
  kind?: string;
  mediaType?: string;
  audioLevel?: number;
}

interface MinimalIceCandidateStats extends RTCStats {
  candidateType?: string;
  networkType?: string;
  relayProtocol?: string;
  protocol?: string;
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
  audioSource?: MinimalAudioSourceStats;
  candidatePair?: RTCIceCandidatePairStats;
  localCandidate?: MinimalIceCandidateStats;
  remoteCandidate?: MinimalIceCandidateStats;
  outboundVideoTrackCount: number;
  inboundVideoTrackCount: number;
  outboundAudioTrackCount: number;
  inboundAudioTrackCount: number;
  outboundVideoTrackId?: string;
  inboundVideoTrackId?: string;
  outboundAudioTrackId?: string;
  inboundAudioTrackId?: string;
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
  sourceRole?: 'broadcaster' | 'viewer' | 'browser-demo' | 'simulator' | 'unknown';
  streamDirection?: 'inbound' | 'outbound' | 'bidirectional' | 'unknown';
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

function statTrackIdentifier(stat: RTCStats): string | undefined {
  const value = (stat as { trackIdentifier?: unknown }).trackIdentifier;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function asSourceRole(
  value: string | undefined,
): 'broadcaster' | 'viewer' | 'browser-demo' | 'simulator' | 'unknown' {
  if (value === 'broadcaster' || value === 'viewer' || value === 'browser-demo' || value === 'simulator') {
    return value;
  }
  return 'unknown';
}

function asStreamDirection(
  value: string | undefined,
): 'inbound' | 'outbound' | 'bidirectional' | 'unknown' {
  if (value === 'inbound' || value === 'outbound' || value === 'bidirectional') return value;
  return 'unknown';
}

function normalizeIntervalMs(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(500, Math.floor(value));
}

function normalizeIngestorUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
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
  const writable = (stat as RTCIceCandidatePairStats & { writable?: boolean }).writable ? 1 : 0;
  const availableOutgoingBitrate = toFinite(stat.availableOutgoingBitrate) ?? 0;
  return nominated + selected + succeeded + writable + availableOutgoingBitrate / 10_000_000;
}

function metricValueForCandidatePairState(state: string | undefined): number {
  if (state === 'frozen') return 0;
  if (state === 'waiting') return 1;
  if (state === 'in-progress') return 2;
  if (state === 'failed') return 3;
  if (state === 'succeeded') return 4;
  return -1;
}

function pickStats(report: RTCStatsReport): StatSelection {
  let outboundVideo: RTCOutboundRtpStreamStats | undefined;
  let inboundVideo: RTCInboundRtpStreamStats | undefined;
  let remoteInboundVideo: MinimalRemoteInboundStats | undefined;
  let outboundAudio: RTCOutboundRtpStreamStats | undefined;
  let inboundAudio: RTCInboundRtpStreamStats | undefined;
  let remoteInboundAudio: MinimalRemoteInboundStats | undefined;
  let audioSource: MinimalAudioSourceStats | undefined;
  let candidatePair: RTCIceCandidatePairStats | undefined;
  let outboundVideoTrackCount = 0;
  let inboundVideoTrackCount = 0;
  let outboundAudioTrackCount = 0;
  let inboundAudioTrackCount = 0;
  let outboundVideoTrackId: string | undefined;
  let inboundVideoTrackId: string | undefined;
  let outboundAudioTrackId: string | undefined;
  let inboundAudioTrackId: string | undefined;

  for (const stat of reportEntries(report)) {
    const statType = (stat as RTCStats & { type: string }).type;
    if (statType === 'outbound-rtp' && statKind(stat) === 'video' && !outboundVideo) {
      outboundVideo = stat as RTCOutboundRtpStreamStats;
    }
    if (statType === 'outbound-rtp' && statKind(stat) === 'video') {
      outboundVideoTrackCount += 1;
      outboundVideoTrackId = outboundVideoTrackId ?? statTrackIdentifier(stat);
      continue;
    }
    if (statType === 'inbound-rtp' && statKind(stat) === 'video' && !inboundVideo) {
      inboundVideo = stat as RTCInboundRtpStreamStats;
    }
    if (statType === 'inbound-rtp' && statKind(stat) === 'video') {
      inboundVideoTrackCount += 1;
      inboundVideoTrackId = inboundVideoTrackId ?? statTrackIdentifier(stat);
      continue;
    }
    if (statType === 'outbound-rtp' && statKind(stat) === 'audio' && !outboundAudio) {
      outboundAudio = stat as RTCOutboundRtpStreamStats;
    }
    if (statType === 'outbound-rtp' && statKind(stat) === 'audio') {
      outboundAudioTrackCount += 1;
      outboundAudioTrackId = outboundAudioTrackId ?? statTrackIdentifier(stat);
      continue;
    }
    if (statType === 'inbound-rtp' && statKind(stat) === 'audio' && !inboundAudio) {
      inboundAudio = stat as RTCInboundRtpStreamStats;
    }
    if (statType === 'inbound-rtp' && statKind(stat) === 'audio') {
      inboundAudioTrackCount += 1;
      inboundAudioTrackId = inboundAudioTrackId ?? statTrackIdentifier(stat);
      continue;
    }
    if (!audioSource && statType === 'media-source' && statKind(stat) === 'audio') {
      audioSource = stat as MinimalAudioSourceStats;
      continue;
    }
    if (statType === 'candidate-pair') {
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
  const localCandidate = asStat<MinimalIceCandidateStats>(
    report,
    (candidatePair as RTCIceCandidatePairStats & { localCandidateId?: string } | undefined)?.localCandidateId,
  );
  const remoteCandidate = asStat<MinimalIceCandidateStats>(
    report,
    (candidatePair as RTCIceCandidatePairStats & { remoteCandidateId?: string } | undefined)?.remoteCandidateId,
  );

  return {
    outboundVideo,
    inboundVideo,
    remoteInboundVideo,
    outboundAudio,
    inboundAudio,
    remoteInboundAudio,
    audioSource,
    candidatePair,
    localCandidate,
    remoteCandidate,
    outboundVideoTrackCount,
    inboundVideoTrackCount,
    outboundAudioTrackCount,
    inboundAudioTrackCount,
    outboundVideoTrackId,
    inboundVideoTrackId,
    outboundAudioTrackId,
    inboundAudioTrackId,
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
    sourceRole: config.sourceRole,
    streamDirection: config.streamDirection,
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
      normalizeIntervalMs(options?.intervalMs, DEFAULT_INTERVAL_MS),
    ingestorUrl: normalizeIngestorUrl(options?.ingestorUrl, DEFAULT_INGESTOR_URL),
    sessionId: resolveSessionId(options?.sessionId),
    broadcasterId: options?.broadcasterId ?? DEFAULT_BROADCASTER_ID,
    sourceType: asLabel(options?.sourceType, DEFAULT_SOURCE_TYPE),
    sourceLabel: asLabel(options?.sourceLabel, 'local-loopback'),
    runtimeLabel: asLabel(options?.runtimeLabel, inferRuntimeLabel()),
    sessionLabel: asLabel(options?.sessionLabel, 'Browser Telemetry Demo'),
    sourceRole: asSourceRole(options?.sourceRole ?? 'browser-demo'),
    streamDirection: asStreamDirection(options?.streamDirection ?? 'bidirectional'),
    broadcasterRole: asLabel(options?.broadcasterRole, 'publisher'),
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let previous: {
    ts: number;
    videoBytesSent?: number;
    videoBytesReceived?: number;
    audioBytesSent?: number;
    audioBytesReceived?: number;
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
        sourceRole: config.sourceRole,
        streamDirection: config.streamDirection,
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
      emitMetric(metrics, 'bytes_sent_audio', outboundAudioBytes);
      emitMetric(metrics, 'bytes_received_audio', inboundAudioBytes);

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
        previous.videoBytesReceived != null &&
        typeof inboundVideoBytes === 'number'
      ) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaBytes = Math.max(0, inboundVideoBytes - previous.videoBytesReceived);
        emitMetric(metrics, 'bitrate_video_inbound_kbps', (deltaBytes * 8) / 1000 / elapsedSeconds);
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
      if (
        previous &&
        now > previous.ts &&
        previous.audioBytesReceived != null &&
        typeof inboundAudioBytes === 'number'
      ) {
        const elapsedSeconds = (now - previous.ts) / 1000;
        const deltaBytes = Math.max(0, inboundAudioBytes - previous.audioBytesReceived);
        emitMetric(metrics, 'bitrate_audio_inbound_kbps', (deltaBytes * 8) / 1000 / elapsedSeconds);
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
        toFinite(selected.audioSource?.audioLevel) ??
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

      const nackCount = toFinite(
        (selected.outboundVideo as { nackCount?: number } | undefined)?.nackCount ??
          (selected.inboundVideo as { nackCount?: number } | undefined)?.nackCount,
      );
      const pliCount = toFinite(
        (selected.outboundVideo as { pliCount?: number } | undefined)?.pliCount ??
          (selected.inboundVideo as { pliCount?: number } | undefined)?.pliCount,
      );
      const availableOutgoingBitrateKbps = toFinite(selected.candidatePair?.availableOutgoingBitrate);
      emitMetric(metrics, 'nack_count', nackCount);
      emitMetric(metrics, 'pli_count', pliCount);
      emitMetric(
        metrics,
        'available_outgoing_bitrate_kbps',
        typeof availableOutgoingBitrateKbps === 'number' ? availableOutgoingBitrateKbps / 1000 : undefined,
      );
      snapshot.outboundVideoTrackCount = selected.outboundVideoTrackCount;
      snapshot.inboundVideoTrackCount = selected.inboundVideoTrackCount;
      snapshot.outboundAudioTrackCount = selected.outboundAudioTrackCount;
      snapshot.inboundAudioTrackCount = selected.inboundAudioTrackCount;
      snapshot.outboundVideoTrackId = selected.outboundVideoTrackId;
      snapshot.inboundVideoTrackId = selected.inboundVideoTrackId;
      snapshot.outboundAudioTrackId = selected.outboundAudioTrackId;
      snapshot.inboundAudioTrackId = selected.inboundAudioTrackId;
      emitMetric(metrics, 'outbound_video_track_count', selected.outboundVideoTrackCount);
      emitMetric(metrics, 'inbound_video_track_count', selected.inboundVideoTrackCount);
      emitMetric(metrics, 'outbound_audio_track_count', selected.outboundAudioTrackCount);
      emitMetric(metrics, 'inbound_audio_track_count', selected.inboundAudioTrackCount);

      snapshot.candidatePairState = selected.candidatePair?.state;
      snapshot.candidateSelected = Boolean(
        (selected.candidatePair as RTCIceCandidatePairStats & { selected?: boolean } | undefined)?.selected,
      );
      snapshot.candidateNominated = Boolean(selected.candidatePair?.nominated);
      snapshot.candidateWritable = Boolean(
        (selected.candidatePair as RTCIceCandidatePairStats & { writable?: boolean } | undefined)?.writable,
      );
      snapshot.selectedCandidatePairId = selected.candidatePair?.id;
      snapshot.localCandidateType = selected.localCandidate?.candidateType;
      snapshot.remoteCandidateType = selected.remoteCandidate?.candidateType;
      snapshot.networkType = selected.localCandidate?.networkType ?? selected.remoteCandidate?.networkType;
      snapshot.relayProtocol = selected.localCandidate?.relayProtocol ?? selected.remoteCandidate?.relayProtocol;
      snapshot.candidateTransportProtocol =
        selected.localCandidate?.protocol ?? selected.remoteCandidate?.protocol;
      emitMetric(
        metrics,
        'candidate_pair_state',
        metricValueForCandidatePairState(selected.candidatePair?.state),
      );
      emitMetric(metrics, 'candidate_selected', snapshot.candidateSelected ? 1 : 0);
      emitMetric(metrics, 'candidate_nominated', snapshot.candidateNominated ? 1 : 0);
      emitMetric(metrics, 'candidate_writable', snapshot.candidateWritable ? 1 : 0);

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
        audioBytesReceived: inboundAudioBytes,
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
          normalizeIntervalMs(overrides.intervalMs, config.intervalMs),
        ingestorUrl: normalizeIngestorUrl(overrides.ingestorUrl, config.ingestorUrl),
        sessionId: resolveSessionId(overrides.sessionId ?? config.sessionId),
        broadcasterId: overrides.broadcasterId ?? config.broadcasterId,
        sourceType: asLabel(overrides.sourceType ?? config.sourceType, DEFAULT_SOURCE_TYPE),
        sourceLabel: asLabel(overrides.sourceLabel ?? config.sourceLabel, 'local-loopback'),
        runtimeLabel: asLabel(overrides.runtimeLabel ?? config.runtimeLabel, inferRuntimeLabel()),
        sessionLabel: asLabel(overrides.sessionLabel ?? config.sessionLabel, 'Browser Telemetry Demo'),
        sourceRole: asSourceRole(overrides.sourceRole ?? config.sourceRole),
        streamDirection: asStreamDirection(overrides.streamDirection ?? config.streamDirection),
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

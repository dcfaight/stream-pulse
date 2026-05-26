/**
 * Raw snapshot of an RTCPeerConnection.getStats() call, normalised to a
 * canonical shape independent of browser vendor.
 */
export interface StatSnapshot {
  sessionId: string;
  ts: number; // Unix ms
  videoBytesReceived?: number;
  videoBytesSent?: number;
  audioBytesSent?: number;
  audioBytesReceived?: number;
  packetsLost?: number;
  packetsSent?: number;
  packetsReceived?: number;
  roundTripTimeMs?: number;
  jitterMs?: number;
  framesPerSecond?: number;
  frameDrops?: number;
  audioLevel?: number; // 0.0 – 1.0
  connectionState?: string;
}

/**
 * Derived metric event produced by the ingestor from one or more StatSnapshots.
 */
export type MetricType =
  | 'bitrate_video_kbps'
  | 'bitrate_audio_kbps'
  | 'rtt_ms'
  | 'packet_loss_pct'
  | 'jitter_ms'
  | 'frame_drops_per_sec'
  | 'audio_level'
  | 'connection_state';

export interface MetricEvent {
  id: string;
  sessionId: string;
  ts: number; // Unix ms
  metricType: MetricType;
  value: number;
  rawPayload?: Partial<StatSnapshot>;
}

export interface DerivedMetrics {
  bitrateVideoKbps: number;
  bitrateAudioKbps: number;
  rttMs: number;
  packetLossPct: number;
  jitterMs: number;
  frameDropsPerSec: number;
  audioLevel: number;
  connectionState: string;
}

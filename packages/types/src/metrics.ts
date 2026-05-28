/**
 * Raw snapshot of an RTCPeerConnection.getStats() call, normalised to a
 * canonical shape independent of browser vendor.
 */
export interface StatSnapshot {
  sessionId: string;
  ts: number; // Unix ms
  sourceType?: string;
  sourceLabel?: string;
  runtimeLabel?: string;
  sessionLabel?: string;
  sourceRole?: 'broadcaster' | 'viewer' | 'browser-demo' | 'simulator' | 'unknown';
  streamDirection?: 'inbound' | 'outbound' | 'bidirectional' | 'unknown';
  broadcasterRole?: string;
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
  frameWidth?: number;
  frameHeight?: number;
  frameDrops?: number;
  audioLevel?: number; // 0.0 – 1.0
  connectionState?: string;
  browserName?: string;
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
  | 'frames_per_second'
  | 'frame_width'
  | 'frame_height'
  | 'bytes_sent_video'
  | 'bytes_received_video'
  | 'bytes_sent_audio'
  | 'bytes_received_audio'
  | 'bitrate_video_inbound_kbps'
  | 'bitrate_audio_inbound_kbps'
  | 'nack_count'
  | 'pli_count'
  | 'available_outgoing_bitrate_kbps'
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
  framesPerSecond: number;
  frameWidth: number;
  frameHeight: number;
  bytesSentVideo: number;
  bytesReceivedVideo: number;
  bytesSentAudio: number;
  bytesReceivedAudio: number;
  bitrateVideoInboundKbps: number;
  bitrateAudioInboundKbps: number;
  nackCount: number;
  pliCount: number;
  availableOutgoingBitrateKbps: number;
  audioLevel: number;
  connectionState: string;
}

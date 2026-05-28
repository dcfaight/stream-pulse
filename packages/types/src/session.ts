export type SessionStatus = 'active' | 'ended' | 'error';

export interface SessionInfo {
  id: string;
  broadcasterId: string;
  sourceType?: string;
  sourceLabel?: string;
  runtimeLabel?: string;
  sessionLabel?: string;
  sourceRole?: 'broadcaster' | 'viewer' | 'browser-demo' | 'simulator' | 'unknown';
  streamDirection?: 'inbound' | 'outbound' | 'bidirectional' | 'unknown';
  startedAt: string; // ISO 8601
  endedAt?: string;
  status: SessionStatus;
}

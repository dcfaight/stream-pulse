export type SessionStatus = 'active' | 'ended' | 'error';

export interface SessionInfo {
  id: string;
  broadcasterId: string;
  sourceType?: string;
  sourceLabel?: string;
  runtimeLabel?: string;
  sessionLabel?: string;
  startedAt: string; // ISO 8601
  endedAt?: string;
  status: SessionStatus;
}

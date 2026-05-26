export type SessionStatus = 'active' | 'ended' | 'error';

export interface SessionInfo {
  id: string;
  broadcasterId: string;
  startedAt: string; // ISO 8601
  endedAt?: string;
  status: SessionStatus;
}

// WebRTC SDK — (M1 implementation)
// See: docs/issues/initial-tasks.md TASK-006

export type { StatSnapshot } from '@stream-pulse/types';

// Placeholder: full implementation in M1
export function createSessionClient(
  _peerConnection: RTCPeerConnection,
  _options?: { intervalMs?: number; ingestorUrl?: string },
): { stop: () => void } {
  console.warn('WebRTC SDK: scaffold placeholder — implement in M1');
  return { stop: () => {} };
}

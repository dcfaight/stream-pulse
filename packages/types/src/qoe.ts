export type Severity = 'good' | 'degraded' | 'poor' | 'critical';

export interface QoESegment {
  id: string;
  sessionId: string;
  startTs: number; // Unix ms
  endTs: number;
  score: number; // 0–100
  severity: Severity;
  signals: Record<string, number>; // metric name → value at scoring time
}

export interface QoEEvent {
  sessionId: string;
  segment: QoESegment;
}

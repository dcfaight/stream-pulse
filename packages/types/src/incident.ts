import type { Severity } from './qoe.js';

export interface AnomalyEvent {
  sessionId: string;
  ts: number;
  metricType: string;
  value: number;
  threshold: number;
  severity: Severity;
}

export interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  ts: number;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface Incident {
  id: string;
  sessionId: string;
  startedAt: number;
  resolvedAt?: number;
  rootCause: string;
  confidence: number; // 0.0–1.0
  severity: Severity;
  timeline: IncidentTimelineEntry[];
}

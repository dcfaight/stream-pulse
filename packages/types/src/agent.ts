export type RecommendationStatus = 'pending' | 'approved' | 'dismissed' | 'applied';
export type OperatorDecision = 'approve' | 'dismiss';

export interface AgentTrigger {
  sessionId: string;
  incidentId?: string;
  triggerType: 'qoe_degraded' | 'incident_detected' | 'session_ended' | 'manual';
  signals: Record<string, number>;
}

export interface AgentResult {
  agentName: string;
  triggeredAt: number;
  rationale: string;
  actionType?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

export interface Recommendation {
  id: string;
  incidentId?: string;
  agentName: string;
  createdAt: number;
  recommendationText: string;
  rationale: string;
  actionType: string;
  status: RecommendationStatus;
  triggerSignals: Record<string, number>;
  priority: AgentResult['priority'];
}

export interface OperatorAction {
  id: string;
  recommendationId: string;
  operatorId: string;
  decidedAt: number;
  decision: OperatorDecision;
  notes?: string;
}

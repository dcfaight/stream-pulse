export type RecommendationStatus = 'pending' | 'approved' | 'dismissed' | 'superseded' | 'applied';
export type OperatorDecision = 'approve' | 'dismiss';
export type RecommendationEffectiveness = 'unknown' | 'helpful' | 'not_helpful' | 'unconfirmed';

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
  confidence: number;
  effectivenessSignal?: RecommendationEffectiveness;
  effectivenessReason?: string;
}

export interface OperatorAction {
  id: string;
  recommendationId: string;
  operatorId: string;
  decidedAt: number;
  decision: OperatorDecision;
  notes?: string;
}

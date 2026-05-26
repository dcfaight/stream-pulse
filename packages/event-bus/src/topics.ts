/**
 * Topic name constants used by all services.
 * These map 1:1 to Kafka topic names when the Kafka adapter is plugged in.
 */
export const TOPICS = {
  METRIC_RAW: 'metric.raw',
  QOE_SCORED: 'qoe.scored',
  INCIDENT_DETECTED: 'incident.detected',
  RECOMMENDATION_CREATED: 'recommendation.created',
  ACTION_REQUESTED: 'action.requested',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

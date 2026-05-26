import type { MetricEvent, QoEEvent, Incident, Recommendation, OperatorAction } from '@stream-pulse/types';
import type { TopicName } from './topics.js';

/**
 * Payload map — associates each topic name with its typed payload.
 * Extend this map when adding new topics.
 */
export interface TopicPayloadMap {
  'metric.raw': MetricEvent;
  'qoe.scored': QoEEvent;
  'incident.detected': Incident;
  'recommendation.created': Recommendation;
  'action.requested': OperatorAction;
}

export type Handler<T> = (payload: T) => void | Promise<void>;

/**
 * IEventBus — the Kafka-ready interface for all event producers and consumers.
 * The in-process implementation uses Node.js EventEmitter under the hood.
 * A Kafka adapter that implements this interface can be substituted without
 * changing any producer or consumer code.
 */
export interface IEventBus {
  publish<T extends TopicName>(topic: T, payload: TopicPayloadMap[T]): void;
  subscribe<T extends TopicName>(topic: T, handler: Handler<TopicPayloadMap[T]>): void;
  unsubscribe<T extends TopicName>(topic: T, handler: Handler<TopicPayloadMap[T]>): void;
}

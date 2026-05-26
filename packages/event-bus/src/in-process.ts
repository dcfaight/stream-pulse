import { EventEmitter } from 'node:events';
import type { IEventBus, Handler, TopicPayloadMap } from './interface.js';
import type { TopicName } from './topics.js';

/**
 * InProcessEventBus — EventEmitter-backed implementation of IEventBus.
 * Suitable for single-process deployments (MVP). Swap for KafkaEventBus
 * by implementing IEventBus and passing it via dependency injection.
 */
export class InProcessEventBus implements IEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Raise the default listener limit to support many subscribers per topic
    this.emitter.setMaxListeners(50);
  }

  publish<T extends TopicName>(topic: T, payload: TopicPayloadMap[T]): void {
    this.emitter.emit(topic, payload);
  }

  subscribe<T extends TopicName>(topic: T, handler: Handler<TopicPayloadMap[T]>): void {
    this.emitter.on(topic, handler);
  }

  unsubscribe<T extends TopicName>(topic: T, handler: Handler<TopicPayloadMap[T]>): void {
    this.emitter.off(topic, handler);
  }
}

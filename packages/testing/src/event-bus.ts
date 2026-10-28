import type { CoreEventHandler, EventBus } from "@openchannelprotocol/core";

/** Ordered publish/subscribe bus for tests. Handlers run sequentially in registration order. */
class RecordingEventBus<TEvent> implements EventBus<TEvent> {
  private readonly handlers = new Set<CoreEventHandler<TEvent>>();

  async publish(event: TEvent): Promise<void> {
    for (const handler of this.handlers) {
      // biome-ignore lint/performance/noAwaitInLoops: Subscribers are notified in registration order.
      await handler(event);
    }
  }

  subscribe(handler: CoreEventHandler<TEvent>): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}

/** Creates an event bus for tests. Each call returns an independent bus. */
export function createTestEventBus<TEvent = unknown>(): EventBus<TEvent> {
  return new RecordingEventBus<TEvent>();
}

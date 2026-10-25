/** A callback invoked when an event is published. */
export type CoreEventHandler<TEvent = unknown> = (event: TEvent) => void | Promise<void>;
/** Minimal asynchronous publish/subscribe contract for OCP integrations. */
export interface EventBus<TEvent = unknown> {
  publish: (event: TEvent) => Promise<void>;
  subscribe: (handler: CoreEventHandler<TEvent>) => () => void;
}
//# sourceMappingURL=types.d.ts.map

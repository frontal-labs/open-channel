import type {
  ChannelAdapter,
  ChannelSink,
  ChannelSource,
  DeliveryOptions,
  DeliveryReceipt,
  ReceiveMetadata,
} from "@openchannelprotocol/adapter";
import { OpenChannelError, TransportError, ValidationError } from "@openchannelprotocol/core";
import type { EventEnvelope } from "@openchannelprotocol/protocol";

import type { OpenChannelRuntime } from "./runtime.js";
import type { RuntimeResult } from "./types.js";

/** Routes normalized OCP events to provider adapters. */
export class ChannelGateway {
  private readonly sinks: Record<string, ChannelSink> = Object.create(null);
  private readonly sources: Record<string, ChannelSource> = Object.create(null);
  private sourceRuns: Partial<Record<string, Promise<void>>> = Object.create(null);
  readonly runtime: OpenChannelRuntime;

  constructor(runtime: OpenChannelRuntime, adapters: ChannelAdapter[] = []) {
    this.runtime = runtime;
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: ChannelAdapter): void {
    this.sinks[adapter.provider] = adapter;
  }

  registerSource(source: ChannelSource): void {
    this.sources[source.provider] = source;
  }

  registerChannel(channel: { sink?: ChannelSink; source?: ChannelSource }): void {
    if (channel.sink) {
      this.register(channel.sink);
    }
    if (channel.source) {
      this.registerSource(channel.source);
    }
  }

  ingest(event: EventEnvelope): Promise<RuntimeResult> {
    return this.runtime.process(event);
  }

  async receive(
    provider: string,
    input: unknown,
    metadata?: ReceiveMetadata,
  ): Promise<RuntimeResult[]> {
    const source: ChannelSource | undefined = this.sources[provider];
    if (!source) {
      throw new TransportError(`No OCP source registered for provider: ${provider}`, {
        details: { provider },
      });
    }

    let normalized: Awaited<ReturnType<ChannelSource["normalize"]>>;
    try {
      normalized = await source.normalize(input, metadata);
    } catch (error) {
      if (error instanceof OpenChannelError) {
        throw error;
      }
      throw new TransportError(`Unable to normalize input for provider: ${provider}`, {
        cause: error,
        provider,
        retryable: true,
        stage: "normalize",
      });
    }
    const events = Array.isArray(normalized) ? normalized : [normalized];
    const results: RuntimeResult[] = [];
    for (const event of events) {
      // biome-ignore lint/performance/noAwaitInLoops: Provider event order must be preserved.
      results.push(await this.ingest(event));
    }
    return results;
  }

  start(
    emit: (event: EventEnvelope) => Promise<void>,
    signal: AbortSignal,
    onError?: (error: OpenChannelError) => void | Promise<void>,
  ): Promise<void> {
    for (const source of Object.values(this.sources)) {
      if (!source.start) {
        continue;
      }
      const run = Promise.resolve(source.start(emit, signal));
      this.sourceRuns[source.provider] = run.catch(async (error) => {
        await onError?.(
          error instanceof OpenChannelError
            ? error
            : new TransportError(`OCP source failed for provider ${source.provider}`, {
                cause: error,
                provider: source.provider,
                retryable: true,
                stage: "processing",
              }),
        );
      });
      // Keep source failures attached to the lifecycle promise without making startup wait for a
      // long-running polling or websocket source.
    }
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    for (const source of Object.values(this.sources)) {
      if (source.stop) {
        // biome-ignore lint/performance/noAwaitInLoops: Sources are stopped deterministically.
        await source.stop();
      }
    }
    await Promise.allSettled(Object.values(this.sourceRuns));
    this.sourceRuns = Object.create(null);
  }

  async dispatch(event: EventEnvelope, options?: DeliveryOptions): Promise<DeliveryReceipt> {
    const provider = event.channel?.provider;
    if (!provider) {
      throw new ValidationError(
        `Cannot dispatch OCP event ${event.eventId}: channel.provider is required`,
      );
    }

    const adapter: ChannelSink | undefined = this.sinks[provider];
    if (!adapter) {
      throw new TransportError(`No OCP adapter registered for provider: ${provider}`, {
        details: { eventId: event.eventId, provider },
      });
    }
    try {
      return await adapter.send(event, options);
    } catch (error) {
      if (error instanceof OpenChannelError) {
        throw error;
      }
      throw new TransportError(`Delivery failed for OCP event ${event.eventId}`, {
        cause: error,
        eventId: event.eventId,
        provider,
        retryable: true,
        stage: "delivery",
      });
    }
  }

  async close(): Promise<void> {
    for (const sink of Object.values(this.sinks)) {
      // biome-ignore lint/performance/noAwaitInLoops: Sinks close deterministically before shutdown completes.
      await sink.close?.();
    }
  }
}

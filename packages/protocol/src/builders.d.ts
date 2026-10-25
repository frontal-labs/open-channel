import { type Timestamp } from "@bufbuild/protobuf/wkt";
import { type EventInput } from "./events.js";
import {
  type ActionRequest,
  type ActorRef,
  type ArtifactRef,
  type EventEnvelope,
} from "./generated.js";
/** Routing and identity fields shared by every typed builder. */
export type EventMeta = Omit<EventInput, "payload">;
/** Input for `messageReceived()`. */
export interface MessageReceivedInput extends EventMeta {
  attachments?: ArtifactRef[];
  metadata?: Record<string, string>;
  text: string;
}
/** Input for `messageSent()`. */
export interface MessageSentInput extends EventMeta {
  attachments?: ArtifactRef[];
  metadata?: Record<string, string>;
  text: string;
}
/** Input for `approvalRequested()`. `deadline` accepts a `Date` or a protobuf `Timestamp`. */
export interface ApprovalRequestedInput extends EventMeta {
  agent: ActorRef;
  approvalId: string;
  approver: ActorRef;
  deadline?: Date | Timestamp;
  reason: string;
  requestedAction: ActionRequest;
}
/** Input for `actionExecuted()`. */
export interface ActionExecutedInput extends EventMeta {
  action: ActionRequest;
  artifacts?: ArtifactRef[];
  result?: string;
}
/** Input for `actionFailed()`. */
export interface ActionFailedInput extends EventMeta {
  action: ActionRequest;
  errorCode: string;
  errorMessage: string;
  retryable?: boolean;
}
/** Builds a `message.received` event. */
export declare function messageReceived({
  attachments,
  metadata,
  text,
  ...meta
}: MessageReceivedInput): EventEnvelope;
/** Builds a `message.sent` event. */
export declare function messageSent({
  attachments,
  metadata,
  text,
  ...meta
}: MessageSentInput): EventEnvelope;
/** Builds an `approval.requested` event. */
export declare function approvalRequested({
  agent,
  approvalId,
  approver,
  deadline: due,
  reason,
  requestedAction,
  ...meta
}: ApprovalRequestedInput): EventEnvelope;
/** Builds an `action.executed` event. */
export declare function actionExecuted({
  action,
  artifacts,
  result,
  ...meta
}: ActionExecutedInput): EventEnvelope;
/** Builds an `action.failed` event. */
export declare function actionFailed({
  action,
  errorCode,
  errorMessage,
  retryable,
  ...meta
}: ActionFailedInput): EventEnvelope;
//# sourceMappingURL=builders.d.ts.map

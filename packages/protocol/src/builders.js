import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { newEvent } from "./events.js";
import {
  ActionExecutedSchema,
  ActionFailedSchema,
  ApprovalRequestedSchema,
  MessageReceivedSchema,
  MessageSentSchema,
} from "./generated.js";

function deadline(value) {
  return value instanceof Date ? timestampFromDate(value) : value;
}
/** Builds a `message.received` event. */
export function messageReceived({ attachments, metadata, text, ...meta }) {
  return newEvent({
    ...meta,
    payload: {
      case: "messageReceived",
      value: create(MessageReceivedSchema, { attachments, metadata, text }),
    },
  });
}
/** Builds a `message.sent` event. */
export function messageSent({ attachments, metadata, text, ...meta }) {
  return newEvent({
    ...meta,
    payload: {
      case: "messageSent",
      value: create(MessageSentSchema, { attachments, metadata, text }),
    },
  });
}
/** Builds an `approval.requested` event. */
export function approvalRequested({
  agent,
  approvalId,
  approver,
  deadline: due,
  reason,
  requestedAction,
  ...meta
}) {
  return newEvent({
    ...meta,
    payload: {
      case: "approvalRequested",
      value: create(ApprovalRequestedSchema, {
        agent,
        approvalId,
        approver,
        deadline: due === undefined ? undefined : deadline(due),
        reason,
        requestedAction,
      }),
    },
  });
}
/** Builds an `action.executed` event. */
export function actionExecuted({ action, artifacts, result, ...meta }) {
  return newEvent({
    ...meta,
    payload: {
      case: "actionExecuted",
      value: create(ActionExecutedSchema, { action, artifacts, result: result ?? "" }),
    },
  });
}
/** Builds an `action.failed` event. */
export function actionFailed({ action, errorCode, errorMessage, retryable, ...meta }) {
  return newEvent({
    ...meta,
    payload: {
      case: "actionFailed",
      value: create(ActionFailedSchema, {
        action,
        errorCode,
        errorMessage,
        retryable: retryable ?? false,
      }),
    },
  });
}
//# sourceMappingURL=builders.js.map

import { hasCode, isFrontalError } from "@frontal-labs/error";
import { describe, expect, it } from "vitest";

import {
  ActionError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  type OpenChannelError,
  ProtocolError,
  TransportError,
  toChannelText,
  toFailureRecord,
  toToolFailure,
  ValidationError,
} from "../src/index.js";

const cause = new Error("root cause");

describe("OpenChannelError on @frontal-labs/error", () => {
  it("keeps the classified fields of every subclass", () => {
    const options = {
      actionId: "action:1",
      approvalId: "approval:1",
      cause,
      details: { field: "eventId" },
      eventId: "event:1",
      provider: "slack",
      retryable: true,
      stage: "delivery",
    };
    const error = new TransportError("delivery failed", options);

    expect(error.name).toBe("TransportError");
    expect(error.code).toBe("OCP_TRANSPORT");
    expect(error.message).toBe("delivery failed");
    expect(error.details).toEqual({
      actionId: "action:1",
      approvalId: "approval:1",
      eventId: "event:1",
      field: "eventId",
      provider: "slack",
      retryable: true,
      stage: "delivery",
    });
    expect(error.actionId).toBe("action:1");
    expect(error.approvalId).toBe("approval:1");
    expect(error.eventId).toBe("event:1");
    expect(error.provider).toBe("slack");
    expect(error.stage).toBe("delivery");
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });

  it("defaults the action stage and the retryable flag", () => {
    const error = new ActionError("failed");

    expect(error.stage).toBe("action");
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ stage: "action" });
  });

  it("builds resource messages and copies the resource into details", () => {
    const notFound = new NotFoundError("OCP agent", "agent:9");
    const conflict = new ConflictError("OCP agent", "agent:1");

    expect(notFound.message).toBe("OCP agent was not found: agent:9");
    expect(notFound.details).toEqual({ identifier: "agent:9", resource: "OCP agent" });
    expect(conflict.message).toBe("OCP agent already exists or is in a conflicting state: agent:1");
    expect(conflict.details).toEqual({ identifier: "agent:1", resource: "OCP agent" });
  });

  it("is a FrontalError with the ocp scope, the OCP code and the status from the table", () => {
    const cases: [OpenChannelError, string, number][] = [
      [new ActionError("m"), "OCP_ACTION", 500],
      [new AuthorizationError("m"), "OCP_AUTHORIZATION", 403],
      [new ConflictError("r", "i"), "OCP_CONFLICT", 409],
      [new NotFoundError("r", "i"), "OCP_NOT_FOUND", 404],
      [new ProtocolError("m"), "OCP_PROTOCOL", 400],
      [new TransportError("m"), "OCP_TRANSPORT", 502],
      [new ValidationError("m"), "OCP_VALIDATION", 400],
    ];
    for (const [error, code, statusCode] of cases) {
      expect(isFrontalError(error)).toBe(true);
      expect(error.scope).toBe("ocp");
      expect(error.code).toBe(code);
      expect(hasCode(error, code)).toBe(true);
      expect(error.statusCode).toBe(statusCode);
    }
  });

  it("writes the telemetry attributes only for IDs that are set", () => {
    const error = new ValidationError("invalid", {
      eventId: "event:1",
      provider: "email",
      stage: "normalize",
    });

    expect(error.attributes).toEqual({
      "ocp.event_id": "event:1",
      "ocp.provider": "email",
      "ocp.stage": "normalize",
    });
  });

  it("keeps metadata serialisable while details keeps every value", () => {
    const callback = () => undefined;
    const error = new ValidationError("invalid", {
      details: { callback, count: 2, nested: { ok: true }, skipped: undefined },
    });

    expect(error.details.callback).toBe(callback);
    expect(error.metadata).toEqual({ count: 2, nested: { ok: true } });
    expect(() => JSON.stringify(error.metadata)).not.toThrow();
  });

  it("keeps a cyclic value in details only, so metadata still serialises", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const error = new ValidationError("invalid", { details: { cyclic, kept: 1 } });

    expect(error.details.cyclic).toBe(cyclic);
    expect(error.metadata).toEqual({ kept: 1 });
    expect(() => JSON.stringify(toFailureRecord(error))).not.toThrow();
  });
});

describe("toChannelText", () => {
  it("uses the approved public message when one is set", () => {
    const error = new NotFoundError("OCP agent", "agent:9", {
      public: { message: "That agent isn't available." },
    });

    expect(toChannelText(error)).toBe("That agent isn't available.");
  });

  it("falls back to the fixed text for each code, never the developer message", () => {
    expect(toChannelText(new AuthorizationError("policy rule 7 denies send"))).toBe(
      "You're not allowed to do that.",
    );
    expect(toChannelText(new ActionError("upstream returned 500 for agent:1"))).toBe(
      "The action couldn't be completed.",
    );
    expect(toChannelText(new TransportError("slack token expired"))).toBe(
      "The message couldn't be delivered.",
    );
    expect(toChannelText(new NotFoundError("OCP agent", "agent:9"))).toBe("Something went wrong.");
    expect(toChannelText(new ValidationError("bad input"))).toBe("Something went wrong.");
  });

  it("returns the generic text for anything that is not a Frontal error", () => {
    expect(toChannelText(new Error("secret stack detail"))).toBe("Something went wrong.");
    expect(toChannelText("raw string")).toBe("Something went wrong.");
  });
});

describe("toToolFailure", () => {
  it("returns only success, scope, code and public text", () => {
    const error = new NotFoundError("OCP agent", "agent:9", {
      public: { hint: "Check the agent ID.", message: "That agent isn't available." },
    });

    expect(toToolFailure(error)).toEqual({
      error: {
        code: "OCP_NOT_FOUND",
        hint: "Check the agent ID.",
        message: "That agent isn't available.",
        scope: "ocp",
      },
      success: false,
    });
  });

  it("never includes the developer message or identifiers", () => {
    const serialised = JSON.stringify(
      toToolFailure(new NotFoundError("OCP agent", "agent:secret-9")),
    );

    expect(serialised).not.toContain("agent:secret-9");
    expect(serialised).not.toContain("was not found");
    expect(serialised).toContain("Something went wrong.");
  });

  it("wraps non-OCP failures with the action code", () => {
    expect(toToolFailure(new Error("db password is wrong"))).toEqual({
      error: {
        code: "OCP_ACTION",
        message: "Something went wrong.",
        scope: "ocp",
      },
      success: false,
    });
  });
});

describe("toFailureRecord", () => {
  it("survives JSON and keeps the code, message and stage", () => {
    const error = new ActionError("calendar quota exceeded", {
      actionId: "action:1",
      cause,
      retryable: true,
    });
    const record = JSON.parse(JSON.stringify(toFailureRecord(error)));

    expect(record).toEqual({
      code: "OCP_ACTION",
      details: { actionId: "action:1", retryable: true, stage: "action" },
      message: "calendar quota exceeded",
      name: "ActionError",
      retryable: true,
      stage: "action",
    });
  });

  it("records plain errors without a code", () => {
    expect(toFailureRecord(new Error("boom"))).toEqual({
      details: {},
      message: "boom",
      name: "Error",
      retryable: false,
    });
    expect(toFailureRecord("text")).toEqual({
      details: {},
      message: "text",
      name: "Error",
      retryable: false,
    });
  });
});

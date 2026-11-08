import { ActionError, toFailureRecord } from "@openchannelprotocol/core";
import {
  createTestAgent,
  createTestEvent,
  createTestEventStore,
  createTestHuman,
} from "@openchannelprotocol/testing";
import { describe, expect, it } from "vitest";
import { RuleBasedPolicyEngine } from "../../../packages/policy/src/index.js";
import { type ActionResult, openChannel } from "../src/index.js";

/** Runs one request whose action ID already has a stored failure, and returns that failure result. */
type FailedResult = Extract<ActionResult<unknown>, { status: "failed" }>;

async function restoreFailure(stored: unknown): Promise<FailedResult> {
  const store = createTestEventStore();
  const actionId = "action:stored-failure";
  await store.claimAction(actionId, "agent:stored");
  await store.failAction(actionId, stored);
  const agent = createTestAgent("agent:stored", "Stored Agent");
  let result: ActionResult<unknown> | undefined;
  const app = openChannel({
    actions: [
      { execute: () => "unused", type: "stored.action", validate: (input: unknown) => input },
    ],
    agents: [
      {
        id: agent.id,
        name: agent.displayName,
        onMessage: async (context) => {
          result = await context.request("stored.action", {}, { actionId });
        },
      },
    ],
    channels: [],
    policy: new RuleBasedPolicyEngine({
      rules: [{ actionType: "stored.action", allowed: true, id: "allow-stored" }],
    }),
    store,
  });

  await app.start();
  await app.ingest(createTestEvent({ actor: createTestHuman(), recipient: agent }));
  await app.stop();

  if (result?.status !== "failed") {
    throw new Error(`expected a failed result, received ${result?.status ?? "no result"}`);
  }
  return result;
}

describe("restored action failures", () => {
  it("restores the developer message from a failure record", async () => {
    const result = await restoreFailure(
      toFailureRecord(new ActionError("calendar quota exceeded", { retryable: true })),
    );

    expect(result.error).toBeInstanceOf(ActionError);
    expect(result.error.message).toBe("calendar quota exceeded");
    expect(result.error.retryable).toBe(true);
  });

  it("does not turn a legacy row without a message into '[object Object]'", async () => {
    // Rows written before failure records serialised an ActionError to JSON, which keeps no message.
    const result = await restoreFailure({ code: "OCP_ACTION", details: {}, retryable: false });

    expect(result.error.message).not.toContain("[object Object]");
    expect(result.error.message).toBe("The action failed.");
  });
});

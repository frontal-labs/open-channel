import type { EventEnvelope } from "ocp-protocol";
import { ApprovalOutcome } from "ocp-protocol";
import { describe, expect, it } from "vitest";
import { normalizeTeamsEvent } from "../../src/teams/index.js";

const approval = (from: Record<string, unknown> | undefined, value: Record<string, unknown>) => ({
  conversation: { id: "conversation-1" },
  from,
  id: "activity-1",
  type: "invoke",
  value: { action: "approve", approvalId: "approval-1", ...value },
});

describe("ocp-sdk/teams approval attribution", () => {
  it("attributes the decision to the activity sender, not a spoofed actorId in the card", async () => {
    const event = (await normalizeTeamsEvent(
      approval(
        { aadObjectId: "aad-approver", id: "29:approver", name: "Dana" },
        {
          actorId: "aad-victim",
        },
      ),
    )) as EventEnvelope;
    expect(event.payload.case).toBe("approvalDecided");
    if (event.payload.case !== "approvalDecided") {
      throw new Error("expected approvalDecided");
    }
    expect(event.payload.value.approver?.id).toBe("teams:aad-approver");
    expect(event.payload.value.approver?.displayName).toBe("Dana");
    expect(event.payload.value.outcome).toBe(ApprovalOutcome.GRANTED);
  });

  it("falls back to the bot-scoped id when no aadObjectId is present", async () => {
    const event = (await normalizeTeamsEvent(approval({ id: "29:approver" }, {}))) as EventEnvelope;
    expect(event.payload.case === "approvalDecided" && event.payload.value.approver?.id).toBe(
      "teams:29:approver",
    );
  });

  it("rejects an approval whose activity has no sender, even when the card names an actor", async () => {
    await expect(
      normalizeTeamsEvent(approval(undefined, { actorId: "aad-victim" })),
    ).rejects.toThrow("Microsoft Teams approval action has no sender");
  });
});

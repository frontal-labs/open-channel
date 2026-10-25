import { toJson } from "ocp-protocol";
import { createBufferedTestIO, createTestEvent } from "ocp-testing";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/index.js";

describe("ocp-cli", () => {
  it("validates buffered ProtoJSON input", async () => {
    const { io, stdout } = createBufferedTestIO(
      JSON.stringify(toJson(createTestEvent({ eventType: "message.received" }))),
    );

    expect(await runCommand(["validate"], io)).toBe(0);
    expect(stdout[0]).toBe("valid OCP event: message.received");
  });
});

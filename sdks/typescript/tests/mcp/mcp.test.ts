import { ActionError } from "@openchannel/core";
import { describe, expect, it } from "vitest";
import type { McpToolClient } from "../../src/mcp/index.js";
import { closeMcpClient, mcpActions } from "../../src/mcp/index.js";

/** Resolves to the rejection reason of `outcome`, or to `undefined` when it resolves. */
async function settle(outcome: unknown): Promise<unknown> {
  try {
    await outcome;
  } catch (caught) {
    return caught;
  }
  return undefined;
}

const context = { actor: {} as never, request: {} as never, runtime: {} as never };

describe("ocp-sdk/mcp", () => {
  it("creates a policy-controlled MCP action", async () => {
    const calls: string[] = [];
    const [action] = mcpActions({
      callTool: ({ tool }) => {
        calls.push(tool);
        return Promise.resolve({ content: [{ text: "ok", type: "text" }] });
      },
    });
    expect(action?.type).toBe("mcp.tool_call");
    const result = await action?.execute({ tool: "echo" }, context);
    expect(result).toMatchObject({ content: [{ text: "ok" }] });
    expect(calls).toEqual(["echo"]);
  });

  it("rejects an empty tool name before the client is called", () => {
    let called = false;
    const [action] = mcpActions({
      callTool: () => {
        called = true;
        return Promise.resolve({});
      },
    });
    expect(() => action?.validate({ tool: "" })).toThrow();
    expect(called).toBe(false);
  });

  it("maps an isError result to a non-retryable ActionError", async () => {
    const [action] = mcpActions({
      callTool: () => Promise.resolve({ isError: true }),
    });
    const error = await settle(action?.execute({ tool: "delete_file" }, context));
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({
      message: "MCP tool delete_file returned an error",
      provider: "mcp",
      retryable: false,
    });
  });

  it("maps a thrown transport failure to a retryable ActionError with the cause", async () => {
    const cause = new Error("connection reset");
    const [action] = mcpActions({
      callTool: () => Promise.reject(cause),
    });
    const error = await settle(action?.execute({ tool: "search" }, context));
    expect(error).toMatchObject({
      message: "MCP tool search failed",
      provider: "mcp",
      retryable: true,
    });
    expect((error as ActionError).cause).toBe(cause);
  });

  it("passes an ActionError thrown by the client through unchanged", async () => {
    const classified = new ActionError("upstream unavailable", { provider: "mcp" });
    const [action] = mcpActions({
      callTool: () => Promise.reject(classified),
    });
    const error = await settle(action?.execute({ tool: "search" }, context));
    expect(error).toBe(classified);
  });

  it("closes the client only when it implements close", async () => {
    let closed = 0;
    const client: McpToolClient = {
      callTool: () => Promise.resolve({}),
      close: () => {
        closed += 1;
      },
    };
    await closeMcpClient(client);
    await closeMcpClient({ callTool: () => Promise.resolve({}) });
    expect(closed).toBe(1);
  });
});

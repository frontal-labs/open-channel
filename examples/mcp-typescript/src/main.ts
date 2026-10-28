/**
 * MCP TypeScript example: a tool on an MCP server, called through an OCP action.
 *
 * OCP concepts:
 * - The MCP `callTool` is an OCP action (`mcp.call_tool`). The agent asks for it with
 *   `context.request`, and the policy engine decides whether it runs.
 * - The tool's text output is returned to the user as a `message.sent`. It is output only. It never
 *   authorizes a later state change.
 *
 * No model and no API key are needed. The default server is `@modelcontextprotocol/server-everything`,
 * which echoes its input, so the default run is deterministic.
 *
 * Run it:
 *   npm start --prefix examples/mcp-typescript
 *   npm start --prefix examples/mcp-typescript -- "hello from OCP"
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { action } from "@openchannelprotocol/sdk";

import { allowOnlyTargets, runOpenChannelTextAgent } from "./ocp-bridge.js";

/** Env var: command that starts the MCP server over stdio. */
const SERVER_COMMAND_ENV = "MCP_SERVER_COMMAND";

/** Env var: JSON array of strings passed to the server command. */
const SERVER_ARGS_ENV = "MCP_SERVER_ARGS";

/** Env var: name of the MCP tool to call. */
const TOOL_NAME_ENV = "MCP_TOOL_NAME";

/** Default command. `npx` fetches the default server from npm on first run. */
const DEFAULT_SERVER_COMMAND = "npx";

/** Default server args: a pinned, echoing test server. */
const DEFAULT_SERVER_ARGS = ["-y", "@modelcontextprotocol/server-everything@2.0.0"];

/** Default tool on the default server. It returns its input as text. */
const DEFAULT_TOOL_NAME = "echo";

/** OCP action type for an MCP tool call. Policy targets are `mcp:<tool name>`. */
const MCP_CALL_ACTION_TYPE = "mcp.call_tool";

/** Question or input text sent when the command line has no arguments. */
const DEFAULT_INPUT = "Explain why OCP keeps policy outside the model prompt.";

const command = process.env[SERVER_COMMAND_ENV] ?? DEFAULT_SERVER_COMMAND;
const args = parseServerArgs(process.env[SERVER_ARGS_ENV]);
const toolName = process.env[TOOL_NAME_ENV] ?? DEFAULT_TOOL_NAME;

/** Policy target for this tool. The example policy allows only this one target. */
const target = `mcp:${toolName}`;

/** Input to the `mcp.call_tool` action. */
interface CallToolInput {
  /** Arguments object passed to the MCP tool. */
  arguments: Record<string, unknown>;
  /** MCP tool name on the server. */
  toolName: string;
}

/** Output of the `mcp.call_tool` action: the text blocks of the tool result, joined by newlines. */
interface CallToolOutput {
  text: string;
}

/**
 * The MCP call as an OCP action. Each call starts a fresh stdio client, connects, calls the tool,
 * and closes the client. This keeps the example simple and avoids leaving a server process running.
 */
const callMcpTool = action<CallToolInput, CallToolOutput>({
  execute: async (input) => {
    const client = new Client({ name: "ocp-mcp-example", version: "0.1.0" });
    await client.connect(new StdioClientTransport({ args, command }));
    try {
      const result = await client.callTool({
        arguments: input.arguments,
        name: input.toolName,
      });
      // Keep only text content. Images and other blocks are ignored by this example.
      const text = result.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return { text };
    } finally {
      await client.close();
    }
  },
  type: MCP_CALL_ACTION_TYPE,
  // Checks the shape of the request before any process is started.
  validate: (input) => {
    if (typeof input !== "object" || input === null) {
      throw new Error(`${MCP_CALL_ACTION_TYPE} input must be an object`);
    }
    const { arguments: toolArguments, toolName: name } = input as Record<string, unknown>;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${MCP_CALL_ACTION_TYPE} input needs a non-empty toolName`);
    }
    if (
      typeof toolArguments !== "object" ||
      toolArguments === null ||
      Array.isArray(toolArguments)
    ) {
      throw new Error(`${MCP_CALL_ACTION_TYPE} input needs an arguments object`);
    }
    return { arguments: toolArguments as Record<string, unknown>, toolName: name };
  },
});

await runOpenChannelTextAgent({
  actions: [callMcpTool],
  handler: async (text, context) => {
    // The handler never calls MCP directly. It asks OCP, and OCP decides based on the policy.
    const result = await context.request<CallToolInput, CallToolOutput>(
      MCP_CALL_ACTION_TYPE,
      { arguments: { message: text }, toolName },
      { reason: `Call MCP tool ${toolName}`, target },
    );
    switch (result.status) {
      case "executed":
        return result.result.text;
      case "blocked":
        return `Blocked by policy: ${result.reason}`;
      case "approval_required":
        return `Approval required before the MCP call runs: ${result.approvalId}`;
      default:
        return `MCP call failed: ${result.error.message}`;
    }
  },
  input: process.argv.slice(2).join(" ") || DEFAULT_INPUT,
  name: "MCP Tool Agent",
  policy: allowOnlyTargets([target]),
});

/**
 * Parses `MCP_SERVER_ARGS`. Returns the default args when the variable is unset.
 *
 * @param raw - Raw env value, expected to be a JSON array of strings.
 * @throws An error that shows the expected format when the value is not valid JSON or not an
 *   array of strings.
 */
function parseServerArgs(raw: string | undefined): string[] {
  if (raw === undefined) {
    return DEFAULT_SERVER_ARGS;
  }
  const expected = `${SERVER_ARGS_ENV} must be a JSON array of strings, for example '["path/to/server.js"]'.`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${expected} Received: ${raw}`, { cause: error });
  }
  if (!(Array.isArray(parsed) && parsed.every((item) => typeof item === "string"))) {
    throw new Error(`${expected} Received: ${raw}`);
  }
  return parsed;
}

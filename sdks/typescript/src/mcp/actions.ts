import { ActionError } from "ocp-core";
import { z } from "zod";
import type { ActionDefinition } from "../types.js";
import { action } from "../types.js";

import type { McpActions, McpToolCallInput, McpToolClient, McpToolResult } from "./types.js";

const McpToolCallSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).optional(),
  tool: z.string().min(1),
});

/**
 * Creates the policy-controlled `mcp.tool_call` action. The tool name and arguments are
 * validated before policy runs. A result with `isError: true` becomes a non-retryable
 * `ActionError`, because the same call would most likely fail again.
 */
export function mcpActions(client: McpToolClient): McpActions {
  const mcpTool = action<McpToolCallInput, McpToolResult>({
    execute: async (input) => {
      try {
        const result = await client.callTool(input);
        if (result.isError) {
          throw new ActionError(`MCP tool ${input.tool} returned an error`, {
            provider: "mcp",
            retryable: false,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        throw new ActionError(`MCP tool ${input.tool} failed`, {
          cause: error,
          provider: "mcp",
          retryable: true,
        });
      }
    },
    type: "mcp.tool_call",
    validate: (input) => McpToolCallSchema.parse(input),
  });
  return [mcpTool] as McpActions;
}

/**
 * Calls the client's `close()` when the application stops. Safe to call on clients that do
 * not implement `close`.
 */
export async function closeMcpClient(client: McpToolClient): Promise<void> {
  await client.close?.();
}

/**
 * Identity helper that gives one MCP action definition its input and result types. It does
 * not add validation; `validate` must still be supplied by the caller.
 */
export function mcpAction<TInput, TResult>(
  definition: ActionDefinition<TInput, TResult>,
): ActionDefinition<TInput, TResult> {
  return definition;
}

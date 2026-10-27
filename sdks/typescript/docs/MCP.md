# ocp-sdk/mcp

Policy-controlled MCP tool calls for OCP agents. The package exposes one SDK action,
`mcp.tool_call`, that forwards a tool name and arguments to an MCP client. Agents request it with
`ctx.request("mcp.tool_call", ...)`. The SDK validates the request, asks the policy engine, and only
then calls the MCP server. A tool call can change external state, so it is treated as a side effect
that needs an allow decision.

In the OCP flow, the agent harness emits an action request, the runtime evaluates policy, and this
extension is the executor that calls the MCP tool and returns an action result event.

## Install

```sh
pnpm add ocp-sdk
```

The SDK bundles its internal packages, so no other install is needed. Use the official MCP SDK
(`@modelcontextprotocol/sdk`) in your application to create the client. This package does not
depend on it.

## Quickstart

```ts
import { mcpActions, type McpToolClient } from "ocp-sdk/mcp";
import { RuleBasedPolicyEngine } from "ocp-sdk";
import { openChannel, type OpenChannelOptions } from "ocp-sdk";

// Injected by the application: a port over your MCP client connection.
declare const mcpClient: McpToolClient;
// Injected by the application: a durable event store.
declare const store: OpenChannelOptions["store"];

const app = openChannel({
  actions: mcpActions(mcpClient),
  agents: [
    {
      id: "agent:research",
      name: "Research",
      onMessage: async (ctx) => {
        await ctx.request("mcp.tool_call", {
          arguments: { query: "open channel protocol" },
          tool: "search_docs",
        });
      },
    },
  ],
  policy: new RuleBasedPolicyEngine({
    rules: [{ actionType: "mcp.tool_call", allowed: true, id: "mcp-tools", requiresApproval: true }],
  }),
  store,
});

await app.start();
```

Your `McpToolClient.callTool` maps `{ tool, arguments }` onto the MCP client's own call signature.

## Actions

| Type           | Input                                   | Client method            |
| -------------- | --------------------------------------- | ------------------------ |
| `mcp.tool_call` | `tool` (non-empty), optional `arguments` | `callTool({ tool, arguments })` |

## Safety and policy boundary

- Validation runs before policy. An empty tool name is rejected without reaching the server.
- Policy sees the action type `mcp.tool_call`, the actor, and the request target (by default
  `action:mcp.tool_call`). The reference `RuleBasedPolicyEngine` matches on action type only, so it
  cannot tell tools apart. To allow some tools and deny others, pass a per-tool `target` on the
  request and write a `PolicyEngine` that checks it.
- Arguments are passed through without schema checks. The MCP server is responsible for validating
  them.
- Results with `isError: true` become non-retryable `ActionError`s. Other thrown failures become
  retryable `ActionError`s with `provider: "mcp"` and the original cause. An `ActionError` thrown
  by the client passes through unchanged.
- Approval is not execution: a tool with `requiresApproval` runs only after approval.
- The `signal` parameter on `callTool` is never supplied by the action bridge, so cancellation of an
  in-flight call is not wired through.

## Shutdown

Call `closeMcpClient(client)` when the application stops. It calls the client's optional `close()`
and does nothing when the client has none.

## Environment and secrets

This package reads no environment variables and stores no secrets. Server URLs, transport options,
and auth tokens belong to the MCP client you create and inject. Load them from your secret store or
environment in application code.

## Tests

```sh
pnpm --filter ocp-sdk test
```

# MCP TypeScript + OCP

This example connects to an MCP server over stdio, calls one tool, and
dispatches the tool's text output as an OCP `message.sent`. The tool call is an
OCP action (`mcp.call_tool`), so the policy engine decides whether it runs. The
MCP result is output only; it never authorizes a later state change.

Code layout:

- `src/main.ts`: the MCP client, the `mcp.call_tool` action, and the policy target.
- `src/ocp-bridge.ts`: the OCP wiring (app, agent, channel, policy, store).

## Prerequisites

- Node.js 22.18 or later, with `npx` on the PATH. The default server is fetched
  from npm on first run, so the first run needs network access.
- The `ocp-sdk` SDK. **It is not on the npm registry yet**, so `npm install`
  does not install it. The SDK also depends on other workspace packages, so it
  cannot be installed from `sdks/typescript` by npm alone. To run this example
  you must make `ocp-sdk` resolvable (for example, from a local build of
  `sdks/typescript`). The bridge typechecks against the SDK source; a
  standalone one-command install is not verified.

No model or API key is needed. The default run is deterministic: the default
server echoes its input.

## Run

```bash
npm install --prefix examples/mcp-typescript
npm start --prefix examples/mcp-typescript
```

Pass a custom input after `--`:

```bash
npm start --prefix examples/mcp-typescript -- "hello from OCP"
```

To use another MCP server, set the command, args, and tool name:

```bash
export MCP_SERVER_COMMAND=node
export MCP_SERVER_ARGS='["path/to/server.js"]'
export MCP_TOOL_NAME=your_tool
npm start --prefix examples/mcp-typescript
```

The tool receives `{ "message": "<input text>" }` as its arguments.

## Environment variables

| Variable             | Required | Default                                                  | Purpose                                                                             |
| -------------------- | -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `MCP_SERVER_COMMAND` | No       | `npx`                                                    | Command that starts the MCP server over stdio.                                      |
| `MCP_SERVER_ARGS`    | No       | `["-y", "@modelcontextprotocol/server-everything@2.0.0"]` | JSON array of strings passed to the command. Invalid JSON fails with the expected format. |
| `MCP_TOOL_NAME`      | No       | `echo`                                                   | Tool to call. The policy target becomes `mcp:<MCP_TOOL_NAME>`.                      |

## Expected output

With the default server and tool, the example prints JSON like this. The `reply`
is the tool's text output, which is the server's echo of the input. Its exact
wording depends on the server version.

```json
{
  "agentCard": {
    "id": "agent:mcp-tool-agent",
    "name": "MCP Tool Agent",
    "...": "..."
  },
  "correlationId": "<uuid of the inbound message.received>",
  "eventType": "message.sent",
  "reply": "<echoed tool output>"
}
```

If the policy blocks the call, the reply is `Blocked by policy: ...`. The policy
target is derived from `MCP_TOOL_NAME`, so the configured tool is always
allowed by this example's policy. The blocked path is reached only if you change
the policy in `src/main.ts`.

## How this maps to OCP

- The input becomes a `message.received` envelope from `channel:example`, sent
  to agent `agent:mcp-tool-agent`.
- The handler asks OCP to run `mcp.call_tool` through `context.request`. It never
  calls the MCP client directly. The policy decides, and the action result comes
  back as `executed`, `blocked`, `approval_required`, or an error.
- The reply leaves through OCP as `message.sent`. The tool output is not an
  authorization for anything else.

## Safety boundary

The example policy (`allowOnlyTargets` in `src/ocp-bridge.ts`, called from
`src/main.ts`) allows only the target `mcp:<MCP_TOOL_NAME>` and denies
everything else. The example does not exercise approvals. For a state-changing
tool, do not allowlist it here. Route the call through the OCP policy engine's
approval path, and treat the MCP result as output only.

# LangChain TypeScript + OCP

A LangChain v1 `createAgent` agent behind the OCP TypeScript SDK (`ocp-sdk`).
An inbound `message.received` envelope goes through `openChannel()`, the agent
runs, and its final text is dispatched as an OCP `message.sent`.

Code layout:

- `src/main.ts`: the LangChain agent and model selection.
- `src/ocp-bridge.ts`: the OCP wiring (app, agent, channel, policy, store).

## Prerequisites

- Node.js 22.18 or later.
- An OpenAI API key for live mode. Create one at
  <https://platform.openai.com/api-keys>. Not needed for deterministic mode.
- The `ocp-sdk` SDK. **It is not on the npm registry yet**, so `npm install`
  does not install it. The SDK also depends on other workspace packages, so it
  cannot be installed from `sdks/typescript` by npm alone. To run this example
  you must make `ocp-sdk` resolvable (for example, from a local build of
  `sdks/typescript`). The bridge typechecks against the SDK source; a
  standalone one-command install is not verified.

## Run

```bash
npm install --prefix examples/langchain-typescript
export OPENAI_API_KEY=...   # live mode; never commit this value
npm start --prefix examples/langchain-typescript
```

Pass a question after `--` to replace the default:

```bash
npm start --prefix examples/langchain-typescript -- "What does OCP policy do?"
```

### Deterministic mode (no key, no network)

```bash
OCP_EXAMPLE_DETERMINISTIC=1 npm start --prefix examples/langchain-typescript
```

This swaps `ChatOpenAI` for LangChain's `FakeListChatModel`. `createAgent` and
the whole OCP path still run; only the model call is scripted.

## Environment variables

| Variable                    | Required          | Default       | Purpose                                                              |
| --------------------------- | ----------------- | ------------- | -------------------------------------------------------------------- |
| `OPENAI_API_KEY`            | Live mode         | none          | Read by `ChatOpenAI`. Startup fails with a message naming it if unset. |
| `OPENAI_MODEL`              | No                | `gpt-4o-mini` | Chat model for live mode.                                            |
| `OCP_EXAMPLE_DETERMINISTIC` | No                | unset         | Set to `1` to use the scripted fake model instead of OpenAI.         |

## Expected output

Deterministic mode prints JSON like this:

```json
{
  "agentCard": {
    "id": "agent:langchain-typescript-agent",
    "name": "LangChain TypeScript Agent",
    "...": "..."
  },
  "correlationId": "<uuid of the inbound message.received>",
  "eventType": "message.sent",
  "reply": "Policy stays outside the prompt, so a model reply cannot grant permissions."
}
```

Live mode prints the same shape, with the model's answer in `reply`, so its
wording varies between runs.

## How this maps to OCP

- The input becomes a `message.received` envelope from `channel:example`, sent
  to agent `agent:langchain-typescript-agent`.
- LangChain owns model execution. The reply leaves through OCP as
  `message.sent`, so delivery and audit events stay on the OCP side.
- The example registers no actions, and its policy denies every action target.
  A model tool call cannot change state through OCP.

# OCP examples

These examples show how to put OCP at the boundary of an agent application.
The harness or model framework owns orchestration; OCP owns identity, event
context, policy signals, approvals, and provider-neutral delivery.

## Quickstart

Run the deterministic native examples without external model credentials:

```bash
pnpm examples:typescript
PYTHONPATH=sdks/python/src python3 examples/native-python/main.py
cargo run --manifest-path examples/native-rust/Cargo.toml
```

Framework examples are opt-in and keep their dependencies outside the core
workspace. Each directory contains its own README, dependency manifest, and
environment-variable guidance.

## Example matrix

| Example                                                    | Language   | Harness/tool                 | What it demonstrates                                                |
| ---------------------------------------------------------- | ---------- | ---------------------------- | ------------------------------------------------------------------- |
| [`native-typescript`](./native-typescript/README.md)       | TypeScript | `@openchannelprotocol/sdk` | Agent cards, message routing, channel dispatch, approval flow       |
| [`native-python`](./native-python/README.md)               | Python     | OCP Python SDK               | Async agent host and ProtoJSON-shaped replies                       |
| [`native-rust`](./native-rust/README.md)                   | Rust       | OCP Rust SDK                 | Typed agent host and reply envelopes                                |
| [`slack-typescript`](./slack-typescript/README.md)         | TypeScript | Slack Events API and Web API | Real-channel quickstart: signed webhooks in, `chat.postMessage` out |
| [`langchain-python`](./langchain-python/README.md)         | Python     | LangChain v1                 | `create_agent` mapped to OCP messages                               |
| [`langchain-typescript`](./langchain-typescript/README.md) | TypeScript | LangChain v1                 | `createAgent` mapped to OCP messages                                |
| [`openai-agents-python`](./openai-agents-python/README.md) | Python     | OpenAI Agents SDK            | `Runner.run` and interruption boundary                              |
| [`pydanticai-python`](./pydanticai-python/README.md)       | Python     | PydanticAI                   | Typed agent result mapped to OCP                                    |
| [`crewai-python`](./crewai-python/README.md)               | Python     | CrewAI                       | Crew/task execution mapped to OCP                                   |
| [`llamaindex-python`](./llamaindex-python/README.md)       | Python     | LlamaIndex                   | `FunctionAgent` and tool-oriented execution                         |
| [`vercel-ai-typescript`](./vercel-ai-typescript/README.md) | TypeScript | Vercel AI SDK                | `generateText` mapped to OCP                                        |
| [`mcp-typescript`](./mcp-typescript/README.md)             | TypeScript | MCP TypeScript SDK           | OCP policy boundary around `callTool`                               |

## Common architecture

```text
provider or UI
    │
    ▼
OCP message.received
    │  actor / recipient / channel / conversation / correlation
    ▼
framework adapter
    │  model / tools / memory / handoffs
    ▼
OCP message.sent or action/policy/approval events
    │
    ▼
provider adapter or application output
```

The framework examples use the same bridge shape:

```text
async function handleOpenChannelMessage(text, context) -> replyText
```

The bridge must preserve OCP event identity and conversation context. A tool
that changes state must go through the OCP runtime's action and policy path;
successful model or MCP output is not authorization.

## Credentials and safety

Copy an example's `.env.example` only when it provides one. Never commit an
API key or production endpoint. Live examples should use a disposable model
and non-destructive tools. For model-free iteration, replace the harness call
with the deterministic handler used by the native examples.

Validate the example layout and all local documentation links with:

```bash
pnpm check:examples
pnpm check:docs
pnpm check:format
```

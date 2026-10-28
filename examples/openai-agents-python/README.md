# OpenAI Agents Python + OCP

Runs one OpenAI Agents SDK `Runner.run` execution behind the Python SDK's `open_channel()`
app and maps the result to an OCP `message.sent` reply. The bridge is self-contained in
`main.py`: it imports only the public `@openchannelprotocol/sdk` API and the `agents` package.

The bridge does not auto-approve SDK interruptions. An interruption must become an explicit
OCP approval, and the run is resumed only through that approval path.

This example makes a live model call and needs an OpenAI API key.

## Prerequisites

- Python 3.11 or later
- An OpenAI API key, created at <https://platform.openai.com/api-keys>
- A checkout of this repository

## Install

From the repository root:

```bash
python3 -m venv .venv-openai-agents
. .venv-openai-agents/bin/activate
python -m pip install -r examples/openai-agents-python/requirements.txt
```

## Run

```bash
export OPENAI_API_KEY=replace-me
PYTHONPATH=sdks/python/src python3 examples/openai-agents-python/main.py
```

Use a disposable key and avoid destructive tools.

## Environment variables

| Variable         | Required | Default       | Purpose                                              |
| ---------------- | -------- | ------------- | ---------------------------------------------------- |
| `OPENAI_API_KEY` | yes      | none          | Read by the Agents SDK for the model call            |
| `OPENAI_MODEL`   | no       | `gpt-4o-mini` | Model name passed to the SDK `Agent`                 |

If `OPENAI_API_KEY` is missing, the script raises `RuntimeError: OPENAI_API_KEY is not set`
before any OCP event is created.

## Expected output

One dictionary with the agent card, `eventType` `message.sent`, the inbound
`correlationId`, and the model's text as `reply`. The reply varies with the model:

```text
{'agentCard': {...}, 'eventType': 'message.sent', 'correlationId': '<uuid>', 'reply': '<model answer>'}
```

If the SDK returns an interruption, `reply` is the notice
`The agent requested an interruption; OCP approval is required before continuing.`

## How this maps to OCP

| OCP concept         | In `main.py`                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `message.received`  | `message_received(...)` ingested by `open_channel`                  |
| Harness execution   | `Runner.run(agent, text)` inside the agent handler                  |
| `message.sent`      | `result.final_output` passed to `context.reply(...)`                |
| Approval boundary   | `result.interruptions` stops the automatic path and returns a notice |

The bridge replies with the notice instead of resuming the run with `result.to_state()`.
Resuming requires an explicit OCP approval and executor action result.

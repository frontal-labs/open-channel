# PydanticAI + OCP

Runs a PydanticAI `Agent.run` behind the Python SDK's `open_channel()` app and maps its typed
`result.output` to an OCP `message.sent` event. The bridge is self-contained in `main.py`: it
imports only the public `@openchannelprotocol/sdk` API and `pydantic_ai`.

By default the run is deterministic. It uses PydanticAI's `TestModel`, makes no network call,
and needs no credentials.

## Prerequisites

- Python 3.11 or later
- A checkout of this repository
- For the live mode only: an API key for the chosen model provider (the default live model
  is OpenAI; create a key at <https://platform.openai.com/api-keys>)

## Install

From the repository root:

```bash
python3 -m venv .venv-pydanticai
. .venv-pydanticai/bin/activate
python -m pip install -r examples/pydanticai-python/requirements.txt
```

## Run (deterministic, no credentials)

```bash
PYTHONPATH=sdks/python/src python3 examples/pydanticai-python/main.py
```

## Run (live model, opt-in)

```bash
export OCP_LIVE=1
export OPENAI_API_KEY=replace-me
export OCP_MODEL=openai:gpt-5.2   # optional; this is the default
PYTHONPATH=sdks/python/src python3 examples/pydanticai-python/main.py
```

Use a disposable key and non-destructive tools.

## Environment variables

| Variable         | Required        | Default          | Purpose                                                   |
| ---------------- | --------------- | ---------------- | --------------------------------------------------------- |
| `OCP_LIVE`       | no              | unset            | Set to `1` to call a live model instead of `TestModel`    |
| `OCP_MODEL`      | no              | `openai:gpt-5.2` | PydanticAI model string, used only when `OCP_LIVE=1`      |
| `OPENAI_API_KEY` | when `OCP_LIVE=1` and the model is `openai:*` | none | Read by PydanticAI for OpenAI models          |

Other PydanticAI model strings are passed through unchanged. Their provider credentials are read
by PydanticAI.

With `OCP_LIVE=1` and an `openai:` model, a missing `OPENAI_API_KEY` stops the run with a
`RuntimeError` naming the variable, before any OCP event is created.

## Expected output

Deterministic mode prints one dictionary with `eventType` `message.sent` and the reply:

```text
{'agentCard': {...}, 'eventType': 'message.sent', 'correlationId': '<uuid>', 'reply': 'Deterministic PydanticAI reply.'}
```

Live mode prints the same shape, and `reply` is the model's answer, which varies by run.

## How this maps to OCP

| OCP concept        | In `main.py`                                                  |
| ------------------ | ------------------------------------------------------------- |
| `message.received` | `message_received(...)` ingested by `open_channel`            |
| Harness execution  | `agent.run(text)` inside the agent handler                    |
| `message.sent`     | `result.output`, converted to text, passed to `context.reply` |

Structured-output validation stays in PydanticAI. Event and envelope validation stay in OCP.

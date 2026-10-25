# CrewAI + OCP

Runs a one-task CrewAI crew for each OCP message and maps the crew's result to a
`message.sent` event. The bridge is self-contained in `main.py`: it imports only the public
`ocp-sdk` API and `crewai`.

Each message gets a fresh crew, so task inputs stay scoped to that message. A reusable crew can
suit a controlled workload, but its task inputs and mutable tools must be scoped to the OCP
conversation and policy context.

This example makes a live model call and needs an OpenAI API key.

## Prerequisites

- Python 3.11 or later
- An OpenAI API key, created at <https://platform.openai.com/api-keys>
- A checkout of this repository

## Install

From the repository root:

```bash
python3 -m venv .venv-crewai
. .venv-crewai/bin/activate
python -m pip install -r examples/crewai-python/requirements.txt
```

## Run

```bash
export OPENAI_API_KEY=replace-me
PYTHONPATH=sdks/python/src python3 examples/crewai-python/main.py
```

Use a disposable key and avoid destructive tools.

## Environment variables

| Variable         | Required | Default | Purpose                                                     |
| ---------------- | -------- | ------- | ----------------------------------------------------------- |
| `OPENAI_API_KEY` | yes      | none    | Read by CrewAI for the model call                           |

If `OPENAI_API_KEY` is missing, the script raises `RuntimeError: OPENAI_API_KEY is not set`
before any OCP event is created.

## Expected output

One dictionary with the agent card, `eventType` `message.sent`, the inbound `correlationId`,
and the crew's text as `reply`. The reply varies with the model:

```text
{'agentCard': {...}, 'eventType': 'message.sent', 'correlationId': '<uuid>', 'reply': '<crew answer>'}
```

## How this maps to OCP

| OCP concept        | In `main.py`                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `message.received` | `message_received(...)` ingested by `open_channel`                      |
| Orchestration      | `Crew.akickoff(inputs={"message": ...})` inside the agent handler       |
| `message.sent`     | `CrewOutput.raw`, converted to text, passed to `context.reply(...)`     |

`Crew.akickoff` owns agent orchestration. OCP owns event identity, delivery, authorization, and
approval. Do not put an unrestricted destructive tool on the worker without routing it through
an OCP action policy.

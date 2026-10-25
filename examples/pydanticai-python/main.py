"""PydanticAI agent behind the OCP Python SDK.

Maps a PydanticAI `Agent.run` call onto OCP messages:

    message.received -> agent.run(text) -> result.output -> context.reply() -> message.sent

By default the agent uses PydanticAI's deterministic `TestModel`, so the run makes no network call
and needs no credentials. To call a live model, set `OCP_LIVE=1`. `OCP_MODEL` picks the model
string (default `openai:gpt-5.2`). For `openai:` models, `OPENAI_API_KEY` must be set; the script
exits with an error naming it when it is missing. Other providers read their own credentials
through PydanticAI.

The event store and channel sink are example-only. Production apps pass a durable store to
`open_channel(store=...)` and a real channel sink.

Run from the repository root:

    PYTHONPATH=sdks/python/src python3 examples/pydanticai-python/main.py
"""

from __future__ import annotations

import asyncio
import inspect
import os
from collections.abc import Awaitable, Callable
from typing import Any

from ocp_sdk import (
    ActorRef,
    AgentDefinition,
    ChannelDefinition,
    EventEnvelope,
    PolicyDecision,
    event_type,
    message_received,
    open_channel,
)
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel

PROVIDER = "ocp-example"
AGENT_NAME = "PydanticAI Agent"
SYSTEM_PROMPT = "You are a concise assistant operating behind an OCP boundary."
TEST_MODEL_REPLY = "Deterministic PydanticAI reply."
CHANNEL_ID = "example"
HUMAN_ID = "human:example"
HUMAN_NAME = "Example User"
PROMPT = "Explain why OCP keeps policy outside the model prompt."

ENV_OCP_LIVE = "OCP_LIVE"
ENV_OCP_MODEL = "OCP_MODEL"
DEFAULT_OCP_MODEL = "openai:gpt-5.2"
ENV_OPENAI_API_KEY = "OPENAI_API_KEY"
OPENAI_KEY_URL = "https://platform.openai.com/api-keys"
OPENAI_PREFIX = "openai:"

TextAgent = Callable[[str], str | Awaitable[str]]


class MemoryStore:
    """Example-only event store. Production apps pass a durable store to `open_channel`."""

    def __init__(self) -> None:
        self._events: dict[str, EventEnvelope] = {}

    async def append_if_absent(self, event: EventEnvelope) -> bool:
        """Store the event unless its ID is already present. Return True when it was stored."""
        if event.event_id in self._events:
            return False
        self._events[event.event_id] = event
        return True

    async def all(self) -> list[EventEnvelope]:
        """Return every stored event in insertion order."""
        return list(self._events.values())

    async def close(self) -> None:
        """Release resources. The in-memory store holds none."""
        return None


async def run_ocp_text_agent(name: str, handler: TextAgent) -> None:
    """Run a text harness behind an OCP app. The agent replies through the channel sink.

    Args:
        name: Agent name. The agent ID is derived as `agent:<name>`.
        handler: Callable that maps the inbound text to a reply. It may be sync or async.

    Raises:
        RuntimeError: If the app does not dispatch a `message.sent` reply.
    """

    dispatched: list[EventEnvelope] = []

    async def on_message(context: Any) -> None:
        """Agent handler: call `handler` with the inbound text and reply with its result."""
        response = handler(context.message.text)
        if inspect.isawaitable(response):
            response = await response
        await context.reply(str(response))

    class ExampleSink:
        """Example channel sink that collects outbound events in `dispatched`."""

        provider = PROVIDER

        async def send(self, event: EventEnvelope, options: Any = None) -> None:
            """Record the outbound event instead of delivering it."""
            dispatched.append(event)

    app = open_channel(
        store=MemoryStore(),
        policy=lambda *_args: PolicyDecision(allowed=True),
        agents=[
            AgentDefinition(
                id=f"agent:{name}",
                name=name,
                description=f"OCP bridge for {name}",
                on_message=on_message,
            )
        ],
        channels=[ChannelDefinition(PROVIDER, sink=ExampleSink())],
    )
    event = message_received(
        actor=ActorRef(id=HUMAN_ID, type="ACTOR_TYPE_HUMAN", display_name=HUMAN_NAME),
        recipient=ActorRef(id=f"agent:{name}", display_name=name),
        channel={"provider": PROVIDER, "channelId": CHANNEL_ID},
        text=PROMPT,
    )

    await app.ingest(event)
    if not dispatched:
        raise RuntimeError("The OCP bridge did not dispatch a message.sent reply")

    print(
        {
            "agentCard": app.agent_cards()[0].to_json(),
            "eventType": event_type(dispatched[0]),
            "correlationId": dispatched[0].correlation_id,
            "reply": dispatched[0].payload["messageSent"]["text"],
        }
    )


def build_agent() -> Agent:
    """Return the PydanticAI agent.

    Uses the deterministic `TestModel` unless `OCP_LIVE=1`. With `OCP_LIVE=1`, uses the model named
    by `OCP_MODEL` and checks `OPENAI_API_KEY` first when the model is an `openai:` model.

    Raises:
        RuntimeError: If `OCP_LIVE=1` selects an `openai:` model and the key is not set.
    """

    if os.getenv(ENV_OCP_LIVE) != "1":
        return Agent(
            TestModel(custom_output_text=TEST_MODEL_REPLY),
            system_prompt=SYSTEM_PROMPT,
        )

    model = os.getenv(ENV_OCP_MODEL, DEFAULT_OCP_MODEL)
    if model.startswith(OPENAI_PREFIX) and not os.getenv(ENV_OPENAI_API_KEY):
        raise RuntimeError(
            f"{ENV_OPENAI_API_KEY} is not set, but {ENV_OCP_LIVE}=1 selects {model}. "
            f"Create a key at {OPENAI_KEY_URL}, then export {ENV_OPENAI_API_KEY}=..., "
            f"or unset {ENV_OCP_LIVE} to use the deterministic TestModel."
        )
    return Agent(model, system_prompt=SYSTEM_PROMPT)


async def main() -> None:
    """Build the PydanticAI agent and run one OCP-bridged message through it."""
    agent = build_agent()

    async def handle(text: str) -> str:
        """Run the agent on `text` and return its typed output as text."""
        result = await agent.run(text)
        return str(result.output)

    await run_ocp_text_agent(AGENT_NAME, handle)


if __name__ == "__main__":
    asyncio.run(main())

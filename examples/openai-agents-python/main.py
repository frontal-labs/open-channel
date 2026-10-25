"""OpenAI Agents SDK harness behind the OCP Python SDK.

Maps one `Runner.run` execution onto OCP messages:

    message.received -> Runner.run(agent, text) -> result.final_output -> context.reply()
        -> message.sent

The bridge deliberately does not auto-approve SDK interruptions. If `result.interruptions` is set,
the reply is a notice instead of the model output, and an OCP approval must be requested and
resumed explicitly.

This example makes a live OpenAI model call, so it requires `OPENAI_API_KEY`. It exits with an
error naming the variable when the key is missing. Set `OPENAI_MODEL` to change the model.

The event store and channel sink are example-only. Production apps pass a durable store to
`open_channel(store=...)` and a real channel sink.

Run from the repository root:

    PYTHONPATH=sdks/python/src python3 examples/openai-agents-python/main.py
"""

from __future__ import annotations

import asyncio
import inspect
import os
from collections.abc import Awaitable, Callable
from typing import Any

from agents import Agent, Runner
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

PROVIDER = "ocp-example"
AGENT_NAME = "OpenAI Agents Python"
AGENT_INSTRUCTIONS = "Answer briefly and explain safety boundaries when asked."
AGENT_DISPLAY_NAME = "OpenAI OCP Agent"
HUMAN_ID = "human:example"
HUMAN_NAME = "Example User"
CHANNEL_ID = "example"
PROMPT = "Explain why OCP keeps policy outside the model prompt."
INTERRUPTION_NOTICE = (
    "The agent requested an interruption; OCP approval is required before continuing."
)

ENV_OPENAI_API_KEY = "OPENAI_API_KEY"
ENV_OPENAI_MODEL = "OPENAI_MODEL"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
OPENAI_KEY_URL = "https://platform.openai.com/api-keys"

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


def require_openai_key() -> None:
    """Raise `RuntimeError` naming `OPENAI_API_KEY` and where to create it if it is not set.

    The check runs before any OCP event is created.
    """
    if not os.getenv(ENV_OPENAI_API_KEY):
        raise RuntimeError(
            f"{ENV_OPENAI_API_KEY} is not set. This example calls the OpenAI Agents SDK model "
            f"and needs a key from {OPENAI_KEY_URL}: export {ENV_OPENAI_API_KEY}=... and run again."
        )


def build_agent() -> Agent:
    """Return the OpenAI Agents SDK agent. The model is `OPENAI_MODEL` (default gpt-4o-mini)."""
    return Agent(
        name=AGENT_DISPLAY_NAME,
        instructions=AGENT_INSTRUCTIONS,
        model=os.getenv(ENV_OPENAI_MODEL, DEFAULT_OPENAI_MODEL),
    )


async def main() -> None:
    """Check the key, build the SDK agent, and run one OCP-bridged message through it."""
    require_openai_key()
    agent = build_agent()

    async def handle(text: str) -> str:
        """Run the agent on `text`. Return a notice instead when an interruption occurs."""
        result = await Runner.run(agent, text)
        if result.interruptions:
            return INTERRUPTION_NOTICE
        return str(result.final_output)

    await run_ocp_text_agent(AGENT_NAME, handle)


if __name__ == "__main__":
    asyncio.run(main())

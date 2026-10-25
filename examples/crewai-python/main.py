"""CrewAI crew behind the OCP Python SDK.

Maps one CrewAI crew execution onto OCP messages:

    message.received -> Crew.akickoff(inputs={"message": text}) -> result.raw
        -> context.reply() -> message.sent

A new one-task crew is built for each message, so task inputs stay scoped to that message. OCP
owns event identity, delivery, authorization, and approval; CrewAI owns agent orchestration.

This example makes a live model call through CrewAI, so it requires `OPENAI_API_KEY`. It exits
with an error naming the variable when the key is missing. The event store and channel sink are
example-only; production apps pass a durable store and a real channel sink.

Run from the repository root:

    PYTHONPATH=sdks/python/src python3 examples/crewai-python/main.py
"""

from __future__ import annotations

import asyncio
import inspect
import os
from collections.abc import Awaitable, Callable
from typing import Any

from crewai import Agent, Crew, Task
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
AGENT_NAME = "CrewAI Agent"
WORKER_ROLE = "OCP response agent"
WORKER_GOAL = "Answer one incoming OCP message clearly and safely"
WORKER_BACKSTORY = "You work behind a provider-neutral protocol boundary."
TASK_DESCRIPTION = "Answer the incoming OCP message: {message}"
TASK_EXPECTED_OUTPUT = "A concise text answer."
CHANNEL_ID = "example"
HUMAN_ID = "human:example"
HUMAN_NAME = "Example User"
PROMPT = "Explain why OCP keeps policy outside the model prompt."

ENV_OPENAI_API_KEY = "OPENAI_API_KEY"
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
            f"{ENV_OPENAI_API_KEY} is not set. CrewAI calls a model for each task and needs a "
            f"key from {OPENAI_KEY_URL}: export {ENV_OPENAI_API_KEY}=... and run again."
        )


def build_crew() -> Crew:
    """Build a one-task crew scoped to a single OCP message."""

    worker = Agent(
        role=WORKER_ROLE,
        goal=WORKER_GOAL,
        backstory=WORKER_BACKSTORY,
        verbose=False,
    )
    task = Task(
        description=TASK_DESCRIPTION,
        expected_output=TASK_EXPECTED_OUTPUT,
        agent=worker,
    )
    return Crew(agents=[worker], tasks=[task], verbose=False)


async def main() -> None:
    """Check the key, then run one OCP-bridged message through a fresh one-task crew."""
    require_openai_key()

    async def handle(text: str) -> str:
        """Build a crew for this message, run it, and return the raw task output."""
        crew = build_crew()
        result = await crew.akickoff(inputs={"message": text})
        return str(result.raw)

    await run_ocp_text_agent(AGENT_NAME, handle)


if __name__ == "__main__":
    asyncio.run(main())

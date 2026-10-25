"""Native Python OCP example.

Maps to the core OCP loop with the Python SDK and no model provider:

    message.received -> agent handler -> context.reply() -> message.sent -> channel sink

The run is deterministic and needs no network access or credentials. It prints one JSON document
with the agent card, the inbound `message.received` event ID, and the outbound `message.sent`
event. The event store and channel sink below are demo-only in-memory objects; production apps
pass a durable store to `open_channel(store=...)` and a real channel sink.

Run from the repository root:

    PYTHONPATH=sdks/python/src python3 examples/native-python/main.py
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
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

PROVIDER = "ocp-example"
AGENT_ID = "agent:native-python"
AGENT_NAME = "Native Python Agent"
AGENT_DESCRIPTION = "Deterministic OCP agent for the native Python example"
CHANNEL_ID = "example"
CONVERSATION_ID = "conversation:example"
HUMAN_ID = "human:example"
HUMAN_NAME = "Example User"
PROMPT = "Explain why OCP keeps policy outside the model prompt."


class DemoMemoryStore:
    """Demo-only in-memory event store. It keeps events for this process and is not durable."""

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


class DemoSink:
    """Demo-only channel sink that records outbound events instead of calling a provider."""

    provider = PROVIDER

    def __init__(self) -> None:
        self.sent: list[EventEnvelope] = []

    async def send(self, event: EventEnvelope, options: Mapping[str, object] | None = None) -> None:
        """Record the outbound event in `self.sent` instead of delivering it."""
        self.sent.append(event)

    async def close(self) -> None:
        """Release resources. The demo sink holds none."""
        return None


def deterministic_reply(text: str) -> str:
    """Return a fixed reply that echoes the inbound text. Replace this with a framework call."""
    return f"Deterministic response to: {text}"


async def main() -> None:
    """Build the OCP app, ingest one message, and print the agent card and reply as JSON.

    Raises:
        RuntimeError: If the app does not dispatch a `message.sent` reply.
    """
    sink = DemoSink()

    async def on_message(context: Any) -> None:
        """Agent handler: reply to the inbound message text."""
        await context.reply(deterministic_reply(context.message.text))

    app = open_channel(
        store=DemoMemoryStore(),
        policy=lambda *_args: PolicyDecision(allowed=True),
        agents=[
            AgentDefinition(
                id=AGENT_ID,
                name=AGENT_NAME,
                description=AGENT_DESCRIPTION,
                on_message=on_message,
            )
        ],
        channels=[ChannelDefinition(PROVIDER, sink=sink)],
    )

    inbound = message_received(
        actor=ActorRef(id=HUMAN_ID, type="ACTOR_TYPE_HUMAN", display_name=HUMAN_NAME),
        recipient=ActorRef(id=AGENT_ID, type="ACTOR_TYPE_AGENT", display_name=AGENT_NAME),
        channel={"provider": PROVIDER, "channelId": CHANNEL_ID},
        conversation={"conversationId": CONVERSATION_ID},
        text=PROMPT,
    )

    await app.ingest(inbound)
    if not sink.sent:
        raise RuntimeError("The OCP app did not dispatch a message.sent reply")

    reply = sink.sent[0]
    print(
        json.dumps(
            {
                "agentCard": app.agent_cards()[0].to_json(),
                "received": {
                    "eventType": event_type(inbound),
                    "eventId": inbound.event_id,
                },
                "sent": {
                    "eventType": event_type(reply),
                    "correlationId": reply.correlation_id,
                    "causationId": reply.causation_id,
                    "text": reply.payload["messageSent"]["text"],
                },
            },
            indent=2,
        )
    )
    await app.stop()


if __name__ == "__main__":
    asyncio.run(main())

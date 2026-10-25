"""LlamaIndex FunctionAgent behind the OCP Python SDK.

Maps a LlamaIndex workflow `FunctionAgent` onto OCP messages:

    message.received -> agent.run(text) -> str(result) -> context.reply() -> message.sent

This example makes a live OpenAI model call, so it requires `OPENAI_API_KEY`. It exits with an
error naming the variable when the key is missing. Set `OPENAI_MODEL` to change the model.

The event store and channel sink below are demo-only in-memory objects. Production apps pass a
durable store to `open_channel(store=...)` and a real channel sink.

Run from the repository root:

    PYTHONPATH=sdks/python/src python3 examples/llamaindex-python/main.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Mapping
from typing import Any

from llama_index.core.agent.workflow import FunctionAgent
from llama_index.llms.openai import OpenAI
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
AGENT_ID = "agent:llamaindex-python"
AGENT_NAME = "LlamaIndex Agent"
AGENT_DESCRIPTION = "LlamaIndex FunctionAgent mapped to OCP messages"
CHANNEL_ID = "example"
CONVERSATION_ID = "conversation:example"
HUMAN_ID = "human:example"
HUMAN_NAME = "Example User"
DEFAULT_PROMPT = "Explain why OCP keeps policy outside the model prompt."
SYSTEM_PROMPT = "You are a concise assistant operating behind an OCP boundary."

ENV_OPENAI_API_KEY = "OPENAI_API_KEY"
ENV_OPENAI_MODEL = "OPENAI_MODEL"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
OPENAI_KEY_URL = "https://platform.openai.com/api-keys"


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


def require_openai_key() -> None:
    """Exit with status 1 and a clear message if `OPENAI_API_KEY` is not set.

    The check runs before any OCP event is created, so a missing key leaves no partial state.
    """
    if not os.getenv(ENV_OPENAI_API_KEY):
        print(
            f"{ENV_OPENAI_API_KEY} is not set. Create a key at {OPENAI_KEY_URL}, then export it:\n"
            f"  export {ENV_OPENAI_API_KEY}=<your key>\n"
            "This example makes a live model call and does not run without credentials.",
            file=sys.stderr,
        )
        raise SystemExit(1)


async def main() -> None:
    """Build the FunctionAgent and OCP app, ingest one message, and print the reply as JSON.

    Raises:
        SystemExit: If `OPENAI_API_KEY` is missing.
        RuntimeError: If the app does not dispatch a `message.sent` reply.
    """
    require_openai_key()

    agent = FunctionAgent(
        llm=OpenAI(model=os.getenv(ENV_OPENAI_MODEL, DEFAULT_OPENAI_MODEL)),
        system_prompt=SYSTEM_PROMPT,
    )
    sink = DemoSink()

    async def on_message(context: Any) -> None:
        """Agent handler: run the FunctionAgent on the inbound text and reply with its answer."""
        # str() of the AgentOutput returns the final assistant message text.
        result = await agent.run(context.message.text)
        await context.reply(str(result))

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
        text=DEFAULT_PROMPT,
    )

    await app.ingest(inbound)
    if not sink.sent:
        raise RuntimeError("The OCP app did not dispatch a message.sent reply")

    reply = sink.sent[0]
    print(
        json.dumps(
            {
                "agentCard": app.agent_cards()[0].to_json(),
                "received": {"eventType": event_type(inbound), "eventId": inbound.event_id},
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

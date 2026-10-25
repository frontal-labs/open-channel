"""Test-only helpers. The SDK does not ship a default store; tests pass one explicitly."""

from __future__ import annotations

from ocp_sdk import EventEnvelope


class InMemoryStore:
    """Atomic append-only event store kept in process memory."""

    def __init__(self) -> None:
        self._events: dict[str, EventEnvelope] = {}

    async def append_if_absent(self, event: EventEnvelope) -> bool:
        if event.event_id in self._events:
            return False
        self._events[event.event_id] = event
        return True

    async def all(self) -> list[EventEnvelope]:
        return list(self._events.values())

    async def close(self) -> None:
        return None

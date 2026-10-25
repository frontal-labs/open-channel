import unittest
from datetime import datetime

from ocp_sdk import (
    ActorRef,
    AgentDefinition,
    AuthorizationError,
    ChannelDefinition,
    DeliveryReceipt,
    EventEnvelope,
    PolicyDecision,
    action,
    approval_requested,
    from_binary,
    message_received,
    open_channel,
    to_binary,
)
from support import InMemoryStore

HUMAN = ActorRef("human:gabriel", type="ACTOR_TYPE_HUMAN")
CHANNEL = {"provider": "memory", "channelId": "room-1"}


def _increment_action(executions: list[int]):
    return action(
        type="counter.increment",
        execute=lambda value, _ctx: executions.append(value["value"]) or value["value"] + 1,
    )


class OpenChannelAppTests(unittest.IsolatedAsyncioTestCase):
    async def test_agent_replies_through_the_channel_sink(self) -> None:
        delivered: list[EventEnvelope] = []

        class Sink:
            provider = "memory"

            async def send(self, event, _options=None):
                delivered.append(event)
                return DeliveryReceipt("memory", event.event_id, datetime.now())

        async def on_message(ctx) -> None:
            await ctx.reply(f"Received: {ctx.message.text}")

        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:support", name="Support", on_message=on_message)],
            channels=[ChannelDefinition("memory", sink=Sink())],
        )
        event = message_received(
            actor=HUMAN, recipient=ActorRef("agent:support"), channel=CHANNEL, text="Can you help?"
        )

        self.assertTrue(await app.ingest(event))
        self.assertEqual(len(delivered), 1)
        self.assertEqual(delivered[0].payload["messageSent"]["text"], "Received: Can you help?")

    async def test_agent_cards_and_duplicate_registration(self) -> None:
        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:triage", name="Triage", on_message=lambda _: None)],
        )
        self.assertEqual(app.agent_cards()[0].name, "Triage")
        with self.assertRaises(ValueError):
            app.add_agent(
                AgentDefinition(id="agent:triage", name="Again", on_message=lambda _: None)
            )

    async def test_on_observes_accepted_events_until_unsubscribed(self) -> None:
        seen: list[str] = []
        app = open_channel(
            store=InMemoryStore(), policy=lambda *_args: PolicyDecision(allowed=True)
        )
        unsubscribe = app.on("message.received", lambda event: seen.append(event.event_id))
        first = message_received(text="one", actor=HUMAN, channel=CHANNEL)
        await app.ingest(first)
        unsubscribe()
        await app.ingest(message_received(text="two", actor=HUMAN, channel=CHANNEL))
        self.assertEqual(seen, [first.event_id])

    async def test_agent_requests_registered_action_under_policy(self) -> None:
        executions: list[int] = []
        results: dict[str, object] = {}

        async def on_message(ctx) -> None:
            results["result"] = await ctx.request("counter.increment", {"value": 2})

        app = open_channel(
            store=InMemoryStore(),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            actions=[_increment_action(executions)],
            policy=lambda *_args: PolicyDecision(allowed=True),
        )
        event = message_received(
            actor=HUMAN, recipient=ActorRef("agent:app"), channel=CHANNEL, text="increment"
        )

        await app.ingest(event)
        self.assertEqual(executions, [2])
        self.assertEqual(results["result"].status, "executed")

    async def _request_approval(self, approver: ActorRef | None, executions: list[int]):
        approvals: dict[str, object] = {}

        async def on_message(ctx) -> None:
            approvals["result"] = await ctx.request("counter.increment", {"value": 1})

        app = open_channel(
            store=InMemoryStore(),
            agents=[AgentDefinition(id="agent:approve", name="Approve", on_message=on_message)],
            actions=[_increment_action(executions)],
            policy=lambda *_args: PolicyDecision(
                allowed=True, approval_required=True, approver=approver
            ),
        )
        event = message_received(
            actor=ActorRef("human:requester", type="ACTOR_TYPE_HUMAN"),
            recipient=ActorRef("agent:approve"),
            channel=CHANNEL,
            text="increment",
        )
        await app.ingest(event)
        result = approvals["result"]
        self.assertEqual(result.status, "approval_required")
        return app, result.approval_id

    async def test_approval_is_only_decided_by_designated_approver(self) -> None:
        executions: list[int] = []
        approver = ActorRef("human:approver", type="ACTOR_TYPE_HUMAN")
        app, approval_id = await self._request_approval(approver, executions)

        intruder = ActorRef("human:intruder", type="ACTOR_TYPE_HUMAN")
        with self.assertRaises(AuthorizationError):
            await app.approve(approval_id, intruder)
        with self.assertRaises(AuthorizationError):
            await app.deny(approval_id, intruder)
        self.assertEqual(executions, [])

        # A rejected attempt must not consume the pending approval.
        result = await app.approve(approval_id, approver)
        self.assertEqual(result.status, "executed")
        self.assertEqual(executions, [1])

    async def test_approval_defaults_to_runtime_actor(self) -> None:
        executions: list[int] = []
        app, approval_id = await self._request_approval(None, executions)

        with self.assertRaises(AuthorizationError):
            await app.deny(approval_id, ActorRef("human:intruder", type="ACTOR_TYPE_HUMAN"))
        result = await app.deny(approval_id, ActorRef("ocp.runtime", type="ACTOR_TYPE_SYSTEM"))
        self.assertEqual(result.status, "blocked")
        self.assertEqual(executions, [])

    async def test_rejects_forged_approval_events_on_ingest(self) -> None:
        app = open_channel(
            store=InMemoryStore(), policy=lambda *_args: PolicyDecision(allowed=True)
        )
        forged = approval_requested(
            agent=ActorRef("agent:forged"),
            approver=ActorRef("human:approver", type="ACTOR_TYPE_HUMAN"),
            approval_id="forged-approval",
            reason="forged",
            requested_action={"type": "counter.increment", "input": {}},
            deadline="2030-01-01T00:00:00Z",
        )

        with self.assertRaises(AuthorizationError):
            await app.ingest(forged)
        self.assertEqual(app._pending, {})

    async def test_source_sink_lifecycle_and_duplicate_delivery(self) -> None:
        delivered: list[EventEnvelope] = []
        lifecycle: list[str] = []
        inbound = message_received(
            actor=ActorRef("human:source", type="ACTOR_TYPE_HUMAN"),
            channel={"provider": "memory", "channelId": "source"},
            recipient=ActorRef("agent:source"),
            text="hello",
        )

        class Source:
            provider = "memory"

            async def normalize(self, _value, _metadata=None):
                return inbound

            async def start(self, _emit):
                lifecycle.append("start")

            async def stop(self):
                lifecycle.append("stop")

        class Sink:
            provider = "memory"

            async def send(self, event, _options=None):
                delivered.append(event)
                return DeliveryReceipt("memory", event.event_id, datetime.now())

            async def close(self):
                lifecycle.append("close")

        async def on_message(ctx) -> None:
            await ctx.reply("reply")

        app = open_channel(
            store=InMemoryStore(),
            agents=[AgentDefinition(id="agent:source", name="Source", on_message=on_message)],
            channels=[ChannelDefinition("memory", source=Source(), sink=Sink())],
            policy=lambda *_args: PolicyDecision(allowed=True),
        )
        await app.start()
        first = (await app.receive("memory", {}))[0]
        second = (await app.receive("memory", {}))[0]
        await app.stop()

        self.assertFalse(first.duplicate)
        self.assertTrue(second.duplicate)
        self.assertEqual(len(delivered), 1)
        self.assertEqual(lifecycle, ["start", "stop", "close"])

    async def test_binary_round_trip_needs_no_version(self) -> None:
        event = message_received(text="hello", actor=HUMAN, channel=CHANNEL)
        self.assertEqual(from_binary(to_binary(event)).payload_case, "messageReceived")


if __name__ == "__main__":
    unittest.main()

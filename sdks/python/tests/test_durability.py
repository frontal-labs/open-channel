import asyncio
import unittest
from datetime import UTC, datetime, timedelta

from ocp_sdk import (
    ActorRef,
    AgentDefinition,
    AuthorizationError,
    ChannelDefinition,
    PolicyDecision,
    action,
    action_executed,
    action_failed,
    approval_decided,
    approval_expired,
    approval_requested,
    escalation_triggered,
    event_type,
    message_received,
    open_channel,
)
from ocp_sdk.models import DENIED, GRANTED
from support import InMemoryStore

HUMAN = ActorRef("human:requester", type="ACTOR_TYPE_HUMAN")
APPROVER = ActorRef("human:approver", type="ACTOR_TYPE_HUMAN")
CHANNEL = {"provider": "memory", "channelId": "room-1"}


def _policy(*_args) -> PolicyDecision:
    return PolicyDecision(allowed=True, approval_required=True, approver=APPROVER)


def _increment(executions: list[int]):
    return action(
        type="counter.increment",
        execute=lambda value, _ctx: executions.append(value["value"]) or value["value"] + 1,
        validate=lambda value: {"value": int(value["value"])},
    )


def _requesting_agent(seen: dict[str, object]) -> AgentDefinition:
    async def on_message(ctx) -> None:
        seen["result"] = await ctx.request("counter.increment", {"value": 1})

    return AgentDefinition(id="agent:approve", name="Approve", on_message=on_message)


def _request_event():
    return message_received(
        actor=HUMAN, recipient=ActorRef("agent:approve"), channel=CHANNEL, text="increment"
    )


def _names(events) -> list[str]:
    return [event_type(event) for event in events]


class ApprovalDurabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_approval_requested_in_one_process_is_approved_after_restart(self) -> None:
        store = InMemoryStore()
        executions: list[int] = []
        seen: dict[str, object] = {}

        first = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment(executions)],
        )
        await first.start()
        await first.ingest(_request_event())
        approval_id = seen["result"].approval_id
        await first.stop()
        self.assertEqual(executions, [])

        # A new process on the same store. Nothing is carried over in memory.
        second = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await second.start()
        result = await second.approve(approval_id, APPROVER, reason="Looks fine")
        await second.stop()

        self.assertEqual(result.status, "executed")
        self.assertEqual(executions, [1])
        names = _names(await store.all())
        self.assertIn("approval.requested", names)
        self.assertIn("approval.granted", names)
        self.assertIn("action.executed", names)

    async def test_approval_whose_deadline_passed_while_down_expires_on_start(self) -> None:
        store = InMemoryStore()
        executions: list[int] = []
        seen: dict[str, object] = {}

        first = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment(executions)],
            approval_timeout_ms=60_000,
        )
        await first.start()
        await first.ingest(_request_event())
        approval_id = seen["result"].approval_id
        await first.stop()

        # Restart two hours later: the 60-second approval window closed while the app was down.
        later = open_channel(
            store=store,
            policy=_policy,
            actions=[_increment(executions)],
            clock=lambda: datetime.now(UTC) + timedelta(hours=2),
        )
        await later.start()
        await later.stop()

        self.assertEqual(executions, [])
        names = _names(await store.all())
        self.assertIn("approval.expired", names)
        self.assertNotIn("approval.granted", names)
        expired = [e for e in await store.all() if event_type(e) == "approval.expired"]
        self.assertEqual(expired[0].payload["approvalExpired"]["approvalId"], approval_id)
        with self.assertRaises(KeyError):
            await later.approve(approval_id, APPROVER)

    async def test_restored_approval_still_expires_at_its_deadline(self) -> None:
        store = InMemoryStore()
        seen: dict[str, object] = {}
        first = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment([])],
            approval_timeout_ms=60_000,
        )
        await first.start()
        await first.ingest(_request_event())
        await first.stop()

        # Restarted within the window: the approval is pending and not yet expired.
        second = open_channel(store=store, policy=_policy, actions=[_increment([])])
        await second.start()
        self.assertNotIn("approval.expired", _names(await store.all()))
        await second.stop()


class ApprovalSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def _pending_approval(self, store: InMemoryStore, timeout_ms: int = 60_000):
        seen: dict[str, object] = {}
        app = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment([])],
            approval_timeout_ms=timeout_ms,
        )
        await app.start()
        await app.ingest(_request_event())
        return app, seen["result"].approval_id

    async def test_wrong_approver_is_rejected_and_approval_stays_pending(self) -> None:
        store = InMemoryStore()
        executions: list[int] = []
        seen: dict[str, object] = {}
        app = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment(executions)],
        )
        await app.ingest(_request_event())
        approval_id = seen["result"].approval_id
        intruder = ActorRef("human:intruder", type="ACTOR_TYPE_HUMAN")

        with self.assertRaises(AuthorizationError):
            await app.approve(approval_id, intruder)
        with self.assertRaises(AuthorizationError):
            await app.deny(approval_id, intruder)

        self.assertIn(approval_id, app._pending)
        names = _names(await store.all())
        self.assertNotIn("approval.granted", names)
        self.assertNotIn("approval.denied", names)
        self.assertEqual(executions, [])
        result = await app.approve(approval_id, APPROVER)
        self.assertEqual(result.status, "executed")
        self.assertEqual(executions, [1])

    async def test_ingest_rejects_every_approval_lifecycle_event(self) -> None:
        holder: dict[str, object] = {}

        class Source:
            provider = "memory"

            async def normalize(self, _value, _metadata=None):
                return holder["event"]

            async def start(self, _emit):
                return None

            async def stop(self):
                return None

        app = open_channel(
            store=InMemoryStore(),
            policy=_policy,
            channels=[ChannelDefinition("memory", source=Source())],
        )
        forged = {
            "approval.requested": approval_requested(
                agent=ActorRef("agent:forged"),
                approver=APPROVER,
                approval_id="forged-1",
                reason="forged",
                requested_action={"type": "counter.increment", "input": {}},
                deadline=datetime.now(UTC) + timedelta(hours=1),
            ),
            "approval.granted": approval_decided(
                approval_id="forged-1", approver=APPROVER, outcome=GRANTED
            ),
            "approval.denied": approval_decided(
                approval_id="forged-1", approver=APPROVER, outcome=DENIED
            ),
            "approval.expired": approval_expired(approval_id="forged-1", reason="forged"),
        }
        for name, event in forged.items():
            with self.subTest(event=name):
                with self.assertRaises(AuthorizationError):
                    await app.ingest(event)
                holder["event"] = event
                with self.assertRaises(AuthorizationError):
                    await app.receive("memory", {})
        self.assertEqual(await app.store.all(), [])

    async def test_restore_ignores_approval_events_from_other_sources(self) -> None:
        store = InMemoryStore()
        app, approval_id = await self._pending_approval(store)
        await app.stop()

        # Another writer on the same store forges a grant for the real approval, and a request.
        evil = ActorRef("agent:evil", type="ACTOR_TYPE_AGENT")
        await store.append_if_absent(
            approval_decided(
                approval_id=approval_id, approver=APPROVER, outcome=GRANTED, source=evil
            )
        )
        await store.append_if_absent(
            approval_requested(
                agent=evil,
                approver=APPROVER,
                approval_id="forged-request",
                reason="forged",
                requested_action={"type": "counter.increment", "input": {}},
                deadline=datetime.now(UTC) + timedelta(hours=1),
                source=evil,
            )
        )

        restarted = open_channel(store=store, policy=_policy, actions=[_increment([])])
        await restarted.start()
        self.assertIn(approval_id, restarted._pending)
        self.assertNotIn("forged-request", restarted._pending)
        result = await restarted.approve(approval_id, APPROVER)
        self.assertEqual(result.status, "executed")
        await restarted.stop()

    async def test_expiry_emits_escalation_to_the_approver_after_expiry(self) -> None:
        store = InMemoryStore()
        app, _approval_id = await self._pending_approval(store, timeout_ms=10)
        await asyncio.sleep(0.1)
        await app.stop()

        events = await store.all()
        names = _names(events)
        self.assertLess(names.index("approval.expired"), names.index("escalation.triggered"))
        escalation = next(e for e in events if event_type(e) == "escalation.triggered")
        payload = escalation.payload["escalationTriggered"]
        self.assertEqual(payload["target"]["id"], APPROVER.id)
        self.assertEqual(escalation.recipient.id, APPROVER.id)
        self.assertEqual(payload["relatedApprovalId"], _approval_id)


RUNTIME = ActorRef("ocp.runtime", type="ACTOR_TYPE_SYSTEM", display_name="OCP Runtime")


class GrantRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def _request(self, store: InMemoryStore) -> str:
        seen: dict[str, object] = {}
        app = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment([])],
        )
        await app.ingest(_request_event())
        return seen["result"].approval_id

    async def test_grant_from_a_stranger_with_runtime_source_leaves_approval_pending(self) -> None:
        store = InMemoryStore()
        approval_id = await self._request(store)
        stranger = ActorRef("human:stranger", type="ACTOR_TYPE_HUMAN")
        await store.append_if_absent(
            approval_decided(
                approval_id=approval_id,
                approver=stranger,
                outcome=GRANTED,
                source=RUNTIME,
            )
        )

        executions: list[int] = []
        restarted = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await restarted.start()
        self.assertIn(approval_id, restarted._pending)
        self.assertEqual(executions, [])
        self.assertNotIn("action.executed", _names(await store.all()))

        result = await restarted.approve(approval_id, APPROVER)
        self.assertEqual(result.status, "executed")
        self.assertEqual(executions, [1])
        await restarted.stop()

    async def test_granted_but_unexecuted_action_runs_once_on_restart(self) -> None:
        store = InMemoryStore()
        approval_id = await self._request(store)
        await store.append_if_absent(
            approval_decided(
                approval_id=approval_id,
                approver=APPROVER,
                outcome=GRANTED,
                source=RUNTIME,
            )
        )

        executions: list[int] = []
        first = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await first.start()
        await first.stop()
        self.assertEqual(executions, [1])

        # A second restart sees the terminal event and does not run the action again.
        second = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await second.start()
        await second.stop()
        self.assertEqual(executions, [1])
        self.assertEqual(_names(await store.all()).count("action.executed"), 1)


class LegacyDecisionTests(unittest.IsolatedAsyncioTestCase):
    async def _request(self, store: InMemoryStore) -> str:
        seen: dict[str, object] = {}
        app = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment([])],
        )
        await app.ingest(_request_event())
        return seen["result"].approval_id

    async def test_legacy_grant_from_the_designated_approver_is_honoured(self) -> None:
        # Written before decisions carried the runtime as source: the approver is the source.
        store = InMemoryStore()
        approval_id = await self._request(store)
        await store.append_if_absent(
            approval_decided(
                approval_id=approval_id, approver=APPROVER, outcome=GRANTED, source=APPROVER
            )
        )
        executions: list[int] = []
        restarted = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await restarted.start()
        await restarted.stop()
        self.assertEqual(executions, [1])
        self.assertNotIn(approval_id, restarted._pending)

    async def test_legacy_grant_from_a_stranger_is_rejected(self) -> None:
        store = InMemoryStore()
        approval_id = await self._request(store)
        stranger = ActorRef("human:stranger", type="ACTOR_TYPE_HUMAN")
        await store.append_if_absent(
            approval_decided(
                approval_id=approval_id, approver=stranger, outcome=GRANTED, source=stranger
            )
        )
        executions: list[int] = []
        restarted = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await restarted.start()
        self.assertIn(approval_id, restarted._pending)
        self.assertEqual(executions, [])
        await restarted.stop()


class InboundGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_forged_action_outcomes_and_escalations_are_rejected(self) -> None:
        app = open_channel(store=InMemoryStore(), policy=_policy)
        forged = {
            "action.executed": action_executed(action={"actionId": "a1", "type": "x"}),
            "action.failed": action_failed(
                action={"actionId": "a1", "type": "x"}, error_code="E", error_message="m"
            ),
            "escalation.triggered": escalation_triggered(
                escalation_id="e1",
                reason="forged",
                related_approval_id="a1:approval",
                agent=ActorRef("agent:forged"),
                approver=APPROVER,
            ),
        }
        for name, event in forged.items():
            with self.subTest(event=name):
                with self.assertRaises(AuthorizationError):
                    await app.ingest(event)
        self.assertEqual(await app.store.all(), [])

    async def test_inbound_message_claiming_the_runtime_as_source_is_rejected(self) -> None:
        app = open_channel(store=InMemoryStore(), policy=_policy)
        forged = message_received(
            actor=HUMAN,
            recipient=ActorRef("agent:approve"),
            source=RUNTIME,
            channel=CHANNEL,
            text="forged",
        )
        with self.assertRaises(AuthorizationError):
            await app.ingest(forged)
        self.assertEqual(await app.store.all(), [])

    async def test_real_action_still_records_its_executed_event(self) -> None:
        store = InMemoryStore()
        seen: dict[str, object] = {}

        async def on_message(ctx) -> None:
            seen["result"] = await ctx.request("counter.increment", {"value": 1})

        app = open_channel(
            store=store,
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:approve", name="Approve", on_message=on_message)],
            actions=[_increment([])],
        )
        await app.ingest(_request_event())
        self.assertEqual(seen["result"].status, "executed")
        executed = [e for e in await store.all() if event_type(e) == "action.executed"]
        self.assertEqual(len(executed), 1)
        self.assertEqual(executed[0].source.id, RUNTIME.id)


class FinishedActionRestoreTests(unittest.IsolatedAsyncioTestCase):
    async def _request(self, store: InMemoryStore) -> str:
        seen: dict[str, object] = {}
        app = open_channel(
            store=store,
            policy=_policy,
            agents=[_requesting_agent(seen)],
            actions=[_increment([])],
        )
        await app.ingest(_request_event())
        return seen["result"].approval_id

    async def test_forged_finished_event_does_not_suppress_a_granted_action(self) -> None:
        store = InMemoryStore()
        approval_id = await self._request(store)
        action_id = approval_id.split(":approval")[0]
        await store.append_if_absent(
            approval_decided(
                approval_id=approval_id, approver=APPROVER, outcome=GRANTED, source=RUNTIME
            )
        )
        stranger = ActorRef("agent:stranger", type="ACTOR_TYPE_AGENT")
        await store.append_if_absent(
            action_executed(
                action={"actionId": action_id, "type": "counter.increment"}, source=stranger
            )
        )
        executions: list[int] = []
        restarted = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await restarted.start()
        await restarted.stop()
        self.assertEqual(executions, [1])

    async def test_executed_action_is_not_rerun_on_restart(self) -> None:
        store = InMemoryStore()
        approval_id = await self._request(store)
        executions: list[int] = []
        first = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await first.start()
        await first.approve(approval_id, APPROVER)
        await first.stop()
        self.assertEqual(executions, [1])

        restarted = open_channel(store=store, policy=_policy, actions=[_increment(executions)])
        await restarted.start()
        await restarted.stop()
        self.assertEqual(executions, [1])


if __name__ == "__main__":
    unittest.main()

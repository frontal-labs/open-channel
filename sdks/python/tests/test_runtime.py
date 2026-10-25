import asyncio
import contextlib
import io
import unittest

from ocp_sdk import (
    ActorRef,
    AgentDefinition,
    ChannelDefinition,
    PolicyDecision,
    ReplyOptions,
    StderrLogger,
    action,
    event_type,
    message_received,
    open_channel,
)
from support import InMemoryStore

HUMAN = ActorRef("human:requester", type="ACTOR_TYPE_HUMAN")
APPROVER = ActorRef("human:approver", type="ACTOR_TYPE_HUMAN")
CHANNEL = {"provider": "memory", "channelId": "room-1"}


def _approval_policy(*_args) -> PolicyDecision:
    return PolicyDecision(allowed=True, approval_required=True)


def _noop_action():
    return action(type="noop", execute=lambda value, _ctx: value)


def _message(conversation: str, recipient: str = "agent:app") -> object:
    return message_received(
        actor=HUMAN,
        recipient=ActorRef(recipient),
        channel=CHANNEL,
        conversation={"id": conversation},
        text="go",
    )


def _payloads(events, name: str, case: str) -> list[dict]:
    return [e.payload[case] for e in events if event_type(e) == name]


class ApprovalReasonTests(unittest.IsolatedAsyncioTestCase):
    async def _approval(self, store: InMemoryStore):
        seen: dict[str, object] = {}

        async def on_message(ctx) -> None:
            seen["result"] = await ctx.request("noop", {"value": 1})

        app = open_channel(
            store=store,
            policy=_approval_policy,
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            actions=[_noop_action()],
            approver=APPROVER,
        )
        await app.ingest(_message("c-1"))
        return app, seen["result"].approval_id

    async def test_approve_reason_is_recorded_on_approval_granted(self) -> None:
        store = InMemoryStore()
        app, approval_id = await self._approval(store)
        await app.approve(approval_id, APPROVER, reason="Checked the release notes")
        granted = _payloads(await store.all(), "approval.granted", "approvalDecided")
        self.assertEqual(granted[0]["reason"], "Checked the release notes")

    async def test_deny_reason_is_recorded_on_approval_denied(self) -> None:
        store = InMemoryStore()
        app, approval_id = await self._approval(store)
        await app.deny(approval_id, APPROVER, reason="Not this week")
        denied = _payloads(await store.all(), "approval.denied", "approvalDecided")
        self.assertEqual(denied[0]["reason"], "Not this week")


class ContextRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_keywords_set_approver_reason_and_action_id(self) -> None:
        store = InMemoryStore()
        seen: dict[str, object] = {}

        async def on_message(ctx) -> None:
            seen["result"] = await ctx.request(
                "noop",
                {"value": 1},
                action_id="act-fixed",
                approver=APPROVER,
                reason="Needs a human",
                target="production",
            )

        app = open_channel(
            store=store,
            policy=lambda *_args: PolicyDecision(allowed=True, approval_required=True),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            actions=[_noop_action()],
        )
        await app.ingest(_message("c-1"))

        result = seen["result"]
        self.assertEqual(result.status, "approval_required")
        self.assertEqual(result.action_id, "act-fixed")
        requested = _payloads(await store.all(), "approval.requested", "approvalRequested")[0]
        self.assertEqual(requested["approver"]["id"], APPROVER.id)
        self.assertEqual(requested["reason"], "Needs a human")
        self.assertEqual(requested["requestedAction"]["target"], "production")

    async def test_request_rejects_unknown_keyword(self) -> None:
        async def on_message(ctx) -> None:
            with self.assertRaises(TypeError):
                await ctx.request("noop", {}, options={"approver": APPROVER})

        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            actions=[_noop_action()],
        )
        await app.ingest(_message("c-1"))


class ConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def _peak(self, concurrency: int | None) -> int:
        active = 0
        peak = 0

        async def on_message(_ctx) -> None:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1

        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            concurrency=concurrency,
        )
        await asyncio.gather(*(app.ingest(_message(f"c-{i}")) for i in range(3)))
        return peak

    async def test_concurrency_caps_conversations_in_flight(self) -> None:
        self.assertEqual(await self._peak(concurrency=1), 1)

    async def test_without_concurrency_conversations_overlap(self) -> None:
        self.assertEqual(await self._peak(concurrency=None), 3)


class LoggerTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_logger_writes_only_warn_and_error_to_stderr(self) -> None:
        async def on_message(ctx) -> None:
            ctx.logger.debug("debug-line")
            ctx.logger.info("info-line")
            ctx.logger.warn("warn-line", attempt=2)
            ctx.logger.error("error-line")

        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
        )
        captured = io.StringIO()
        with contextlib.redirect_stderr(captured):
            await app.ingest(_message("c-1"))
        output = captured.getvalue()
        self.assertIn("WARN warn-line {'attempt': 2}", output)
        self.assertIn("ERROR error-line", output)
        self.assertNotIn("debug-line", output)
        self.assertNotIn("info-line", output)

    async def test_custom_logger_receives_agent_calls(self) -> None:
        calls: list[tuple[str, str]] = []

        class Recording:
            def debug(self, message, **details):
                calls.append(("debug", message))

            def info(self, message, **details):
                calls.append(("info", message))

            def warn(self, message, **details):
                calls.append(("warn", message))

            def error(self, message, **details):
                calls.append(("error", message))

        async def on_message(ctx) -> None:
            ctx.logger.info("hello")

        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            logger=Recording(),
        )
        await app.ingest(_message("c-1"))
        self.assertEqual(calls, [("info", "hello")])

    def test_stderr_logger_is_silent_for_debug_and_info(self) -> None:
        stream = io.StringIO()
        logger = StderrLogger(stream)
        logger.debug("a")
        logger.info("b")
        self.assertEqual(stream.getvalue(), "")


class StoreAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_store_exposes_the_event_log_for_audit(self) -> None:
        store = InMemoryStore()
        app = open_channel(store=store, policy=lambda *_args: PolicyDecision(allowed=True))
        self.assertIs(app.store, store)
        await app.ingest(_message("c-1"))
        self.assertEqual(
            _payloads(await app.store.all(), "message.received", "messageReceived")[0]["text"], "go"
        )


class ReplyOptionsTests(unittest.IsolatedAsyncioTestCase):
    async def _routed(self, options, inbound=None) -> list[dict]:
        sent: list[dict] = []

        class Sink:
            provider = "other"

            async def send(self, event, _options=None):
                sent.append(event.channel)

        async def on_message(ctx) -> None:
            await ctx.reply("hi", options)

        app = open_channel(
            store=InMemoryStore(),
            policy=lambda *_args: PolicyDecision(allowed=True),
            agents=[AgentDefinition(id="agent:app", name="App", on_message=on_message)],
            channels=[ChannelDefinition("other", sink=Sink())],
        )
        event = message_received(
            actor=HUMAN,
            recipient=ActorRef("agent:app"),
            channel=inbound or CHANNEL,
            conversation={"id": "c-1"},
            text="go",
        )
        await app.ingest(event)
        return sent

    async def test_reply_options_dataclass_routes_the_reply(self) -> None:
        sent = await self._routed(ReplyOptions(channel={"provider": "other", "channelId": "x"}))
        self.assertEqual(sent, [{"provider": "other", "channelId": "x"}])

    async def test_reply_options_mapping_routes_the_same_way(self) -> None:
        sent = await self._routed({"channel": {"provider": "other", "channelId": "x"}})
        self.assertEqual(sent, [{"provider": "other", "channelId": "x"}])

    async def test_reply_without_options_keeps_inbound_routing(self) -> None:
        inbound = {"provider": "other", "channelId": "room-2"}
        sent = await self._routed(None, inbound=inbound)
        self.assertEqual(sent, [inbound])


if __name__ == "__main__":
    unittest.main()

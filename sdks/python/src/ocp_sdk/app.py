from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Generic, Literal, Protocol, TypeVar
from uuid import uuid4

from .errors import ActionError, AuthorizationError, DeliveryError, OpenChannelError, as_ocp_error
from .host import AgentDefinition, AgentHost, _maybe_await, action_mapping
from .logger import Logger, StderrLogger
from .models import (
    GRANTED,
    ActorRef,
    AgentCard,
    EventEnvelope,
    _actor_from_json,
    _mapping,
    _mapping_or_none,
    approval_decided,
    approval_expired,
    approval_requested,
    escalation_triggered,
    event_type,
    new_event,
)

# Approval lifecycle events are produced only by the app (request, approve, deny, expiry).
_APPROVAL_LIFECYCLE_EVENTS = frozenset(
    {"approval.requested", "approval.granted", "approval.denied", "approval.expired"}
)
# Events only the runtime writes. Inbound events of these types are rejected.
_RUNTIME_ONLY_EVENTS = _APPROVAL_LIFECYCLE_EVENTS | {
    "action.executed",
    "action.failed",
    "escalation.triggered",
}
_RESOLVED_EVENTS = ("approval.granted", "approval.denied", "approval.expired")

InputT = TypeVar("InputT")


@dataclass(frozen=True, slots=True)
class DeliveryReceipt:
    provider: str
    event_id: str
    delivered_at: datetime
    external_id: str | None = None


class ChannelSource(Protocol):
    provider: str

    async def normalize(
        self, value: object, metadata: Mapping[str, object] | None = None
    ) -> EventEnvelope | list[EventEnvelope]: ...

    async def start(self, emit: Callable[[EventEnvelope], Awaitable[object]]) -> None: ...

    async def stop(self) -> None: ...


class ChannelSink(Protocol):
    provider: str

    async def send(
        self, event: EventEnvelope, options: Mapping[str, object] | None = None
    ) -> object: ...

    async def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class ChannelDefinition:
    provider: str
    source: ChannelSource | None = None
    sink: ChannelSink | None = None


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    allowed: bool
    approval_required: bool = False
    reason: str = ""
    # Actor allowed to approve or deny when approval_required is set. Overrides the request's
    # approver; when neither is set, the app's approver (default: the runtime actor) decides.
    approver: ActorRef | None = None


ActionStatus = Literal["blocked", "approval_required", "executed", "failed"]


@dataclass(frozen=True, slots=True)
class ActionResult:
    action_id: str
    status: ActionStatus
    approval_id: str = ""
    reason: str = ""
    result: object = None
    error: ActionError | None = None


@dataclass(slots=True)
class ActionExecutionContext:
    actor: ActorRef
    event: EventEnvelope
    request: Callable[..., Awaitable[ActionResult]]


@dataclass(frozen=True, slots=True)
class ActionDefinition(Generic[InputT]):
    """A named, policy-controlled operation. `validate` (optional) converts raw input to `InputT`."""

    type: str
    execute: Callable[[InputT, ActionExecutionContext], object]
    validate: Callable[[object], InputT] | None = None


def action(
    *,
    type: str,
    execute: Callable[[InputT, ActionExecutionContext], object],
    validate: Callable[[object], InputT] | None = None,
) -> ActionDefinition[InputT]:
    """Define an action. Pass the result in `open_channel(actions=[...])`."""

    return ActionDefinition(type=type, execute=execute, validate=validate)


# The action registry is heterogeneous: each action's input type is enforced by its own validate/execute.
AnyActionDefinition = ActionDefinition[Any]

Policy = Callable[
    [str, ActorRef, object, EventEnvelope], PolicyDecision | Awaitable[PolicyDecision]
]
Hook = Callable[..., object]
EventHandler = Callable[[EventEnvelope], object]


@dataclass(slots=True)
class OpenChannelHooks:
    on_event_accepted: Hook | None = None
    on_event_processed: Hook | None = None
    on_action_started: Hook | None = None
    on_action_completed: Hook | None = None
    on_delivery: Hook | None = None
    on_error: Hook | None = None


class DurableStore(Protocol):
    """Append-only event log. `query(event_type=...)` is optional; `all()` is the fallback."""

    async def append_if_absent(self, event: EventEnvelope) -> bool: ...

    async def all(self) -> list[EventEnvelope]: ...

    async def close(self) -> None: ...


@dataclass(slots=True)
class _PendingAction:
    action_id: str
    approval_id: str
    definition: AnyActionDefinition
    actor: ActorRef
    event: EventEnvelope
    input: object
    approver: ActorRef
    request_event_id: str = ""
    reason: str = ""
    deadline: datetime | None = None
    target: str = ""
    channel: Mapping[str, object] | None = None
    conversation: Mapping[str, object] | None = None
    recipient: ActorRef | None = None
    expiry: asyncio.Task[None] | None = None


@dataclass(slots=True)
class IngestResult:
    duplicate: bool
    emitted: list[EventEnvelope] = field(default_factory=list)

    def __bool__(self) -> bool:
        return not self.duplicate


_FRACTION_RE = re.compile(r"(\.\d{6})\d+")


def _parse_timestamp(value: str) -> datetime:
    """Parse an RFC 3339 timestamp. Fractions beyond microseconds are truncated (binary stores use nanos)."""

    parsed = datetime.fromisoformat(_FRACTION_RE.sub(r"\1", value))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def _as_datetime(value: object) -> datetime | None:
    return value if isinstance(value, datetime) else None


class OpenChannel:
    """A running OCP application: agents, actions, channels, policy, and approvals.

    Create one with `open_channel(...)`. Lifecycle: `start()`, then `receive()` or `ingest()`,
    then `stop()`. `start()` restores unresolved approvals from the store.
    """

    def __init__(
        self,
        *,
        store: DurableStore,
        policy: Policy,
        agents: Sequence[AgentDefinition] = (),
        actions: Sequence[AnyActionDefinition] = (),
        channels: Sequence[ChannelDefinition] = (),
        approver: ActorRef | None = None,
        approval_timeout_ms: int = 60_000,
        concurrency: int | None = None,
        hooks: OpenChannelHooks | None = None,
        runtime_actor: ActorRef | None = None,
        clock: Callable[[], datetime] | None = None,
        logger: Logger | None = None,
    ) -> None:
        self._store = store
        self._policy = policy
        self._actions: dict[str, AnyActionDefinition] = {}
        self._channels: dict[str, ChannelDefinition] = {}
        self._listeners: dict[str, list[EventHandler]] = {}
        self._pending: dict[str, _PendingAction] = {}
        self._action_results: dict[str, ActionResult] = {}
        self._claimed_actions: set[str] = set()
        self._locks: dict[str, asyncio.Lock] = {}
        self._inflight: set[asyncio.Task[object]] = set()
        self._source_tasks: set[asyncio.Task[object]] = set()
        self._semaphore = asyncio.Semaphore(max(1, concurrency or 2**31 - 1))
        self._hooks = hooks or OpenChannelHooks()
        self._clock = clock or (lambda: datetime.now(UTC))
        self._logger = logger or StderrLogger()
        self._runtime_actor = runtime_actor or ActorRef(
            "ocp.runtime", type="ACTOR_TYPE_SYSTEM", display_name="OCP Runtime"
        )
        self._default_approver = approver or self._runtime_actor
        self._approval_timeout = max(0, approval_timeout_ms) / 1000
        self._started = False
        self._accepting = True
        self._host = AgentHost(
            dispatch=self._dispatch, requester=self._request_action, logger=self._logger
        )
        for agent in agents:
            self.add_agent(agent)
        for definition in actions:
            self.add_action(definition)
        for channel in channels:
            self.add_channel(channel)

    @property
    def store(self) -> DurableStore:
        """The event store, for audit queries. Every accepted and internally emitted event is in it."""

        return self._store

    def add_agent(self, agent: AgentDefinition) -> None:
        self._host.register(agent)

    def add_action(self, action: AnyActionDefinition) -> None:
        if action.type in self._actions:
            raise ValueError(f"OCP action is already registered: {action.type}")
        self._actions[action.type] = action

    def add_channel(self, channel: ChannelDefinition) -> None:
        if channel.provider in self._channels:
            raise ValueError(f"OCP channel is already registered: {channel.provider}")
        self._channels[channel.provider] = channel

    def agent_cards(self) -> tuple[AgentCard, ...]:
        return self._host.cards()

    def on(self, name: str, handler: EventHandler) -> Callable[[], None]:
        """Call `handler` for every accepted event of this name. Returns a function that unsubscribes."""

        self._listeners.setdefault(name, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._listeners.get(name, [])
            if handler in handlers:
                handlers.remove(handler)

        return unsubscribe

    async def start(self) -> None:
        if self._started:
            return
        if not self._accepting:
            raise OpenChannelError("OCP app has already stopped", stage="shutdown")
        self._started = True
        await self._restore_approvals()
        for channel in self._channels.values():
            if channel.source is None or not hasattr(channel.source, "start"):
                continue
            task = asyncio.create_task(self._run_source(channel.source))
            self._source_tasks.add(task)
            task.add_done_callback(self._source_tasks.discard)
        await asyncio.sleep(0)

    async def stop(self, *, timeout_ms: int = 30_000) -> None:
        if not self._accepting:
            return
        self._accepting = False
        timeout = max(0, timeout_ms) / 1000
        # Pending approvals stay pending in the store; the next start() reschedules their expiry.
        for pending in self._pending.values():
            if pending.expiry is not None:
                pending.expiry.cancel()
        try:
            await asyncio.wait_for(self._stop_sources(), timeout)
            if self._inflight:
                await asyncio.wait_for(
                    asyncio.gather(*self._inflight, return_exceptions=True), timeout
                )
            for channel in self._channels.values():
                if channel.sink is not None and hasattr(channel.sink, "close"):
                    await asyncio.wait_for(_maybe_await(channel.sink.close()), timeout)
            if hasattr(self._store, "close"):
                await asyncio.wait_for(_maybe_await(self._store.close()), timeout)
        except TimeoutError as error:
            await self._report_error(
                OpenChannelError("OCP shutdown timed out", stage="shutdown", retryable=True)
            )
            raise OpenChannelError(
                "OCP shutdown timed out", stage="shutdown", retryable=True
            ) from error
        finally:
            self._started = False

    async def ingest(self, event: EventEnvelope) -> IngestResult:
        if not self._accepting:
            raise OpenChannelError("OCP app is stopping", stage="accept", retryable=True)
        # Reject forged approval events before they are stored or delivered to agents.
        name = event_type(event)
        if name in _RUNTIME_ONLY_EVENTS:
            raise AuthorizationError(
                f"OCP {name} events are produced by the app; use the agent's ctx.request(), "
                "approve(), or deny()",
                event_id=event.event_id,
                stage="approval",
            )
        if self._is_runtime_event(event):
            raise AuthorizationError(
                "Inbound events may not claim the runtime actor as their source",
                event_id=event.event_id,
                stage="authorization",
            )
        if not await self._store.append_if_absent(event):
            return IngestResult(duplicate=True)
        await self._accepted(event)
        task = asyncio.current_task()
        if task is not None:
            self._inflight.add(task)
        try:
            key = self._conversation_key(event)
            lock = self._locks.get(key)
            if lock is None:
                lock = self._locks[key] = asyncio.Lock()
            async with lock, self._semaphore:
                await self._host.handle(event)
            await self._run_hook(self._hooks.on_event_processed, event)
            return IngestResult(duplicate=False)
        finally:
            if task is not None:
                self._inflight.discard(task)

    async def receive(
        self,
        provider: str,
        value: object,
        metadata: Mapping[str, object] | None = None,
    ) -> list[IngestResult]:
        if not self._accepting:
            raise OpenChannelError("OCP app is stopping", stage="accept", retryable=True)
        channel = self._channels.get(provider)
        if channel is None or channel.source is None:
            raise DeliveryError(
                f"No OCP source registered for provider: {provider}",
                provider=provider,
                stage="normalize",
            )
        try:
            normalized = await channel.source.normalize(value, metadata)
        except Exception as error:
            classified = as_ocp_error(error, provider=provider, stage="normalize", retryable=True)
            await self._report_error(classified)
            raise classified from error
        events = normalized if isinstance(normalized, list) else [normalized]
        return [await self.ingest(event) for event in events]

    def _take_pending_approval(self, approval_id: str, approver: ActorRef) -> _PendingAction:
        # Check the decider before removing the entry, so a rejected attempt leaves the approval pending.
        pending = self._pending.get(approval_id)
        if pending is None:
            raise KeyError(f"OCP approval was not found: {approval_id}")
        if approver.id != pending.approver.id:
            raise AuthorizationError(
                f"OCP approval {approval_id} can only be decided by {pending.approver.id}",
                approval_id=approval_id,
                stage="approval",
            )
        del self._pending[approval_id]
        if pending.expiry is not None:
            pending.expiry.cancel()
        return pending

    async def approve(
        self, approval_id: str, approver: ActorRef, reason: str = "Approved"
    ) -> ActionResult:
        pending = self._take_pending_approval(approval_id, approver)
        await self._record(
            approval_decided(
                approval_id=approval_id,
                approver=approver,
                outcome=GRANTED,
                reason=reason,
                source=self._runtime_actor,
                channel=pending.channel,
                conversation=pending.conversation,
                correlation_id=pending.event.correlation_id or pending.action_id,
                causation_id=pending.request_event_id,
            )
        )
        result = await self._execute(pending)
        await self._run_hook(self._hooks.on_action_completed, result)
        return result

    async def deny(
        self, approval_id: str, approver: ActorRef, reason: str = "Denied"
    ) -> ActionResult:
        pending = self._take_pending_approval(approval_id, approver)
        await self._record(
            approval_decided(
                approval_id=approval_id,
                approver=approver,
                outcome="APPROVAL_OUTCOME_DENIED",
                reason=reason,
                source=self._runtime_actor,
                channel=pending.channel,
                conversation=pending.conversation,
                correlation_id=pending.event.correlation_id or pending.action_id,
                causation_id=pending.request_event_id,
            )
        )
        result = ActionResult(pending.action_id, "blocked", approval_id=approval_id, reason=reason)
        self._action_results[pending.action_id] = result
        await self._run_hook(self._hooks.on_action_completed, result)
        return result

    async def _run_source(self, source: ChannelSource) -> None:
        try:
            await source.start(self.ingest)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            await self._report_error(
                as_ocp_error(error, provider=source.provider, stage="processing", retryable=True)
            )

    async def _stop_sources(self) -> None:
        for channel in self._channels.values():
            if channel.source is not None and hasattr(channel.source, "stop"):
                await _maybe_await(channel.source.stop())
        if self._source_tasks:
            await asyncio.gather(*self._source_tasks, return_exceptions=True)

    async def _dispatch(self, event: EventEnvelope) -> DeliveryReceipt:
        provider = str((event.channel or {}).get("provider", ""))
        channel = self._channels.get(provider)
        if channel is None or channel.sink is None:
            error = DeliveryError(
                f"No OCP sink registered for provider: {provider}",
                event_id=event.event_id,
                provider=provider,
                retryable=True,
                stage="delivery",
            )
            await self._report_error(error)
            raise error
        try:
            receipt = await _maybe_await(channel.sink.send(event))
            if isinstance(receipt, DeliveryReceipt):
                result = receipt
            else:
                result = DeliveryReceipt(
                    provider, event.event_id, self._clock(), str(receipt) if receipt else None
                )
            await self._run_hook(self._hooks.on_delivery, result)
            return result
        except Exception as error:
            classified = as_ocp_error(
                error,
                event_id=event.event_id,
                provider=provider,
                stage="delivery",
                retryable=True,
            )
            await self._report_error(classified)
            raise classified from error

    async def _request_action(
        self, action: Mapping[str, object], event: EventEnvelope
    ) -> ActionResult:
        action_type = str(action.get("type", ""))
        definition = self._actions.get(action_type)
        if definition is None:
            error = ActionError(
                f"No OCP action is registered for type: {action_type}", stage="validation"
            )
            await self._report_error(error)
            raise error
        action_id = str(action["actionId"]) if action.get("actionId") else f"action:{uuid4()}"
        previous = self._action_results.get(action_id)
        if previous is not None:
            return previous
        if action_id in self._claimed_actions:
            return ActionResult(
                action_id,
                "failed",
                error=ActionError("OCP action has already been claimed", action_id=action_id),
            )
        self._claimed_actions.add(action_id)
        value: object = action.get("input", action.get("parameters", {}))
        try:
            if definition.validate is not None:
                value = definition.validate(value)
            actor = event.actor or ActorRef("")
            decision = self._policy(action_type, actor, value, event)
            if isinstance(decision, Awaitable):
                decision = await decision
            if not decision.allowed:
                result = ActionResult(action_id, "blocked", reason=decision.reason)
                self._action_results[action_id] = result
                return result
            pending = _PendingAction(
                action_id=action_id,
                approval_id="",
                definition=definition,
                actor=actor,
                event=event,
                input=value,
                approver=decision.approver
                or _actor_or_none(action.get("approver"))
                or self._default_approver,
                reason=str(action.get("reason") or decision.reason or "Approval required"),
                deadline=_as_datetime(action.get("deadline")),
                target=str(action.get("target", "")),
                channel=_mapping_or_none(action.get("channel")) or event.channel,
                conversation=_mapping_or_none(action.get("conversation")) or event.conversation,
                recipient=_actor_or_none(action.get("recipient")) or event.recipient,
            )
            if decision.approval_required:
                await self._request_approval(pending)
                result = ActionResult(
                    action_id, "approval_required", approval_id=pending.approval_id
                )
                self._action_results[action_id] = result
                return result
            return await self._execute(pending)
        except Exception as error:
            classified = (
                error
                if isinstance(error, ActionError)
                else ActionError(str(error), action_id=action_id, cause=error)
            )
            result = ActionResult(action_id, "failed", error=classified)
            self._action_results[action_id] = result
            await self._run_hook(self._hooks.on_action_completed, result)
            await self._report_error(classified)
            return result

    async def _request_approval(self, pending: _PendingAction) -> None:
        """Record `approval.requested` (the durable pending state) and schedule its expiry."""

        pending.approval_id = f"{pending.action_id}:approval"
        if pending.deadline is None:
            pending.deadline = self._clock() + timedelta(seconds=self._approval_timeout)
        requested = approval_requested(
            agent=pending.event.recipient or ActorRef(""),
            approver=pending.approver,
            approval_id=pending.approval_id,
            reason=pending.reason,
            requested_action={
                "actionId": pending.action_id,
                "type": pending.definition.type,
                "target": pending.target,
                # The input is stored as JSON so a restarted app can rebuild the action.
                "parameters": {"input": json.dumps(pending.input)},
            },
            deadline=pending.deadline,
            actor=self._runtime_actor,
            source=self._runtime_actor,
            channel=pending.channel,
            conversation=pending.conversation,
            correlation_id=pending.event.correlation_id or pending.action_id,
            causation_id=pending.event.event_id,
        )
        await self._record(requested)
        pending.request_event_id = requested.event_id
        self._pending[pending.approval_id] = pending
        self._schedule_expiry(pending)

    def _schedule_expiry(self, pending: _PendingAction) -> None:
        assert pending.deadline is not None
        delay = max(0.0, (pending.deadline - self._clock()).total_seconds())
        pending.expiry = asyncio.create_task(self._expire(pending.approval_id, delay))

    async def _restore_approvals(self) -> None:
        """Rebuild unresolved approvals from the store, and finish granted approvals that never ran.

        A request is resolved by a runtime-recorded expiry, or by a grant or denial that the runtime
        recorded from the designated approver. Any other decision leaves the request pending.
        """

        requests: dict[str, EventEnvelope] = {}
        for requested in await self._events_of_type("approval.requested"):
            if self._is_runtime_event(requested):
                requests.setdefault(_approval_id(requested), requested)
        expired = {
            _approval_id(event)
            for event in await self._events_of_type("approval.expired")
            if self._is_runtime_event(event)
        }
        decisions: dict[str, EventEnvelope] = {}
        for name in ("approval.granted", "approval.denied"):
            for decided in await self._events_of_type(name):
                approval_id = _approval_id(decided)
                requested = requests.get(approval_id)
                if requested is None or approval_id in decisions:
                    continue
                if _designated_decision(decided, requested, self._runtime_actor.id):
                    decisions[approval_id] = decided
        finished = await self._finished_action_ids()
        for approval_id, requested in requests.items():
            if approval_id in expired or approval_id in self._pending:
                continue
            decided = decisions.get(approval_id)
            if decided is None:
                await self._restore_one(requested)
            elif (
                event_type(decided) == "approval.granted"
                and _requested_action_id(requested) not in finished
            ):
                # Granted, but the action never reached a terminal event: run it now.
                pending = await self._rebuild(requested)
                if pending is not None:
                    self._claimed_actions.add(pending.action_id)
                    await self._execute(pending)

    async def _restore_one(self, requested: EventEnvelope) -> None:
        pending = await self._rebuild(requested)
        if pending is None:
            return
        self._claimed_actions.add(pending.action_id)
        self._pending[pending.approval_id] = pending
        assert pending.deadline is not None
        if pending.deadline <= self._clock():
            await self._expire_now(pending.approval_id)
        else:
            self._schedule_expiry(pending)

    async def _rebuild(self, requested: EventEnvelope) -> _PendingAction | None:
        """Rebuild a pending action from a stored approval request. Reports and returns None on failure."""

        request = _mapping(requested.payload.get("approvalRequested"))
        approval_id = str(request.get("approvalId", ""))
        requested_action = _mapping(request.get("requestedAction"))
        action_type = str(requested_action.get("type", ""))
        definition = self._actions.get(action_type)
        inbound = await self._find_event(requested.causation_id)
        if definition is None or inbound is None:
            await self._report_error(
                ActionError(
                    f"Cannot restore OCP approval {approval_id}: "
                    "its action or inbound event is not available",
                    approval_id=approval_id,
                    stage="restore",
                )
            )
            return None
        try:
            raw = str(_mapping(requested_action.get("parameters")).get("input", "null"))
            value: object = json.loads(raw)
            if definition.validate is not None:
                value = definition.validate(value)
            deadline = _parse_timestamp(str(request.get("deadline", "")))
        except Exception as error:
            await self._report_error(as_ocp_error(error, approval_id=approval_id, stage="restore"))
            return None
        return _PendingAction(
            action_id=str(requested_action.get("actionId", "")),
            approval_id=approval_id,
            definition=definition,
            actor=inbound.actor or ActorRef(""),
            event=inbound,
            input=value,
            approver=_actor_from_json(_mapping_or_none(request.get("approver")))
            or self._default_approver,
            request_event_id=requested.event_id,
            reason=str(request.get("reason", "")),
            deadline=deadline,
            target=str(requested_action.get("target", "")),
            channel=inbound.channel,
            conversation=inbound.conversation,
            recipient=inbound.recipient,
        )

    async def _finished_action_ids(self) -> set[str]:
        """Action ids with a terminal event written by this runtime.

        Store errors propagate, so start() fails rather than guessing which grants already ran.
        """

        finished: set[str] = set()
        for name in ("action.executed", "action.failed"):
            for event in await self._events_of_type(name):
                if self._is_runtime_event(event):
                    finished.add(_action_event_id(event))
        return finished

    async def _events_of_type(self, name: str) -> list[EventEnvelope]:
        """Stored events of one type, from any source. Callers decide which sources they trust."""

        query = getattr(self._store, "query", None)
        if query is not None:
            return list(await _maybe_await(query(event_type=name)))
        return [event for event in await self._store.all() if event_type(event) == name]

    def _is_runtime_event(self, event: EventEnvelope) -> bool:
        return event.source is not None and event.source.id == self._runtime_actor.id

    async def _find_event(self, event_id: str) -> EventEnvelope | None:
        for event in await self._store.all():
            if event.event_id == event_id:
                return event
        return None

    async def _execute(self, pending: _PendingAction) -> ActionResult:
        await self._run_hook(
            self._hooks.on_action_started,
            {"actionId": pending.action_id, "type": pending.definition.type},
        )
        context = self._action_context(pending)
        action_ref = {"actionId": pending.action_id, "type": pending.definition.type}
        if pending.target:
            action_ref["target"] = pending.target
        try:
            result = await _maybe_await(pending.definition.execute(pending.input, context))
            event = new_event(
                payload={"actionExecuted": {"action": action_ref, "result": result}},
                actor=pending.actor,
                channel=pending.channel,
                conversation=pending.conversation,
                correlation_id=pending.event.correlation_id or pending.action_id,
                causation_id=pending.event.event_id,
                occurred_at=self._clock(),
                recipient=pending.recipient,
                source=self._runtime_actor,
            )
            await self._record(event)
            output = ActionResult(pending.action_id, "executed", result=result)
            self._action_results[pending.action_id] = output
            await self._run_hook(self._hooks.on_action_completed, output)
            return output
        except Exception as error:
            classified = (
                error
                if isinstance(error, ActionError)
                else ActionError(str(error), action_id=pending.action_id, cause=error)
            )
            failed_event = new_event(
                payload={
                    "actionFailed": {
                        "action": action_ref,
                        "errorCode": classified.code,
                        "errorMessage": str(classified),
                        "retryable": classified.retryable,
                    }
                },
                actor=pending.actor,
                channel=pending.channel,
                conversation=pending.conversation,
                correlation_id=pending.event.correlation_id or pending.action_id,
                causation_id=pending.event.event_id,
                occurred_at=self._clock(),
                recipient=pending.recipient,
                source=self._runtime_actor,
            )
            await self._record(failed_event)
            output = ActionResult(pending.action_id, "failed", error=classified)
            self._action_results[pending.action_id] = output
            await self._run_hook(self._hooks.on_action_completed, output)
            await self._report_error(classified)
            return output

    def _action_context(self, pending: _PendingAction) -> ActionExecutionContext:
        async def request(
            action_type: str,
            input: object,
            *,
            approver: ActorRef | None = None,
            reason: str | None = None,
            deadline: datetime | None = None,
            target: str | None = None,
            action_id: str | None = None,
            channel: Mapping[str, object] | None = None,
            conversation: Mapping[str, object] | None = None,
            recipient: ActorRef | None = None,
        ) -> ActionResult:
            options = {
                "action_id": action_id,
                "approver": approver,
                "reason": reason,
                "deadline": deadline,
                "target": target,
                "channel": channel,
                "conversation": conversation,
                "recipient": recipient,
            }
            mapping = action_mapping(action_type, input, options)
            return await self._request_action(mapping, pending.event)

        return ActionExecutionContext(pending.actor, pending.event, request)

    async def _expire(self, approval_id: str, delay: float) -> None:
        await asyncio.sleep(delay)
        await self._expire_now(approval_id)

    async def _expire_now(self, approval_id: str) -> None:
        pending = self._pending.pop(approval_id, None)
        if pending is None:
            return
        expired = approval_expired(
            approval_id=approval_id,
            reason="Approval deadline expired",
            actor=self._runtime_actor,
            source=self._runtime_actor,
            channel=pending.channel,
            conversation=pending.conversation,
            correlation_id=pending.event.correlation_id or pending.action_id,
            causation_id=pending.request_event_id,
        )
        await self._record(expired)
        await self._record(
            escalation_triggered(
                escalation_id=f"{approval_id}:escalation",
                reason="Approval deadline expired",
                related_approval_id=approval_id,
                agent=pending.event.recipient or ActorRef(""),
                approver=pending.approver,
                actor=self._runtime_actor,
                source=self._runtime_actor,
                channel=pending.channel,
                conversation=pending.conversation,
                correlation_id=pending.event.correlation_id or pending.action_id,
                causation_id=expired.event_id,
            )
        )
        result = ActionResult(
            pending.action_id, "blocked", approval_id=approval_id, reason="Approval expired"
        )
        self._action_results[pending.action_id] = result
        await self._run_hook(self._hooks.on_action_completed, result)

    async def _accepted(self, event: EventEnvelope) -> None:
        await self._run_hook(self._hooks.on_event_accepted, event)
        for handler in tuple(self._listeners.get(event_type(event), ())):
            await self._run_hook(handler, event)

    async def _record(self, event: EventEnvelope) -> bool:
        if not await self._store.append_if_absent(event):
            return False
        await self._accepted(event)
        await self._run_hook(self._hooks.on_event_processed, event)
        return True

    async def _run_hook(self, hook: Hook | None, value: object) -> None:
        if hook is None:
            return
        try:
            await _maybe_await(hook(value))
        except Exception as error:
            if hook is not self._hooks.on_error:
                await self._report_error(as_ocp_error(error, stage="processing"))

    async def _report_error(self, error: OpenChannelError) -> None:
        if self._hooks.on_error is not None:
            try:
                await _maybe_await(self._hooks.on_error(error))
            except Exception:
                return

    @staticmethod
    def _conversation_key(event: EventEnvelope) -> str:
        if event.conversation and event.conversation.get("id"):
            return f"conversation:{event.conversation['id']}"
        channel = event.channel or {}
        return f"channel:{channel.get('provider', '')}:{channel.get('channelId', '')}:{channel.get('threadId', '')}"


def _approval_id(event: EventEnvelope) -> str:
    for case in ("approvalRequested", "approvalDecided", "approvalExpired"):
        value = event.payload.get(case)
        if isinstance(value, Mapping):
            return str(value.get("approvalId", ""))
    return ""


def _designated_decision(decided: EventEnvelope, requested: EventEnvelope, runtime_id: str) -> bool:
    """True when a grant or denial came from the approver named on the request.

    Decisions written by this runtime carry its id as source. Decisions written before that carried
    the approver's id as source; those are accepted too, when the approver matches the request.
    """

    if event_type(decided) not in ("approval.granted", "approval.denied"):
        return False
    designated = _mapping(_mapping(requested.payload.get("approvalRequested")).get("approver"))
    decided_by = _mapping(_mapping(decided.payload.get("approvalDecided")).get("approver"))
    designated_id = str(designated.get("id", ""))
    if not designated_id or decided_by.get("id") != designated_id:
        return False
    source_id = decided.source.id if decided.source is not None else ""
    return source_id in (runtime_id, designated_id)


def _requested_action_id(requested: EventEnvelope) -> str:
    request = _mapping(requested.payload.get("approvalRequested"))
    return str(_mapping(request.get("requestedAction")).get("actionId", ""))


def _action_event_id(event: EventEnvelope) -> str:
    for case in ("actionExecuted", "actionFailed"):
        value = event.payload.get(case)
        if isinstance(value, Mapping):
            return str(_mapping(value.get("action")).get("actionId", ""))
    return ""


def _actor_or_none(value: object) -> ActorRef | None:
    if isinstance(value, ActorRef):
        return value
    return None


def open_channel(
    *,
    store: DurableStore,
    policy: Policy,
    agents: Sequence[AgentDefinition] = (),
    actions: Sequence[AnyActionDefinition] = (),
    channels: Sequence[ChannelDefinition] = (),
    approver: ActorRef | None = None,
    approval_timeout_ms: int = 60_000,
    concurrency: int | None = None,
    hooks: OpenChannelHooks | None = None,
    runtime_actor: ActorRef | None = None,
    clock: Callable[[], datetime] | None = None,
    logger: Logger | None = None,
) -> OpenChannel:
    """Build an OCP application.

    `store` (durable event store) and `policy` are required. `approver` is the default actor who
    decides approval requests; it falls back to `runtime_actor`. `concurrency` caps concurrently
    handled conversations. `clock` must return timezone-aware datetimes.
    """

    return OpenChannel(
        store=store,
        policy=policy,
        agents=agents,
        actions=actions,
        channels=channels,
        approver=approver,
        approval_timeout_ms=approval_timeout_ms,
        concurrency=concurrency,
        hooks=hooks,
        runtime_actor=runtime_actor,
        clock=clock,
        logger=logger,
    )

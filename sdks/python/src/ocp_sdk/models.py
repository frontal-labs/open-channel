from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TypeAlias
from uuid import uuid4

from ._wire import decode_event, encode_event

# ProtoJSON object produced by the SDK. Inputs accept any Mapping[str, object] instead.
JsonObject: TypeAlias = dict[str, object]

# The one OCP protocol version. Every envelope carries it; there is no other envelope shape.
PROTOCOL_VERSION = "2.0"

# Payload case -> event name. Approval decisions and policy results are disambiguated by value.
_EVENT_TYPE_BY_CASE: dict[str, str] = {
    "actionExecuted": "action.executed",
    "actionFailed": "action.failed",
    "approvalDecided": "approval.granted",
    "approvalExpired": "approval.expired",
    "approvalRequested": "approval.requested",
    "escalationTriggered": "escalation.triggered",
    "handoffCompleted": "handoff.completed",
    "handoffInitiated": "handoff.initiated",
    "messageReceived": "message.received",
    "messageSent": "message.sent",
    "policyEvaluated": "policy.allowed",
    "taskAssigned": "task.assigned",
    "taskCreated": "task.created",
}

# Envelope fields other than the payload oneof, as they appear in ProtoJSON.
_ENVELOPE_FIELDS = frozenset(
    {
        "actor",
        "causationId",
        "channel",
        "conversation",
        "correlationId",
        "eventId",
        "extensions",
        "idempotencyKey",
        "occurredAt",
        "protocolVersion",
        "recipient",
        "source",
    }
)

_GRANTED_OUTCOMES = ("APPROVAL_OUTCOME_GRANTED", 1)
_DENIED_OUTCOMES = ("APPROVAL_OUTCOME_DENIED", 2)


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _mapping_or_none(value: object) -> Mapping[str, object] | None:
    return value if isinstance(value, Mapping) else None


def _items(value: object) -> list[object]:
    return list(value) if isinstance(value, (list, tuple)) else []


def _optional_mapping(value: object, name: str) -> dict[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be a mapping")
    return dict(value)


def _actor_from_json(value: Mapping[str, object] | None) -> ActorRef | None:
    if value is None:
        return None
    return ActorRef(
        id=str(value.get("id", "")),
        type=str(value.get("type", "ACTOR_TYPE_UNSPECIFIED")),
        display_name=str(value.get("displayName", "")),
        authority=str(value.get("authority", "")),
        capabilities=tuple(str(item) for item in _items(value.get("capabilities"))),
    )


def _timestamp(value: datetime | str) -> str:
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _now() -> str:
    return _timestamp(datetime.now(UTC))


@dataclass(frozen=True, slots=True)
class ActorRef:
    id: str
    type: str = "ACTOR_TYPE_AGENT"
    display_name: str = ""
    authority: str = ""
    capabilities: tuple[str, ...] = ()

    def to_json(self) -> JsonObject:
        value: JsonObject = {"id": self.id, "type": self.type, "displayName": self.display_name}
        if self.authority:
            value["authority"] = self.authority
        if self.capabilities:
            value["capabilities"] = list(self.capabilities)
        return value


@dataclass(frozen=True, slots=True)
class AgentCapabilities:
    push_notifications: bool = False
    state_transition_history: bool = False
    streaming: bool = False

    def to_json(self) -> JsonObject:
        return {
            "pushNotifications": self.push_notifications,
            "stateTransitionHistory": self.state_transition_history,
            "streaming": self.streaming,
        }


@dataclass(frozen=True, slots=True)
class AgentSkill:
    id: str
    name: str
    description: str = ""
    tags: tuple[str, ...] = ()
    examples: tuple[str, ...] = ()

    def to_json(self) -> JsonObject:
        value: JsonObject = {"id": self.id, "name": self.name}
        if self.description:
            value["description"] = self.description
        if self.tags:
            value["tags"] = list(self.tags)
        if self.examples:
            value["examples"] = list(self.examples)
        return value


@dataclass(frozen=True, slots=True)
class AgentCard:
    id: str
    name: str
    description: str = ""
    version: str = "2.0.0"
    url: str = ""
    capabilities: AgentCapabilities = field(default_factory=AgentCapabilities)
    skills: tuple[AgentSkill, ...] = ()

    def to_json(self) -> JsonObject:
        value: JsonObject = {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "capabilities": self.capabilities.to_json(),
            "skills": [skill.to_json() for skill in self.skills],
        }
        if self.description:
            value["description"] = self.description
        if self.url:
            value["url"] = self.url
        return value


@dataclass(frozen=True, slots=True)
class MessageReceived:
    text: str
    attachments: tuple[JsonObject, ...] = ()
    metadata: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def from_json(cls, value: Mapping[str, object]) -> MessageReceived:
        attachments: list[dict[str, object]] = []
        for item in _items(value.get("attachments")):
            if not isinstance(item, Mapping):
                raise TypeError("messageReceived attachments must be mappings")
            attachments.append(dict(item))
        return cls(
            text=str(value.get("text", "")),
            attachments=tuple(attachments),
            metadata={str(key): str(item) for key, item in _mapping(value.get("metadata")).items()},
        )


def _payload_case(payload: Mapping[str, object]) -> str:
    cases = [key for key in payload if key in _EVENT_TYPE_BY_CASE]
    if len(cases) != 1:
        raise ValueError("OCP event must have exactly one typed payload")
    return cases[0]


def _payload_event_type(payload: Mapping[str, object]) -> str:
    case = _payload_case(payload)
    if case == "approvalDecided":
        value = _mapping(payload[case])
        return "approval.denied" if value.get("outcome") in _DENIED_OUTCOMES else "approval.granted"
    if case == "policyEvaluated":
        value = _mapping(payload[case])
        return "policy.allowed" if value.get("allowed") else "policy.blocked"
    return _EVENT_TYPE_BY_CASE[case]


def event_type(event: EventEnvelope) -> str:
    """Return the dot-separated event name (for example "approval.granted") from the payload."""

    return _payload_event_type(event.payload)


def _check_invariants(case: str, value: Mapping[str, object]) -> None:
    if case == "approvalRequested":
        if not str(value.get("approvalId", "")).strip():
            raise ValueError("approval.requested must have an approval_id")
        if not (value.get("agent") and value.get("approver")):
            raise ValueError("approval.requested must identify an agent and approver")
        if not value.get("requestedAction"):
            raise ValueError("approval.requested must include a requested_action")
        if not value.get("deadline"):
            raise ValueError("approval.requested must have a deadline")
    elif case == "approvalDecided":
        if not str(value.get("approvalId", "")).strip():
            raise ValueError("approval decision must have an approval_id")
        if value.get("outcome") not in _GRANTED_OUTCOMES + _DENIED_OUTCOMES:
            raise ValueError("approval decision must be granted or denied")


@dataclass(slots=True)
class EventEnvelope:
    """An OCP event. The payload oneof identifies the event; see `event_type()`.

    Build events with the builders (`message_received`, ...) or `new_event()`. Those validate; the
    dataclass itself does not, so `validate_event()` runs at every boundary (`from_json`,
    `from_binary`, `to_json`, `to_binary`).
    """

    payload: Mapping[str, object] = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: str(uuid4()))
    occurred_at: str = field(default_factory=_now)
    source: ActorRef | None = None
    actor: ActorRef | None = None
    recipient: ActorRef | None = None
    channel: Mapping[str, object] | None = None
    conversation: Mapping[str, object] | None = None
    correlation_id: str = ""
    causation_id: str = ""
    idempotency_key: str = ""
    extensions: Mapping[str, str] = field(default_factory=dict)

    @property
    def payload_case(self) -> str:
        return _payload_case(self.payload)

    def message_received_payload(self) -> MessageReceived | None:
        value = self.payload.get("messageReceived")
        return MessageReceived.from_json(value) if isinstance(value, Mapping) else None


def validate_event(event: EventEnvelope) -> None:
    """Validate identity, the payload oneof, and approval invariants."""

    if not event.event_id.strip():
        raise ValueError("OCP event must have an event_id")
    if not event.occurred_at.strip():
        raise ValueError("OCP event must have occurred_at")
    if not event.payload:
        raise ValueError("OCP event must have a payload")
    case = _payload_case(event.payload)
    _check_invariants(case, _mapping(event.payload[case]))


def new_event(
    *,
    payload: Mapping[str, object],
    actor: ActorRef | None = None,
    recipient: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    idempotency_key: str = "",
    event_id: str | None = None,
    occurred_at: datetime | str | None = None,
    extensions: Mapping[str, str] | None = None,
) -> EventEnvelope:
    """Build and validate an event from a payload oneof, such as `{"messageReceived": {...}}`."""

    event = EventEnvelope(
        payload=dict(payload),
        event_id=event_id or str(uuid4()),
        occurred_at=_now() if occurred_at is None else _timestamp(occurred_at),
        source=source,
        actor=actor,
        recipient=recipient,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        idempotency_key=idempotency_key,
        extensions=dict(extensions or {}),
    )
    validate_event(event)
    return event


def message_received(
    *,
    text: str,
    actor: ActorRef | None = None,
    recipient: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    attachments: Sequence[Mapping[str, object]] = (),
    metadata: Mapping[str, str] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build a `message.received` event."""

    value: JsonObject = {"text": text}
    if attachments:
        value["attachments"] = [dict(item) for item in attachments]
    if metadata:
        value["metadata"] = dict(metadata)
    return new_event(
        payload={"messageReceived": value},
        actor=actor,
        source=actor if source is None else source,
        recipient=recipient,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def message_sent(
    *,
    text: str,
    actor: ActorRef | None = None,
    recipient: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    attachments: Sequence[Mapping[str, object]] = (),
    metadata: Mapping[str, str] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build a `message.sent` event."""

    value: JsonObject = {"text": text}
    if attachments:
        value["attachments"] = [dict(item) for item in attachments]
    if metadata:
        value["metadata"] = dict(metadata)
    return new_event(
        payload={"messageSent": value},
        actor=actor,
        source=actor if source is None else source,
        recipient=recipient,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def approval_requested(
    *,
    agent: ActorRef,
    approver: ActorRef,
    approval_id: str,
    reason: str,
    requested_action: Mapping[str, object],
    deadline: datetime | str,
    actor: ActorRef | None = None,
    recipient: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build an `approval.requested` event addressed to the approver by default."""

    payload = {
        "approvalRequested": {
            "agent": agent.to_json(),
            "approvalId": approval_id,
            "approver": approver.to_json(),
            "reason": reason,
            "requestedAction": dict(requested_action),
            "deadline": _timestamp(deadline),
        }
    }
    return new_event(
        payload=payload,
        actor=actor,
        source=source,
        recipient=approver if recipient is None else recipient,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def action_executed(
    *,
    action: Mapping[str, object],
    result: str = "",
    actor: ActorRef | None = None,
    recipient: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build an `action.executed` event."""

    return new_event(
        payload={"actionExecuted": {"action": dict(action), "result": result}},
        actor=actor,
        source=source,
        recipient=recipient,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def action_failed(
    *,
    action: Mapping[str, object],
    error_code: str,
    error_message: str,
    retryable: bool = False,
    actor: ActorRef | None = None,
    recipient: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build an `action.failed` event."""

    payload = {
        "actionFailed": {
            "action": dict(action),
            "errorCode": error_code,
            "errorMessage": error_message,
            "retryable": retryable,
        }
    }
    return new_event(
        payload=payload,
        actor=actor,
        source=source,
        recipient=recipient,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


GRANTED = "APPROVAL_OUTCOME_GRANTED"
DENIED = "APPROVAL_OUTCOME_DENIED"


def approval_decided(
    *,
    approval_id: str,
    approver: ActorRef,
    outcome: str,
    reason: str = "",
    actor: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build `approval.granted` (outcome GRANTED) or `approval.denied` (outcome DENIED)."""

    payload = {
        "approvalDecided": {
            "approvalId": approval_id,
            "approver": approver.to_json(),
            "outcome": outcome,
            "reason": reason,
        }
    }
    return new_event(
        payload=payload,
        actor=approver if actor is None else actor,
        source=approver if source is None else source,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def escalation_triggered(
    *,
    escalation_id: str,
    reason: str,
    related_approval_id: str,
    agent: ActorRef,
    approver: ActorRef,
    actor: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build an `escalation.triggered` event addressed to the approver."""

    payload = {
        "escalationTriggered": {
            "escalationId": escalation_id,
            "reason": reason,
            "relatedApprovalId": related_approval_id,
            "source": agent.to_json(),
            "target": approver.to_json(),
        }
    }
    return new_event(
        payload=payload,
        actor=actor,
        source=source,
        recipient=approver,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def approval_expired(
    *,
    approval_id: str,
    reason: str,
    actor: ActorRef | None = None,
    source: ActorRef | None = None,
    channel: Mapping[str, object] | None = None,
    conversation: Mapping[str, object] | None = None,
    correlation_id: str = "",
    causation_id: str = "",
    event_id: str | None = None,
) -> EventEnvelope:
    """Build an `approval.expired` event."""

    return new_event(
        payload={"approvalExpired": {"approvalId": approval_id, "reason": reason}},
        actor=actor,
        source=actor if source is None else source,
        channel=channel,
        conversation=conversation,
        correlation_id=correlation_id,
        causation_id=causation_id,
        event_id=event_id,
    )


def to_json(event: EventEnvelope) -> JsonObject:
    """Serialize a validated event to ProtoJSON."""

    validate_event(event)
    value: JsonObject = {
        "eventId": event.event_id,
        "protocolVersion": PROTOCOL_VERSION,
        "occurredAt": event.occurred_at,
    }
    for name, actor in (
        ("source", event.source),
        ("actor", event.actor),
        ("recipient", event.recipient),
    ):
        if actor is not None:
            value[name] = actor.to_json()
    for name, item in (("channel", event.channel), ("conversation", event.conversation)):
        if item is not None:
            value[name] = item
    if event.correlation_id:
        value["correlationId"] = event.correlation_id
    if event.causation_id:
        value["causationId"] = event.causation_id
    if event.idempotency_key:
        value["idempotencyKey"] = event.idempotency_key
    if event.extensions:
        value["extensions"] = dict(event.extensions)
    value.update(event.payload)
    return value


def from_json(value: Mapping[str, object]) -> EventEnvelope:
    """Parse and validate a ProtoJSON event. Rejects any protocol version other than 0.2."""

    if "eventType" in value:
        raise ValueError(
            "OCP envelope must not include eventType; the payload identifies the event"
        )
    version = value.get("protocolVersion")
    if version != PROTOCOL_VERSION:
        raise ValueError(f"Unsupported OCP protocol_version: {version!r}")
    event = EventEnvelope(
        actor=_actor_from_json(_mapping_or_none(value.get("actor"))),
        causation_id=str(value.get("causationId", "")),
        channel=_optional_mapping(value.get("channel"), "channel"),
        conversation=_optional_mapping(value.get("conversation"), "conversation"),
        correlation_id=str(value.get("correlationId", "")),
        event_id=str(value.get("eventId", "")),
        extensions={str(key): str(item) for key, item in _mapping(value.get("extensions")).items()},
        idempotency_key=str(value.get("idempotencyKey", "")),
        occurred_at=str(value.get("occurredAt", "")),
        payload={key: item for key, item in value.items() if key not in _ENVELOPE_FIELDS},
        recipient=_actor_from_json(_mapping_or_none(value.get("recipient"))),
        source=_actor_from_json(_mapping_or_none(value.get("source"))),
    )
    validate_event(event)
    return event


def to_binary(event: EventEnvelope) -> bytes:
    """Serialize a validated event as protobuf wire bytes (byte-compatible with the TypeScript SDK).

    The encoding comes from the stdlib-only codec in `ocp-sdk._wire`; no protobuf runtime is
    required.
    """

    return encode_event(to_json(event))


def from_binary(value: bytes | bytearray) -> EventEnvelope:
    """Decode and validate protobuf wire bytes. Binary needs no version: there is only one."""

    try:
        decoded = decode_event(bytes(value))
    except ValueError as error:
        raise ValueError("Invalid OCP binary event") from error
    return from_json(decoded)

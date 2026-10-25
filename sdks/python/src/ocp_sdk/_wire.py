"""Stdlib-only protobuf wire codec for the OCP event envelope.

The schema tables below mirror proto/ocp/types/*.proto and proto/ocp/api/events.proto. Messages are
exchanged as ProtoJSON-shaped dicts using the camelCase keys the models already use; enums are
ProtoJSON names such as "ACTOR_TYPE_AGENT"; timestamps are RFC 3339 strings.

Encoding follows protobuf-es: fields in ascending number order, proto3 implicit-presence scalars
omitted at their default, message fields emitted whenever the key is present, repeated fields
emitted per element, map entries emitted as {key=1, value=2}, and only the set oneof case.
Unknown fields on decode are skipped (protobuf semantics); unknown keys on encode are errors.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

_WIRE_VARINT = 0
_WIRE_LEN = 2

_INT64_MASK = (1 << 64) - 1
_EPOCH = datetime(1970, 1, 1)
_TIMESTAMP_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})"
)


@dataclass(frozen=True, slots=True)
class _Field:
    number: int
    name: str
    # "string" | "bool" | "enum" | "message" | "timestamp" | "map"
    kind: str
    target: str | None = None
    repeated: bool = False
    oneof: bool = False


def _f(
    number: int,
    name: str,
    kind: str = "string",
    target: str | None = None,
    *,
    repeated: bool = False,
    oneof: bool = False,
) -> _Field:
    return _Field(number, name, kind, target, repeated, oneof)


# Enum name -> number (proto3 enums; the zero value is the UNSPECIFIED default).
ENUMS: dict[str, dict[str, int]] = {
    "ActorType": {
        "ACTOR_TYPE_UNSPECIFIED": 0,
        "ACTOR_TYPE_HUMAN": 1,
        "ACTOR_TYPE_AGENT": 2,
        "ACTOR_TYPE_SYSTEM": 3,
    },
    "ApprovalOutcome": {
        "APPROVAL_OUTCOME_UNSPECIFIED": 0,
        "APPROVAL_OUTCOME_GRANTED": 1,
        "APPROVAL_OUTCOME_DENIED": 2,
        "APPROVAL_OUTCOME_EXPIRED": 3,
    },
    "ConversationStatus": {
        "CONVERSATION_STATUS_UNSPECIFIED": 0,
        "CONVERSATION_STATUS_OPEN": 1,
        "CONVERSATION_STATUS_PAUSED": 2,
        "CONVERSATION_STATUS_CLOSED": 3,
    },
}

# Message name -> fields. Source: proto/ocp/types/*.proto.
MESSAGES: dict[str, tuple[_Field, ...]] = {
    "ActorRef": (
        _f(1, "id"),
        _f(2, "type", "enum", "ActorType"),
        _f(3, "displayName"),
        _f(4, "authority"),
        _f(5, "capabilities", repeated=True),
    ),
    "ActionRequest": (
        _f(1, "actionId"),
        _f(2, "type"),
        _f(3, "target"),
        _f(4, "parameters", "map"),
    ),
    "ArtifactRef": (
        _f(1, "id"),
        _f(2, "uri"),
        _f(3, "title"),
        _f(4, "mediaType"),
        _f(5, "sourceOfTruth"),
    ),
    "ChannelRef": (
        _f(1, "provider"),
        _f(2, "channelId"),
        _f(3, "threadId"),
        _f(4, "address"),
    ),
    "ConversationRef": (
        _f(1, "id"),
        _f(2, "status", "enum", "ConversationStatus"),
        _f(3, "participants", "message", "ActorRef", repeated=True),
    ),
    "ActionExecuted": (
        _f(1, "action", "message", "ActionRequest"),
        _f(2, "result"),
        _f(3, "artifacts", "message", "ArtifactRef", repeated=True),
    ),
    "ActionFailed": (
        _f(1, "action", "message", "ActionRequest"),
        _f(2, "errorCode"),
        _f(3, "errorMessage"),
        _f(4, "retryable", "bool"),
    ),
    "ApprovalRequested": (
        _f(1, "approvalId"),
        _f(2, "agent", "message", "ActorRef"),
        _f(3, "requestedAction", "message", "ActionRequest"),
        _f(4, "reason"),
        _f(5, "approver", "message", "ActorRef"),
        _f(6, "deadline", "timestamp"),
    ),
    "ApprovalDecided": (
        _f(1, "approvalId"),
        _f(2, "approver", "message", "ActorRef"),
        _f(3, "outcome", "enum", "ApprovalOutcome"),
        _f(4, "reason"),
    ),
    "ApprovalExpired": (
        _f(1, "approvalId"),
        _f(2, "reason"),
    ),
    "EscalationTriggered": (
        _f(1, "escalationId"),
        _f(2, "source", "message", "ActorRef"),
        _f(3, "target", "message", "ActorRef"),
        _f(4, "reason"),
        _f(5, "relatedApprovalId"),
    ),
    "HandoffInitiated": (
        _f(1, "handoffId"),
        _f(2, "from", "message", "ActorRef"),
        _f(3, "to", "message", "ActorRef"),
        _f(4, "reason"),
        _f(5, "openQuestions", repeated=True),
    ),
    "HandoffCompleted": (
        _f(1, "handoffId"),
        _f(2, "completedBy", "message", "ActorRef"),
        _f(3, "outcome"),
    ),
    "MessageReceived": (
        _f(1, "text"),
        _f(2, "attachments", "message", "ArtifactRef", repeated=True),
        _f(3, "metadata", "map"),
    ),
    "MessageSent": (
        _f(1, "text"),
        _f(2, "attachments", "message", "ArtifactRef", repeated=True),
        _f(3, "metadata", "map"),
    ),
    "PolicyEvaluated": (
        _f(1, "policyId"),
        _f(2, "allowed", "bool"),
        _f(3, "approvalRequired", "bool"),
        _f(4, "reason"),
        _f(5, "actionType"),
        _f(6, "recipient", "message", "ActorRef"),
    ),
    "TaskCreated": (
        _f(1, "taskId"),
        _f(2, "intent"),
        _f(3, "description"),
        _f(4, "requestedBy", "message", "ActorRef"),
    ),
    "TaskAssigned": (
        _f(1, "taskId"),
        _f(2, "assignee", "message", "ActorRef"),
        _f(3, "reason"),
    ),
}

# Payload oneof cases shared by both envelopes (field numbers 20-32).
_PAYLOAD_CASES: tuple[tuple[int, str, str], ...] = (
    (20, "messageReceived", "MessageReceived"),
    (21, "messageSent", "MessageSent"),
    (22, "taskCreated", "TaskCreated"),
    (23, "taskAssigned", "TaskAssigned"),
    (24, "approvalRequested", "ApprovalRequested"),
    (25, "approvalDecided", "ApprovalDecided"),
    (26, "approvalExpired", "ApprovalExpired"),
    (27, "escalationTriggered", "EscalationTriggered"),
    (28, "handoffInitiated", "HandoffInitiated"),
    (29, "handoffCompleted", "HandoffCompleted"),
    (30, "policyEvaluated", "PolicyEvaluated"),
    (31, "actionExecuted", "ActionExecuted"),
    (32, "actionFailed", "ActionFailed"),
)


def _payload_fields() -> tuple[_Field, ...]:
    return tuple(
        _f(number, name, "message", target, oneof=True) for number, name, target in _PAYLOAD_CASES
    )


# Envelope schema. Source: proto/ocp/api/events.proto. Field 2 is reserved (the removed event_type);
# the payload oneof is the event kind.
ENVELOPE: tuple[_Field, ...] = (
    _f(1, "eventId"),
    _f(3, "protocolVersion"),
    _f(4, "occurredAt", "timestamp"),
    _f(5, "source", "message", "ActorRef"),
    _f(6, "actor", "message", "ActorRef"),
    _f(7, "recipient", "message", "ActorRef"),
    _f(8, "channel", "message", "ChannelRef"),
    _f(9, "conversation", "message", "ConversationRef"),
    _f(10, "correlationId"),
    _f(11, "causationId"),
    _f(12, "idempotencyKey"),
    _f(13, "extensions", "map"),
) + _payload_fields()

# Schema message name -> fields, including the envelope.
_ALL_MESSAGES: dict[str, tuple[_Field, ...]] = {**MESSAGES, "EventEnvelope": ENVELOPE}


@dataclass(frozen=True, slots=True)
class _MessageSpec:
    """Lookup tables for one message, precomputed once instead of per encode/decode call."""

    ordered: tuple[_Field, ...]
    by_name: dict[str, _Field]
    by_number: dict[int, _Field]
    oneof_names: frozenset[str]


_SPECS: dict[str, _MessageSpec] = {
    name: _MessageSpec(
        ordered=tuple(sorted(fields, key=lambda item: item.number)),
        by_name={field.name: field for field in fields},
        by_number={field.number: field for field in fields},
        oneof_names=frozenset(field.name for field in fields if field.oneof),
    )
    for name, fields in _ALL_MESSAGES.items()
}

# Enum number -> ProtoJSON name, the reverse of ENUMS.
_ENUM_NAMES: dict[str, dict[int, str]] = {
    enum: {number: name for name, number in values.items()} for enum, values in ENUMS.items()
}


# ---------------------------------------------------------------- primitives


# Single-byte varints, precomputed so the encoder does not allocate them for every small value.
_ONE_BYTE_VARINTS: tuple[bytes, ...] = tuple(bytes((value,)) for value in range(0x80))


def _write_varint(value: int) -> bytes:
    if 0 <= value < 0x80:
        return _ONE_BYTE_VARINTS[value]
    if value < 0:
        value &= _INT64_MASK
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


# Length-delimited tags for every field number in the schema, precomputed once.
_LEN_TAGS: dict[int, bytes] = {
    number: _write_varint((number << 3) | _WIRE_LEN) for number in range(1, 64)
}


def _read_varint(data: bytes, pos: int) -> tuple[int, int]:
    # Tags and lengths are almost always one byte; return that without the loop.
    if pos < len(data) and data[pos] < 0x80:
        return data[pos], pos + 1
    result = 0
    shift = 0
    while True:
        if pos >= len(data) or shift > 63:
            raise ValueError("Malformed protobuf varint")
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def _write_tag(number: int, wire_type: int) -> bytes:
    return _write_varint((number << 3) | wire_type)


def _write_len(number: int, payload: bytes) -> bytes:
    return _write_tag(number, _WIRE_LEN) + _write_varint(len(payload)) + payload


def _write_varint_field(number: int, value: int) -> bytes:
    return _write_tag(number, _WIRE_VARINT) + _write_varint(value)


def _signed64(value: int) -> int:
    return value - (1 << 64) if value >= (1 << 63) else value


# ---------------------------------------------------------------- timestamps


def _timestamp_to_parts(value: str) -> tuple[int, int]:
    """RFC 3339 string -> (seconds since epoch, nanos). Accepts any fraction up to 9 digits."""

    match = _TIMESTAMP_RE.fullmatch(value)
    if match is None:
        raise ValueError(f"Invalid RFC 3339 timestamp: {value!r}")
    local = datetime.fromisoformat(match.group(1))
    zone = match.group(3)
    offset = 0
    if zone != "Z":
        offset = int(zone[1:3]) * 3600 + int(zone[4:6]) * 60
        if zone[0] == "-":
            offset = -offset
    delta = local - _EPOCH
    seconds = delta.days * 86400 + delta.seconds - offset
    fraction = match.group(2) or ""
    nanos = int(fraction.ljust(9, "0")) if fraction else 0
    return seconds, nanos


def _parts_to_timestamp(seconds: int, nanos: int) -> str:
    """(seconds, nanos) -> RFC 3339 UTC string, using 3, 6 or 9 fraction digits as protobuf-es does."""

    if not 0 <= nanos <= 999_999_999:
        raise ValueError(f"Timestamp nanos out of range: {nanos}")
    moment = _EPOCH + timedelta(seconds=seconds)
    text = (
        f"{moment.year:04d}-{moment.month:02d}-{moment.day:02d}"
        f"T{moment.hour:02d}:{moment.minute:02d}:{moment.second:02d}"
    )
    if nanos == 0:
        return f"{text}Z"
    if nanos % 1_000_000 == 0:
        return f"{text}.{nanos // 1_000_000:03d}Z"
    if nanos % 1_000 == 0:
        return f"{text}.{nanos // 1_000:06d}Z"
    return f"{text}.{nanos:09d}Z"


def _encode_timestamp(value: str) -> bytes:
    seconds, nanos = _timestamp_to_parts(value)
    out = b""
    if seconds:
        out += _write_varint_field(1, seconds)
    if nanos:
        out += _write_varint_field(2, nanos)
    return out


def _decode_timestamp(data: bytes) -> str:
    seconds = 0
    nanos = 0
    pos = 0
    while pos < len(data):
        key, pos = _read_varint(data, pos)
        number, wire = key >> 3, key & 7
        if wire != _WIRE_VARINT or number not in (1, 2):
            raise ValueError("Malformed google.protobuf.Timestamp")
        value, pos = _read_varint(data, pos)
        if number == 1:
            seconds = _signed64(value)
        else:
            nanos = value
    return _parts_to_timestamp(seconds, nanos)


# ---------------------------------------------------------------- encode


def _encode_scalar(field: _Field, item: object) -> bytes | None:
    """Single value of a non-message field. Returns None when proto3 implicit presence omits it."""

    if field.kind == "string":
        if not isinstance(item, str):
            raise TypeError(f"{field.name} must be a string")
        if item == "":
            return None
        return _write_len(field.number, item.encode("utf-8"))
    if field.kind == "bool":
        if not isinstance(item, bool):
            raise TypeError(f"{field.name} must be a bool")
        return _write_varint_field(field.number, 1) if item else None
    if field.kind == "enum":
        number = _enum_number(field.target or "", item)
        return _write_varint_field(field.number, number) if number else None
    raise AssertionError(f"unexpected scalar kind {field.kind}")


def _enum_number(enum_name: str, item: object) -> int:
    if isinstance(item, bool) or not isinstance(item, (str, int)):
        raise TypeError(f"{enum_name} must be a ProtoJSON enum name or number")
    if isinstance(item, int):
        if not 0 <= item < (1 << 31):
            raise ValueError(f"{enum_name} number out of range: {item}")
        return item
    numbers = ENUMS[enum_name]
    if item not in numbers:
        raise ValueError(f"Unknown {enum_name} value: {item!r}")
    return numbers[item]


def _encode_map(field: _Field, item: object) -> bytes:
    if not isinstance(item, Mapping):
        raise TypeError(f"{field.name} must be a mapping")
    out = b""
    for key, value in item.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise TypeError(f"{field.name} entries must be string to string")
        # Map entries always carry both key and value, even when empty.
        entry = _write_len(1, key.encode("utf-8")) + _write_len(2, value.encode("utf-8"))
        out += _write_len(field.number, entry)
    return out


def _encode_one(field: _Field, item: object) -> bytes:
    """Encode one value. Repeated elements are emitted individually, even when empty."""

    if field.kind == "timestamp":
        if not isinstance(item, str):
            raise TypeError(f"{field.name} must be an RFC 3339 string")
        return _write_len(field.number, _encode_timestamp(item))
    if field.kind == "message":
        if not isinstance(item, Mapping):
            raise TypeError(f"{field.name} must be a mapping")
        return _write_len(field.number, _encode_message(field.target or "", item))
    if field.repeated and field.kind == "string":
        if not isinstance(item, str):
            raise TypeError(f"{field.name} elements must be strings")
        return _write_len(field.number, item.encode("utf-8"))
    encoded = _encode_scalar(field, item)
    return b"" if encoded is None else encoded


def _encode_field(field: _Field, item: object) -> bytes:
    if field.kind == "map":
        return _encode_map(field, item)
    if field.repeated:
        if not isinstance(item, (list, tuple)):
            raise TypeError(f"{field.name} must be a list")
        return b"".join(_encode_one(field, element) for element in item)
    return _encode_one(field, item)


def _encode_message(message: str, value: Mapping[str, object]) -> bytes:
    spec = _SPECS[message]
    for key in value:
        if key not in spec.by_name:
            unknown = sorted(key for key in value if key not in spec.by_name)
            raise ValueError(f"{message} has unsupported field(s): {', '.join(unknown)}")
    if spec.oneof_names:
        oneof_present = [name for name in spec.oneof_names if value.get(name) is not None]
        if len(oneof_present) > 1:
            raise ValueError(f"{message} payload must have exactly one case, got {oneof_present}")

    out = bytearray()
    for field in spec.ordered:
        item = value.get(field.name)
        if item is None:
            continue
        # Fast paths for the two shapes that dominate events: singular strings and messages.
        if not field.repeated and field.kind == "string":
            if not isinstance(item, str):
                raise TypeError(f"{field.name} must be a string")
            if item:
                data = item.encode("utf-8")
                out += _LEN_TAGS[field.number] + _write_varint(len(data)) + data
            continue
        if not field.repeated and field.kind == "message":
            if not isinstance(item, Mapping):
                raise TypeError(f"{field.name} must be a mapping")
            body = _encode_message(field.target or "", item)
            out += _LEN_TAGS[field.number] + _write_varint(len(body)) + body
            continue
        out += _encode_field(field, item)
    return bytes(out)


def encode_event(value: Mapping[str, object]) -> bytes:
    """Encode a ProtoJSON-shaped event dict as an OCP EventEnvelope."""

    return _encode_message("EventEnvelope", value)


# ---------------------------------------------------------------- decode


def _decode_scalar(field: _Field, wire: int, data: bytes, pos: int) -> tuple[object, int]:
    if field.kind == "bool" or field.kind == "enum":
        if wire != _WIRE_VARINT:
            raise ValueError(f"Wrong wire type for {field.name}")
        number, pos = _read_varint(data, pos)
        if field.kind == "bool":
            return number != 0, pos
        return _ENUM_NAMES[field.target or ""].get(number, number), pos
    if wire != _WIRE_LEN:
        raise ValueError(f"Wrong wire type for {field.name}")
    length, pos = _read_varint(data, pos)
    end = pos + length
    if end > len(data):
        raise ValueError("Truncated protobuf length-delimited field")
    chunk = data[pos:end]
    if field.kind == "string":
        return chunk.decode("utf-8"), end
    if field.kind == "timestamp":
        return _decode_timestamp(chunk), end
    if field.kind == "message":
        return _decode_message(field.target or "", chunk), end
    raise AssertionError(f"unexpected kind {field.kind}")


def _decode_map_entry(data: bytes) -> tuple[str, str]:
    key = ""
    value = ""
    pos = 0
    while pos < len(data):
        tag, pos = _read_varint(data, pos)
        number, wire = tag >> 3, tag & 7
        if wire != _WIRE_LEN or number not in (1, 2):
            raise ValueError("Malformed map entry")
        length, pos = _read_varint(data, pos)
        end = pos + length
        if end > len(data):
            raise ValueError("Truncated map entry")
        text = data[pos:end].decode("utf-8")
        if number == 1:
            key = text
        else:
            value = text
        pos = end
    return key, value


def _skip(data: bytes, pos: int, wire: int) -> int:
    if wire == _WIRE_VARINT:
        _, pos = _read_varint(data, pos)
        return pos
    if wire == 1:
        pos += 8
    elif wire == _WIRE_LEN:
        length, pos = _read_varint(data, pos)
        pos += length
    elif wire == 5:
        pos += 4
    else:
        raise ValueError(f"Unsupported protobuf wire type {wire}")
    if pos > len(data):
        raise ValueError("Truncated protobuf field")
    return pos


def _decode_message(message: str, data: bytes) -> dict[str, object]:
    spec = _SPECS[message]
    result: dict[str, object] = {}
    pos = 0
    while pos < len(data):
        key, pos = _read_varint(data, pos)
        number, wire = key >> 3, key & 7
        if number == 0:
            raise ValueError("Invalid protobuf field number 0")
        field = spec.by_number.get(number)
        if field is None:
            pos = _skip(data, pos, wire)
            continue
        if field.kind == "map":
            if wire != _WIRE_LEN:
                raise ValueError(f"Wrong wire type for {field.name}")
            length, pos = _read_varint(data, pos)
            end = pos + length
            if end > len(data):
                raise ValueError("Truncated map field")
            entry_key, entry_value = _decode_map_entry(data[pos:end])
            pos = end
            entries = result.get(field.name)
            if not isinstance(entries, dict):
                entries = {}
                result[field.name] = entries
            entries[entry_key] = entry_value
            continue
        item, pos = _decode_scalar(field, wire, data, pos)
        if field.oneof:
            # A oneof holds one case: the last one on the wire wins.
            for name in spec.oneof_names:
                if name != field.name:
                    result.pop(name, None)
        if field.repeated:
            items = result.get(field.name)
            if not isinstance(items, list):
                items = []
                result[field.name] = items
            items.append(item)
        else:
            result[field.name] = item
    return result


def decode_event(data: bytes) -> dict[str, object]:
    """Decode EventEnvelope bytes into a ProtoJSON-shaped dict.

    The dict contains only fields present on the wire; the caller applies proto3 defaults. Unknown
    fields, including the reserved field 2 that older envelopes used for event_type, are skipped.
    """

    return _decode_message("EventEnvelope", bytes(data))

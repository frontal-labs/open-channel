"""Checks the stdlib codec against the protobuf-generated EventEnvelope.

Needs the `protobuf>=7.35` dev dependency and the generated bindings in proto/gen/python. Skipped
when either is unavailable, so the SDK's test suite runs without protobuf.
"""

import sys
import unittest
from datetime import UTC, datetime
from pathlib import Path

from ocp_sdk import (
    ActorRef,
    action_executed,
    action_failed,
    approval_requested,
    event_type,
    from_binary,
    message_received,
    new_event,
    to_binary,
    to_json,
)

GENERATED = Path(__file__).resolve().parents[3] / "proto" / "gen" / "python"

try:
    sys.path.insert(0, str(GENERATED))
    from google.protobuf import json_format
    from ocp.api import events_pb2

    PROTOBUF_AVAILABLE = True
except Exception:  # missing dependency, missing bindings, or a runtime older than the gencode
    PROTOBUF_AVAILABLE = False

HUMAN = ActorRef("human:a", type="ACTOR_TYPE_HUMAN", display_name="A", capabilities=("x", "y"))
AGENT = ActorRef("agent:b", display_name="B", authority="tenant:x")
ACTION = {"actionId": "act-1", "type": "deploy", "parameters": {"env": "staging", "z": "1"}}


def _samples():
    return [
        message_received(
            text="hi",
            actor=HUMAN,
            recipient=AGENT,
            channel={"provider": "slack", "channelId": "C1", "threadId": "t"},
            conversation={"id": "conv", "status": "CONVERSATION_STATUS_OPEN"},
            attachments=[{"uri": "https://e.test/x", "mediaType": "text/plain", "title": "t"}],
            metadata={"k": "v"},
            correlation_id="corr",
            causation_id="cause",
            event_id="evt-1",
        ),
        approval_requested(
            agent=AGENT,
            approver=HUMAN,
            approval_id="ap1",
            reason="why",
            requested_action=ACTION,
            deadline=datetime(2030, 1, 1, 12, 30, 15, 500000, tzinfo=UTC),
        ),
        action_executed(action=ACTION, result="ok"),
        action_failed(action=ACTION, error_code="E", error_message="m", retryable=True),
        new_event(
            payload={
                "policyEvaluated": {
                    "policyId": "p",
                    "allowed": False,
                    "approvalRequired": True,
                    "reason": "r",
                    "actionType": "deploy",
                }
            },
            extensions={"a": "b"},
            idempotency_key="idem",
        ),
    ]


@unittest.skipUnless(PROTOBUF_AVAILABLE, "needs protobuf>=7.35 and proto/gen/python")
class ProtobufCompatTests(unittest.TestCase):
    def test_encoding_matches_generated_envelope_byte_for_byte(self) -> None:
        for event in _samples():
            with self.subTest(event=event_type(event)):
                generated = events_pb2.EventEnvelope()
                json_format.ParseDict(to_json(event), generated)
                self.assertEqual(to_binary(event), generated.SerializeToString(deterministic=True))

    def test_generated_bytes_decode_to_the_same_event(self) -> None:
        for event in _samples():
            with self.subTest(event=event_type(event)):
                generated = events_pb2.EventEnvelope()
                json_format.ParseDict(to_json(event), generated)
                decoded = from_binary(generated.SerializeToString(deterministic=True))
                self.assertEqual(event_type(decoded), event_type(event))
                self.assertEqual(to_binary(decoded), to_binary(event))


if __name__ == "__main__":
    unittest.main()

import base64
import json
import unittest
from datetime import UTC, datetime
from pathlib import Path

from ocp_sdk import (
    ActorRef,
    EventEnvelope,
    action_executed,
    action_failed,
    approval_requested,
    event_type,
    from_binary,
    to_binary,
    to_json,
)

# Written by the TypeScript encoder (protobuf-es); the Python codec must match it byte for byte.
FIXTURE_PATH = (
    Path(__file__).resolve().parent / "../../../packages/protocol/tests/fixtures/event-parity.json"
)

AGENT = ActorRef("agent:approvals", type="ACTOR_TYPE_AGENT", display_name="Approvals Agent")
APPROVER = ActorRef("human:approver", type="ACTOR_TYPE_HUMAN", display_name="Approver")
DEADLINE = datetime(2030, 1, 1, tzinfo=UTC)
ACTION = {
    "actionId": "action-release-1",
    "type": "deploy.release",
    "target": "staging",
    "parameters": {"env": "staging"},
}


def _load_fixture() -> list[dict[str, str]]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


class ParityFixtureTests(unittest.TestCase):
    def test_fixture_covers_every_payload_kind_once(self) -> None:
        entries = _load_fixture()
        self.assertEqual(len(entries), 15)
        self.assertEqual(len({entry["eventType"] for entry in entries}), 15)

    def test_each_entry_decodes_by_payload_and_re_encodes_byte_identical(self) -> None:
        for entry in _load_fixture():
            with self.subTest(name=entry["name"]):
                data = base64.b64decode(entry["binary"])

                event = from_binary(data)
                self.assertEqual(event_type(event), entry["eventType"])
                self.assertEqual(to_json(event)["protocolVersion"], "2.0")

                self.assertEqual(to_binary(event), data)


class BuilderBinaryRoundTripTests(unittest.TestCase):
    def _assert_round_trip(self, event: EventEnvelope, expected_type: str) -> None:
        data = to_binary(event)
        decoded = from_binary(data)
        self.assertEqual(event_type(decoded), expected_type)
        self.assertEqual(decoded.payload_case, event.payload_case)
        self.assertEqual(decoded.event_id, event.event_id)
        # proto3 drops default-valued scalars (false, "") on the wire, so compare non-default values.
        case = event.payload_case
        self.assertEqual(set(decoded.payload), {case})
        for key, item in event.payload[case].items():
            if item in ("", False) or item == {} or item == []:
                continue
            self.assertEqual(decoded.payload[case][key], item, key)
        self.assertEqual(to_binary(decoded), data)

    def test_approval_requested_round_trips(self) -> None:
        event = approval_requested(
            agent=AGENT,
            approver=APPROVER,
            approval_id="approval-1",
            reason="needs sign-off",
            requested_action=ACTION,
            deadline=DEADLINE,
            correlation_id="corr-1",
        )
        self._assert_round_trip(event, "approval.requested")

    def test_action_executed_round_trips(self) -> None:
        event = action_executed(action=ACTION, result="released")
        self._assert_round_trip(event, "action.executed")

    def test_action_failed_round_trips(self) -> None:
        event = action_failed(
            action=ACTION,
            error_code="RATE_LIMITED",
            error_message="slow down",
            retryable=True,
        )
        self._assert_round_trip(event, "action.failed")


if __name__ == "__main__":
    unittest.main()

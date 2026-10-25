import unittest

from ocp_sdk import (
    PROTOCOL_VERSION,
    ActorRef,
    event_type,
    from_binary,
    from_json,
    message_received,
    new_event,
    to_binary,
    to_json,
    validate_event,
)
from ocp_sdk._wire import encode_event

HUMAN = ActorRef("human:gabriel", type="ACTOR_TYPE_HUMAN")
APPROVER = ActorRef("human:approver", type="ACTOR_TYPE_HUMAN")
ACTION = {"actionId": "action-1", "type": "deploy.release"}


def _policy(allowed: bool) -> dict[str, object]:
    return {
        "policyEvaluated": {
            "policyId": "policy-1",
            "allowed": allowed,
            "approvalRequired": not allowed,
            "reason": "rule matched",
            "actionType": "deploy.release",
        }
    }


class EventNameTests(unittest.TestCase):
    def test_name_is_derived_from_payload(self) -> None:
        event = message_received(text="hi", actor=HUMAN)
        self.assertEqual(event_type(event), "message.received")

    def test_approval_outcome_selects_granted_or_denied(self) -> None:
        for outcome, expected in (
            ("APPROVAL_OUTCOME_GRANTED", "approval.granted"),
            ("APPROVAL_OUTCOME_DENIED", "approval.denied"),
        ):
            with self.subTest(outcome=outcome):
                event = new_event(
                    payload={"approvalDecided": {"approvalId": "a1", "outcome": outcome}}
                )
                self.assertEqual(event_type(event), expected)

    def test_policy_result_selects_allowed_or_blocked(self) -> None:
        for allowed, expected in ((True, "policy.allowed"), (False, "policy.blocked")):
            with self.subTest(allowed=allowed):
                event = new_event(payload=_policy(allowed))
                self.assertEqual(event_type(event), expected)


class ProtocolVersionTests(unittest.TestCase):
    def test_protocol_version_is_0_2(self) -> None:
        self.assertEqual(PROTOCOL_VERSION, "2.0")
        self.assertEqual(
            to_json(message_received(text="hi", actor=HUMAN))["protocolVersion"], "2.0"
        )

    def test_json_never_carries_event_type(self) -> None:
        self.assertNotIn("eventType", to_json(message_received(text="hi", actor=HUMAN)))

    def test_json_rejects_missing_or_other_versions(self) -> None:
        for value in (None, "0.1", "1.0"):
            with self.subTest(version=value):
                data = to_json(message_received(text="hi", actor=HUMAN))
                data["protocolVersion"] = value
                if value is None:
                    del data["protocolVersion"]
                with self.assertRaises(ValueError):
                    from_json(data)

    def test_json_rejects_event_type_field(self) -> None:
        data = to_json(message_received(text="hi", actor=HUMAN))
        data["eventType"] = "message.received"
        with self.assertRaisesRegex(ValueError, "must not include eventType"):
            from_json(data)

    def test_binary_reads_legacy_event_type_field_and_drops_it(self) -> None:
        # Field 2 (event_type) was removed; old encoders still write it. It is skipped on decode.
        current = encode_event(to_json(message_received(text="hi", actor=HUMAN)))
        name = b"message.received"
        legacy = bytes([(2 << 3) | 2, len(name)]) + name + current
        event = from_binary(legacy)
        self.assertEqual(event_type(event), "message.received")
        self.assertEqual(to_binary(event), current)


class ValidationTests(unittest.TestCase):
    def test_approval_request_requires_deadline(self) -> None:
        with self.assertRaisesRegex(ValueError, "deadline"):
            new_event(
                payload={
                    "approvalRequested": {
                        "approvalId": "a1",
                        "agent": {"id": "agent:x"},
                        "approver": APPROVER.to_json(),
                        "requestedAction": ACTION,
                    }
                }
            )

    def test_exactly_one_typed_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly one typed payload"):
            new_event(payload={"messageReceived": {"text": "a"}, "messageSent": {"text": "b"}})

    def test_validate_rejects_missing_event_id(self) -> None:
        event = message_received(text="hi", actor=HUMAN)
        event.event_id = ""
        with self.assertRaisesRegex(ValueError, "event_id"):
            validate_event(event)

    def test_builders_round_trip_through_binary(self) -> None:
        event = new_event(payload=_policy(False), correlation_id="corr-1")
        decoded = from_binary(to_binary(event))
        self.assertEqual(event_type(decoded), "policy.blocked")
        self.assertEqual(decoded.correlation_id, "corr-1")


if __name__ == "__main__":
    unittest.main()

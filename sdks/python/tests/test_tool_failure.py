import unittest

from ocp_sdk import ActionError, AuthorizationError, DeliveryError, to_tool_failure


class ToolFailureTests(unittest.TestCase):
    def test_authorization_failure_has_only_scope_code_and_fixed_text(self) -> None:
        result = to_tool_failure(AuthorizationError("rule secret-7 blocks send"))

        self.assertEqual(
            result,
            {
                "success": False,
                "error": {
                    "scope": "ocp",
                    "code": "OCP_AUTHORIZATION",
                    "message": "You're not allowed to do that.",
                },
            },
        )
        self.assertNotIn("secret-7", repr(result))

    def test_delivery_failure_uses_transport_text(self) -> None:
        result = to_tool_failure(DeliveryError("token secret-xyz was rejected"))

        self.assertEqual(result["error"]["code"], "OCP_TRANSPORT")
        self.assertEqual(result["error"]["message"], "The message couldn't be delivered.")

    def test_action_failure_uses_action_text(self) -> None:
        result = to_tool_failure(ActionError("quota secret"))

        self.assertEqual(result["error"]["message"], "The action couldn't be completed.")
        self.assertNotIn("secret", repr(result))

    def test_non_ocp_errors_are_reported_as_action_failures(self) -> None:
        result = to_tool_failure(ValueError("db password is wrong"))

        self.assertEqual(
            result,
            {
                "success": False,
                "error": {
                    "scope": "ocp",
                    "code": "OCP_ACTION",
                    "message": "Something went wrong.",
                },
            },
        )
        self.assertNotIn("password", repr(result))


if __name__ == "__main__":
    unittest.main()

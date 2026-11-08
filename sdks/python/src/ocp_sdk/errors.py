from __future__ import annotations

from typing import Any


class OpenChannelError(Exception):
    """Classified, vendor-neutral OCP failure."""

    code = "OCP_ERROR"

    def __init__(
        self,
        message: str,
        *,
        stage: str = "processing",
        retryable: bool = False,
        event_id: str | None = None,
        action_id: str | None = None,
        approval_id: str | None = None,
        provider: str | None = None,
        cause: BaseException | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.retryable = retryable
        self.event_id = event_id
        self.action_id = action_id
        self.approval_id = approval_id
        self.provider = provider
        self.cause = cause


class ActionError(OpenChannelError):
    code = "OCP_ACTION"


class DeliveryError(OpenChannelError):
    code = "OCP_TRANSPORT"


class AuthorizationError(OpenChannelError):
    code = "OCP_AUTHORIZATION"


def as_ocp_error(
    error: BaseException,
    *,
    stage: str = "processing",
    retryable: bool = False,
    event_id: str | None = None,
    action_id: str | None = None,
    approval_id: str | None = None,
    provider: str | None = None,
) -> OpenChannelError:
    """Return `error` unchanged if it is already an OpenChannelError, otherwise wrap it with its context."""

    if isinstance(error, OpenChannelError):
        return error
    return OpenChannelError(
        str(error),
        stage=stage,
        retryable=retryable,
        event_id=event_id,
        action_id=action_id,
        approval_id=approval_id,
        provider=provider,
        cause=error,
    )


GENERIC_CHANNEL_TEXT = "Something went wrong."

# Fixed text per code. Developer messages are never shown to a person in a channel or an agent.
_CHANNEL_TEXT_BY_CODE = {
    "OCP_ACTION": "The action couldn't be completed.",
    "OCP_AUTHORIZATION": "You're not allowed to do that.",
    "OCP_TRANSPORT": "The message couldn't be delivered.",
}


def to_tool_failure(error: BaseException) -> dict[str, Any]:
    """Return the tool result an agent receives for a failed action.

    The result contains only `success`, `error.scope`, `error.code` and fixed public text. Non-OCP
    errors are reported as `OCP_ACTION`, matching the TypeScript SDK.
    """

    if isinstance(error, OpenChannelError):
        code = error.code
        message = _CHANNEL_TEXT_BY_CODE.get(code, GENERIC_CHANNEL_TEXT)
    else:
        code = ActionError.code
        message = GENERIC_CHANNEL_TEXT
    return {"success": False, "error": {"scope": "ocp", "code": code, "message": message}}

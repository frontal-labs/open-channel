from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime

from .errors import OpenChannelError
from .logger import Logger, StderrLogger
from .models import (
    ActorRef,
    AgentCapabilities,
    AgentCard,
    AgentSkill,
    EventEnvelope,
    MessageReceived,
    event_type,
    message_sent,
)

# Callbacks may be sync or async; their results are awaited when awaitable and otherwise ignored.
Dispatch = Callable[[EventEnvelope], object]
ActionRequester = Callable[[str, object, Mapping[str, object] | None], Awaitable[object]]
AgentHandler = Callable[["AgentContext"], object]

# Keyword option -> key in the action mapping the app consumes.
_ACTION_OPTION_KEYS = {
    "action_id": "actionId",
    "approver": "approver",
    "reason": "reason",
    "deadline": "deadline",
    "target": "target",
    "channel": "channel",
    "conversation": "conversation",
    "recipient": "recipient",
}


def action_mapping(
    action_type: str, value: object, options: Mapping[str, object] | None = None
) -> dict[str, object]:
    """Build the action mapping the app consumes from a type, input, and keyword options."""

    mapped: dict[str, object] = {"type": action_type, "input": value}
    for name, item in (options or {}).items():
        if item is not None:
            mapped[_ACTION_OPTION_KEYS[name]] = item
    return mapped


async def _maybe_await(value: object) -> object:
    return (await value) if inspect.isawaitable(value) else value


class _Unset:
    """Marks a ReplyOptions field the caller did not set, so the event's own routing applies."""

    def __repr__(self) -> str:
        return "UNSET"


UNSET = _Unset()


@dataclass(frozen=True, slots=True)
class ReplyOptions:
    """Routing overrides for `AgentContext.reply()`. Unset fields inherit the inbound event's routing."""

    channel: Mapping[str, object] | None | _Unset = UNSET
    conversation: Mapping[str, object] | None | _Unset = UNSET
    recipient: ActorRef | None | _Unset = UNSET


def _reply_options(options: ReplyOptions | Mapping[str, object] | None) -> ReplyOptions:
    if options is None:
        return ReplyOptions()
    if isinstance(options, ReplyOptions):
        return options
    return ReplyOptions(**dict(options))


@dataclass(frozen=True, slots=True)
class AgentDefinition:
    id: str
    name: str
    on_message: AgentHandler
    description: str = ""
    version: str = "2.0.0"
    url: str = ""
    capabilities: AgentCapabilities = field(default_factory=AgentCapabilities)
    skills: tuple[AgentSkill, ...] = ()
    actor_capabilities: tuple[str, ...] = ()

    def card(self) -> AgentCard:
        return AgentCard(
            capabilities=self.capabilities,
            description=self.description,
            id=self.id,
            name=self.name,
            skills=self.skills,
            url=self.url,
            version=self.version,
        )


@dataclass(slots=True)
class AgentContext:
    """What an agent sees for one inbound message: the message, its routing, and two actions."""

    agent: ActorRef
    event: EventEnvelope
    message: MessageReceived
    channel: Mapping[str, object] | None = None
    conversation: Mapping[str, object] | None = None
    logger: Logger = field(default_factory=StderrLogger)
    _dispatch: Dispatch | None = None
    _requester: ActionRequester | None = None
    _replies: list[EventEnvelope] = field(default_factory=list)

    @property
    def replies(self) -> tuple[EventEnvelope, ...]:
        return tuple(self._replies)

    async def reply(
        self,
        text: str,
        options: ReplyOptions | Mapping[str, object] | None = None,
    ) -> EventEnvelope:
        """Build a message.sent reply to the current event and dispatch it if a sink is set."""

        opts = _reply_options(options)
        event = message_sent(
            actor=self.agent,
            channel=self.event.channel if opts.channel is UNSET else opts.channel,
            conversation=(
                self.event.conversation if opts.conversation is UNSET else opts.conversation
            ),
            recipient=self.event.actor if opts.recipient is UNSET else opts.recipient,
            text=text,
        )
        event.causation_id = self.event.event_id
        event.correlation_id = self.event.correlation_id or self.event.event_id
        self._replies.append(event)
        if self._dispatch is not None:
            await _maybe_await(self._dispatch(event))
        return event

    async def request(
        self,
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
    ) -> object:
        """Ask the app to run a registered action for this event. Policy and approval apply.

        `approver`, `reason`, and `deadline` apply only when the policy requires approval. The
        policy's own approver takes precedence over `approver`.
        """

        if self._requester is None:
            raise OpenChannelError(
                "OCP action handling is not configured for this agent", stage="action"
            )
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
        return await _maybe_await(self._requester(mapping["type"], mapping["input"], mapping))


class AgentHost:
    """Routes `message.received` events to agents. Internal to the app; use `open_channel()`."""

    def __init__(
        self,
        *,
        dispatch: Dispatch,
        requester: Callable[[Mapping[str, object], EventEnvelope], Awaitable[object]],
        logger: Logger,
    ) -> None:
        self._agents: dict[str, AgentDefinition] = {}
        self._dispatch = dispatch
        self._requester = requester
        self._logger = logger

    def register(self, agent: AgentDefinition) -> None:
        if agent.id in self._agents:
            raise ValueError(f"OCP agent is already registered: {agent.id}")
        self._agents[agent.id] = agent

    def cards(self) -> tuple[AgentCard, ...]:
        return tuple(agent.card() for agent in self._agents.values())

    async def handle(self, event: EventEnvelope) -> bool:
        """Route a message.received event to its recipient agent. Returns False if not routed."""

        message = event.message_received_payload()
        if message is None or event_type(event) != "message.received":
            return False
        definition = self._agents.get(event.recipient.id if event.recipient else "")
        if definition is None:
            return False

        async def request(
            action_type: str, value: object, options: Mapping[str, object] | None
        ) -> object:
            mapping = {**(options or {}), "type": action_type, "input": value}
            return await _maybe_await(self._requester(mapping, event))

        context = AgentContext(
            agent=ActorRef(
                capabilities=definition.actor_capabilities,
                display_name=definition.name,
                id=definition.id,
            ),
            channel=event.channel,
            conversation=event.conversation,
            event=event,
            logger=self._logger,
            message=message,
            _dispatch=self._dispatch,
            _requester=request,
        )
        await _maybe_await(definition.on_message(context))
        return True

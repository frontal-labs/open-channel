# ocp-sdk

The PyPI distribution is `ocp-sdk`, imported as `ocp-sdk`. It provides the OCP
event model (one envelope, protocol version `2.0`), typed event builders, an application
factory with agents, actions, channels, policy, and approvals, and transport-independent
source/sink contracts. The codec is stdlib-only: no protobuf runtime is required.

```bash
python -m pip install ocp-sdk
```

## Usage

```python
from ocp_sdk import (
    ActorRef,
    AgentDefinition,
    ChannelDefinition,
    PolicyDecision,
    action,
    open_channel,
)

reply = action(
    type="send_customer_reply",
    execute=lambda value, ctx: send_reply(value["ticketId"]),
)


async def on_message(ctx):
    await ctx.reply("I am looking into this.")
    result = await ctx.request("send_customer_reply", {"ticketId": "t-1"})
    if result.status == "approval_required":
        ...  # a human decides later with app.approve(result.approval_id, approver)


app = open_channel(
    store=event_store,  # required: any durable store (append_if_absent, all, close)
    policy=lambda action_type, actor, value, event: PolicyDecision(
        allowed=True, approval_required=True
    ),
    agents=[AgentDefinition(id="agent:support", name="Support", on_message=on_message)],
    actions=[reply],
    channels=[ChannelDefinition("slack", source=slack_source, sink=slack_sink)],
    approver=ActorRef("human:manager", type="ACTOR_TYPE_HUMAN"),
)

await app.start()
await app.receive("slack", provider_payload)  # or: await app.ingest(event)
await app.stop()
```

## Events

```python
from ocp_sdk import (
    event_type,
    from_binary,
    from_json,
    message_received,
    new_event,
    to_binary,
    to_json,
)

event = message_received(text="hi", actor=ActorRef("human:ada", type="ACTOR_TYPE_HUMAN"))
event_type(event)  # "message.received", derived from the payload
data = to_binary(event)  # protobuf wire bytes
from_binary(data)  # validated; no version argument
to_json(event)  # ProtoJSON with protocolVersion "2.0"
from_json(payload)  # rejects other versions and any eventType field
```

`new_event(payload={...})` builds any payload kind. The typed builders are
`message_received`, `message_sent`, `approval_requested`, `action_executed`, and `action_failed`.

## Application API

| Call                                          | Purpose                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| `open_channel(...)`                           | Build an application (`OpenChannel`)                     |
| `start()`, `stop(timeout_ms=...)`             | Lifecycle                                                |
| `receive(provider, value)`                    | Normalize provider input and ingest it                   |
| `ingest(event)`                               | Ingest a built event                                     |
| `approve(id, approver)`, `deny(id, approver)` | Decide an approval                                       |
| `on(event_name, handler)`                     | Observe accepted events; returns an unsubscribe function |
| `agent_cards()`                               | Discovery                                                |
| `add_agent`, `add_action`, `add_channel`      | Register after construction                              |
| `store`                                       | The event store, for audit queries                       |

Inside an agent, `ctx.message`, `ctx.event`, `ctx.agent`, `ctx.conversation`, `ctx.channel`,
`ctx.logger`, `ctx.reply(text)`, and `ctx.request(action_type, input, ...)` are available.
`ctx.request` takes keyword options: `approver`, `reason`, `deadline`, `target`, `action_id`,
`channel`, `conversation`, and `recipient`. The policy's approver takes precedence over `approver`.

`ctx.logger` has `debug`, `info`, `warn`, and `error`. By default `warn` and `error` go to stderr
and `debug` and `info` are silent. Pass `logger=` to `open_channel()` to replace it;
`NullLogger` discards everything.

Approvals are durable. Each approval request is an `approval.requested` event in the store.
`start()` restores unresolved approvals from the store, so an approval can be decided by a new
process. A restored approval whose deadline has passed emits `approval.expired` at start.
`approve` and `deny` record `approval.granted` and `approval.denied` with the given `reason`.
Restoring an approval needs its action registered in the new process.

## Development

```bash
ruff format --check sdks/python
ruff check sdks/python
PYTHONPATH=sdks/python/src python3 -m unittest discover -s sdks/python/tests -p 'test_*.py'
```

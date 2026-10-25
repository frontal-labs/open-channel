# ocp-protocol

Canonical OCP event model: the protobuf-generated types, typed event builders, validation, and JSON and binary serialization.

There is one envelope and one protocol version, `PROTOCOL_VERSION` (`"2.0"`). The payload `oneof` is the event kind, so `eventType(event)` derives the friendly name (for example `approval.granted`) instead of storing a second copy.

```ts
import {
  approvalRequested,
  eventType,
  fromBinary,
  toBinary,
} from "ocp-protocol";

const event = approvalRequested({
  /* agent, approver, requestedAction, deadline, ... */
});
eventType(event); // "approval.requested"
fromBinary(toBinary(event)); // round-trips, no version argument
```

## API

| Concern   | Exports                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------- |
| Build     | `newEvent`, `messageReceived`, `messageSent`, `approvalRequested`, `actionExecuted`, `actionFailed` |
| Inspect   | `eventType`, `validateEvent`, `EVENT_TYPES`, `PROTOCOL_VERSION`                                     |
| Serialize | `toJson`, `fromJson`, `toBinary`, `fromBinary`                                                      |

`fromJson` and `fromBinary` validate untrusted input and throw `ValidationError` from `ocp-core` when it is invalid.

## Development

```bash
pnpm generate
pnpm --filter ocp-protocol build
pnpm proto:lint
```

Edit `proto/ocp`, then regenerate. TypeScript, Python, and Rust outputs live under `proto/gen/{typescript,python,rust}` and are excluded from Ultracite formatting checks.

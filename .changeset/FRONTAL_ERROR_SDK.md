---
"@openchannelprotocol/sdk": minor
---

Export the OCP error classes, `toChannelText`, `toToolFailure`, `toFailureRecord`, `hasCode`, `isFrontalError` and `getRootCause` from the public entry. Failed actions are stored as a JSON record that keeps the developer message, and restored with that message, instead of serialising to `{}`. `@frontal-labs/error` is bundled into the package.

---
"@openchannelprotocol/core": minor
---

Build `OpenChannelError` on `@frontal-labs/error`. Every error keeps its constructor signatures, subclass names, `details`, IDs, `stage` and `retryable`, and gains a stable `scope` (`ocp`), its OCP `code`, an HTTP `statusCode`, the `cause` and `ocp.*` telemetry attributes. Adds `toChannelText` for text shown to people in a channel, `toToolFailure` for agent tool results, `toFailureRecord` for storage, and re-exports `hasCode`, `isFrontalError` and `getRootCause`.

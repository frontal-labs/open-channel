---
"ocp-sdk": minor
---

Fold every channel and capability extension into the `ocp-sdk` SDK as subpath imports: `ocp-sdk/slack`, `ocp-sdk/teams`, `ocp-sdk/google-chat`, `ocp-sdk/email`, `ocp-sdk/whatsapp`, `ocp-sdk/a2a`, `ocp-sdk/calendar`, `ocp-sdk/mcp`, `ocp-sdk/directory`, `ocp-sdk/otel`, `ocp-sdk/opa`, `ocp-sdk/cedar`, and `ocp-sdk/postgres`.

Exports drop the `create` prefix: `createSlackChannel` is now `slackChannel`, `createPostgresEventStore` is now `postgresStore`, and so on. The SDK also re-exports `RuleBasedPolicyEngine`, `createActor`, `ActorType`, `ActorRefSchema`, and `ChannelRefSchema` so applications import from `ocp-sdk` alone. `zod` is an optional peer, required only by `ocp-sdk/calendar` and `ocp-sdk/mcp`.
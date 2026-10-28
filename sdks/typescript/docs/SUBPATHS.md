# Provider and capability subpaths

Everything ships in one package. Install `@openchannelprotocol/sdk` and import each provider or capability from its subpath:

```bash
pnpm add @openchannelprotocol/sdk
```

```ts
import { openChannel, ActorType, createActor, RuleBasedPolicyEngine } from "@openchannelprotocol/sdk";
import { slackChannel, verifySlackWebhook } from "@openchannelprotocol/sdk/slack";
import { postgresStore } from "@openchannelprotocol/sdk/postgres";
```

Each subpath keeps provider-specific payloads at its boundary and exposes the SDK-native `ChannelSource`, `ChannelSink`, `ChannelDefinition`, `ActionDefinition`, or policy contracts. Normalized events use the single `EventEnvelope` from `@openchannelprotocol/sdk`.

Provider credentials and official client instances are injected through small transport ports. The SDK does not depend on provider SDKs, so you choose the HTTP client, auth, and retry behavior.

## Channels

| Subpath | Provider | Exports | Guide |
| --- | --- | --- | --- |
| `@openchannelprotocol/sdk/slack` | Slack Events API and Web API | `slackChannel`, `slackSource`, `slackSink`, `verifySlackWebhook`, `normalizeSlackEvent` | [slack.md](SLACK.md) |
| `@openchannelprotocol/sdk/teams` | Microsoft Teams | `teamsChannel`, `teamsSource`, `teamsSink`, `teamsTokenVerifier`, `verifyTeamsWebhook`, `normalizeTeamsEvent` | [teams.md](TEAMS.md) |
| `@openchannelprotocol/sdk/google-chat` | Google Chat | `googleChatChannel`, `googleChatSource`, `googleChatSink`, `googleChatTokenVerifier`, `verifyGoogleChatWebhook`, `normalizeGoogleChatEvent` | [google-chat.md](GOOGLE_CHAT.md) |
| `@openchannelprotocol/sdk/email` | SMTP/IMAP-compatible hosts | `emailChannel`, `emailSource`, `emailSink`, `normalizeEmailMessage` | [email.md](EMAIL.md) |
| `@openchannelprotocol/sdk/whatsapp` | WhatsApp Business Cloud | `whatsappChannel`, `whatsappSource`, `whatsappSink`, `verifyWhatsAppWebhook`, `verifyWhatsAppChallenge`, `normalizeWhatsAppEvent` | [whatsapp.md](WHATSAPP.md) |
| `@openchannelprotocol/sdk/a2a` | A2A-compatible transports | `a2aChannel`, `a2aSource`, `a2aSink`, `normalizeA2AEvent` | [a2a.md](A2A.md) |

## Actions

| Subpath | Purpose | Exports | Guide |
| --- | --- | --- | --- |
| `@openchannelprotocol/sdk/calendar` | Policy-controlled calendar actions | `calendarActions`, `calendarAction` | [calendar.md](CALENDAR.md) |
| `@openchannelprotocol/sdk/mcp` | Policy-controlled MCP tool calls | `mcpActions`, `mcpAction`, `closeMcpClient` | [mcp.md](MCP.md) |

`calendar` and `mcp` validate input with Zod. Zod is an optional peer dependency, so install it only if you use these subpaths:

```bash
pnpm add zod
```

## Stores, policy, directory, telemetry

| Subpath | Purpose | Exports | Guide |
| --- | --- | --- | --- |
| `@openchannelprotocol/sdk/postgres` | Durable `EventStore` (PostgreSQL) | `postgresStore`, `migratePostgresStore`, `PostgresEventStore`, `postgresEventStoreMigration` | [postgres.md](POSTGRES.md) |
| `@openchannelprotocol/sdk/openchannel` | OPA decision adapter for the policy contract | `openchannelPolicy`, `OpenchannelPolicyEngine` | [openchannel.md](OPENCHANNEL.md) |
| `@openchannelprotocol/sdk/cedar` | Cedar evaluator adapter for the policy contract | `cedarPolicy`, `CedarPolicyEngine` | [cedar.md](CEDAR.md) |
| `@openchannelprotocol/sdk/directory` | Cached directory lookups for Google and Microsoft hosts | `googleDirectory`, `microsoftDirectory`, `CachedDirectoryProvider` | [directory.md](DIRECTORY.md) |
| `@openchannelprotocol/sdk/otel` | Lifecycle hooks, spans, and counters | `otelHooks` | [otel.md](OTEL.md) |

## Renames from the earlier packages

The earlier per-package imports are replaced by the subpaths above. Exports drop the `create` prefix:

| Before | After |
| --- | --- |
| `createSlackChannel` | `slackChannel` |
| `createTeamsChannel`, `createTeamsTokenVerifier` | `teamsChannel`, `teamsTokenVerifier` |
| `createGoogleChatChannel`, `createGoogleChatTokenVerifier` | `googleChatChannel`, `googleChatTokenVerifier` |
| `createEmailChannel`, `createWhatsAppChannel`, `createA2AChannel` | `emailChannel`, `whatsappChannel`, `a2aChannel` |
| `createCalendarActions`, `createMcpActions` | `calendarActions`, `mcpActions` |
| `createGoogleDirectoryProvider`, `createMicrosoftDirectoryProvider` | `googleDirectory`, `microsoftDirectory` |
| `createOpenTelemetryHooks` | `otelHooks` |
| `createOpenchannelPolicyEngine`, `createCedarPolicyEngine` | `openchannelPolicy`, `cedarPolicy` |
| `createPostgresEventStore`, `migratePostgresEventStore` | `postgresStore`, `migratePostgresStore` |

Each `*Source` and `*Sink` follows the same pattern: `slackSource`, `slackSink`, and so on. Type names such as `SlackTransport` and `SlackChannelOptions` are unchanged.

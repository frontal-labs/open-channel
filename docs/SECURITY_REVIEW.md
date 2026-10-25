# Security review

This is a code-level review of the inbound, approval, and storage paths, performed by reading
the source and running the test suites. It is not a penetration test and does not cover a
deployed environment, live provider accounts, or secrets management on a target platform.

## Scope

- Approval decisions: `packages/runtime` (`decideApproval`).
- Inbound webhooks: Slack, WhatsApp, Microsoft Teams, Google Chat (`extensions/*/src/verification.ts`),
  and the Slack quickstart server (`examples/slack-typescript/main.ts`).
- Bearer-token verification: `extensions/microsoft-teams/src/jwt.ts` and `extensions/microsoft-teams/src/auth.ts`,
  `extensions/google-chat/src/jwt.ts` and `extensions/google-chat/src/auth.ts`.
- Webhook signature checks: `extensions/slack/src/verification.ts`, `extensions/whatsapp/src/verification.ts`.
- Durable storage: `extensions/postgres/src/store.ts`.
- Dependencies: `pnpm audit` (production and development).

## Fixed in this review

| Area                   | Finding                                                                                               | Fix                                                                                                                                                                                      | Verified by                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Approvals              | `decideApproval` accepted a decision from any actor, so any caller could approve any pending request. | Rejects decisions from anyone other than the named approver with `AuthorizationError` (`OCP_AUTHORIZATION`).                                                                             | `packages/runtime/tests/approval-authority.test.ts`                                          |
| Slack example server   | The request body was read without a size limit, before the signature was checked.                     | Bodies over 1 MiB get 413 with `connection: close`.                                                                                                                                      | `examples/slack-typescript --selftest` (checks the status the client receives)               |
| Slack example server   | A correctly signed body that is not valid JSON threw inside an async handler.                         | Returns 400.                                                                                                                                                                             | `examples/slack-typescript --selftest`                                                       |
| WhatsApp               | The webhook verify token was compared with `!==`, which is not constant-time.                         | Compared with `timingSafeEqual`; length mismatches are rejected.                                                                                                                         | `extensions/whatsapp/tests/verification.test.ts`                                             |
| Teams and Google Chat  | No reference token verifier existed; the host had to write one.                                       | `teamsTokenVerifier` and `googleChatTokenVerifier` check the RS256 signature, issuer, audience, and expiry, and reject `alg: none`, tampered payloads, and unpublished keys. | `extensions/microsoft-teams/tests/auth.test.ts`, `extensions/google-chat/tests/auth.test.ts` |
| Postgres store         | With a custom `tableName`, the migration still created `ocp_events`, so the first write failed.       | The migration takes the same table name, and index names derive from it. The name is validated before it is interpolated.                                                                | `extensions/postgres/tests/migration.test.ts`                                                |
| Routing (availability) | Teams, Google Chat, WhatsApp, email, and A2A dropped inbound messages because no `recipient` was set. | Each source takes a `recipient` option.                                                                                                                                                  | `extensions/*/tests/routing.test.ts`                                                         |
| Dependencies           | `vitest` 2.x had a critical advisory (UI server file read and execution).                             | Upgraded to `vitest` 4.1.12 across the workspace. The full test suite passes.                                                                                                            | `pnpm audit`, `pnpm test`                                                                    |

## Verified as sound

- Slack request signatures: HMAC-SHA256 over `v0:<timestamp>:<body>`, compared in constant time,
  with a five-minute replay window.
- WhatsApp payload signatures: HMAC-SHA256 with the `sha256=` prefix, compared in constant time.
- Bearer-token verification: RS256 only; the algorithm, key ID, signature, issuer, audience,
  and expiry are all checked before a request is accepted.
- Postgres writes: values are bound as parameters. Event and action writes are atomic
  (`INSERT ... ON CONFLICT`), so two concurrent deliveries of the same event or action claim
  cannot both succeed.
- Duplicate deliveries: events are deduplicated by `event_id`, so provider retries do not
  produce a second reply or a second action.
- Action execution: a registered action runs only after policy and any approval, and each
  action ID runs at most once.

## Open

- **Live verification of the JWT verifiers.** The verifiers are tested with locally generated
  keys and mocked key endpoints. They have not been run against Microsoft's or Google's live
  key endpoints, which needs a bot or Chat app in a sandbox.
- **Live Postgres with restricted credentials.** The store passed all 12 tests against a
  disposable PostgreSQL 18.6 container. It has not been run with a least-privilege role or
  against a managed database.
- **Lease takeover is at-least-once.** A claim now expires after `leaseMs` (five minutes by
  default), and an expired claim can be taken over by another worker. This fixes actions stuck
  after a crash. A slow worker that finishes after a takeover can still run the action a second
  time, and `completeAction` does not check the owner. Executors must treat the action ID as an
  idempotency key. The offline tests cover the SQL, and the live tests (including the one-winner race) pass.
- **No rate limiting on webhook endpoints.** The Slack example has a size limit but no per-client
  limit. Put the endpoint behind a gateway that rate-limits.
- **Example stores and channels are in memory.** The in-memory store in each example
  (for instance `examples/native-typescript`) loses state on restart. Production uses `ocp-sdk/postgres`.
- **Empty policy in examples.** The examples can only reply. Any action needs explicit rules.
- **Dependency advisories that remain** (`pnpm audit`, after the vitest upgrade):
  - `braces` (high) and `sprintf-js` (moderate): transitive through `@changesets/cli`, a release
    tool that does not ship. No patched release exists for either version.
  - `cli` (low, "Arbitrary File Write"): no npm package named `cli` appears in the lockfile.
    The match is most likely a name collision with `@changesets/cli` or `@commitlint/cli`, so
    it is probably a false positive. Confirm against the advisory before dismissing it.
- **Not reviewed:** OAuth and token storage, secret rotation, TLS termination, and the email and
  A2A transports.

## Before production

1. Verify the Teams and Google Chat verifiers against live endpoints in a sandbox.
2. Run the Postgres store against a managed database with least-privilege credentials.
3. Add rate limiting and request logging at the edge.
4. Repeat this review against the deployed environment, with live provider accounts in a sandbox.

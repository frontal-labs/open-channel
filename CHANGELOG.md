# Changelog

All notable OCP changes are recorded here by Changesets. Pending release notes live in [`.changeset/`](./.changeset/); run `pnpm changeset:version` to apply them to package changelogs.

## 2.2.1

Patch release of the `@openchannelprotocol/sdk` SDK (TypeScript, Python, and Rust bindings). Makes the published TypeScript SDK self-contained: the bundled type declarations no longer import the internal `@openchannelprotocol/*` workspace packages or the `@frontal-labs` npm scope, so consumers need no `@openchannelprotocol` scope configuration in `.npmrc` and get real types instead of `any`. This resolves [issue #30](https://github.com/frontal-labs/open-channel/issues/30) via [PR #35](https://github.com/frontal-labs/open-channel/pull/35).

- `@openchannelprotocol/sdk/openchannel` now ships its type declarations, which were missing from 2.2.0.
- Build output from older releases (such as the removed `opa` adapter) is no longer packed.
- `zod` is no longer an optional peer dependency, because it is bundled and nothing requires it at install time.
- The public API is unchanged: the same names are exported from the same subpaths.

## 2.2.0

Renamed the TypeScript SDK package to `@openchannelprotocol/sdk` and folded every channel and capability extension into it as subpath imports (`slack`, `teams`, `google-chat`, `email`, `whatsapp`, `a2a`, `calendar`, `mcp`, `directory`, `otel`, `openchannel`, `cedar`, `postgres`). Renamed the OPA policy adapter subpath from `opa` to `openchannel` (policy IDs change from `opa:*` to `openchannel:*`). Exports drop the `create` prefix (`createSlackChannel` → `slackChannel`, `createPostgresEventStore` → `postgresStore`). The Python distribution imports as `ocp_sdk` and the Rust crate is `openchannelprotocol-sdk` (imported via `ocp_sdk`).

## 2.0.0

OCP 2.0 stable release: one envelope (`EventEnvelope`), one protocol version (`2.0`), and `event_type` reserved on the wire. Typed event builders, ProtoJSON serialization, policy-controlled actions, the approval/escalation lifecycle, source/sink channel contracts, and the `ocp` CLI. TypeScript, Python, and Rust SDKs ship under the `@openchannelprotocol/sdk` name (Python import `ocp_sdk`, Rust crate `openchannelprotocol-sdk`).

## 1.0.0

First stable release of the OpenChannel Protocol (OCP), its TypeScript, Python, and Rust SDKs, the `ocp` CLI, and the first-party extensions. The protocol wire version is `0.1` (the canonical envelope); protocol `0.2` is a second supported envelope. Per-package notes, including migration steps from the pre-rename ACP names, are in each package's `CHANGELOG.md`.

- Repository tooling, documentation, and SDK surfaces are unified under the OpenChannel Protocol name. Markdown filenames use uppercase `SNAKE_CASE.md`, and CI validates Markdown links and filenames.
- Documentation covers the `open-channel` distributions and language import identifiers (`@openchannelprotocol/open-channel`, `open_channel`, `open_channel`).
- Security and deployment reviews are recorded in `docs/SECURITY_REVIEW.md` and `docs/DEPLOYMENT_REVIEW.md`, with a production checklist.

## Release conventions

User-visible package and protocol changes should have a Markdown file in
[`.changeset/`](./.changeset/). Versioning uses the GitHub-aware Changesets
adapter configured for [frontal-labs/open-channel](https://github.com/frontal-labs/open-channel).

The repository also keeps this top-level history for project-wide governance,
SDK, example, and tooling changes that are not published as an npm package.

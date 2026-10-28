# Changelog

All notable OCP changes are recorded here by Changesets. Pending release notes live in [`.changeset/`](./.changeset/); run `pnpm changeset:version` to apply them to package changelogs.

## 1.0.0

First stable release of the OpenChannel Protocol (OCP), its TypeScript, Python, and Rust SDKs, the `ocp` CLI, and the first-party extensions. The protocol wire version is `0.1` (the canonical envelope); protocol `0.2` is a second supported envelope. Per-package notes, including migration steps from the pre-rename ACP names, are in each package's `CHANGELOG.md`.

- Repository tooling, documentation, and SDK surfaces are unified under the OpenChannel Protocol name. Markdown filenames use uppercase `SNAKE_CASE.md`, and CI validates Markdown links and filenames.
- Documentation covers the `open-channel` distributions and language import identifiers (`@openchannelprotocol/open-channel`, `open_channel`, `open_channel`).
- Security and deployment reviews are recorded in `docs/SECURITY_REVIEW.md` and `docs/DEPLOYMENT_REVIEW.md`, with a production checklist.

## Release conventions

User-visible package and protocol changes should have a Markdown file in
[`.changeset/`](./.changeset/). Versioning uses the GitHub-aware Changesets
adapter configured for [`openchannelprotocol/open-channel`](https://github.com/openchannelprotocol).

The repository also keeps this top-level history for project-wide governance,
SDK, example, and tooling changes that are not published as an npm package.

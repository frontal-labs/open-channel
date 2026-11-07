# Changesets

Add one Markdown file to this directory for every user-visible package change:

```md
---
"@openchannelprotocol/sdk": patch
---

Describe the change and any migration notes.
```

Run `pnpm changeset` to create a changeset interactively, `pnpm changeset:status` to inspect pending releases, and `pnpm release:version` to apply versions and changelogs. Public SDK distributions are `@openchannelprotocol/sdk` on npm, `ocp-sdk` on PyPI (imported as `ocp_sdk`), and `openchannelprotocol-sdk` on crates.io (imported as `ocp_sdk`). Release image/container identifiers retain ecosystem suffixes such as `open-channel-ts`, `open-channel-py`, and `open-channel-rs`.

Generated changelog entries use the GitHub-aware Changesets adapter and link back to `frontal-labs/open-channel`.

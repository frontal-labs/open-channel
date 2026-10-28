# Changesets

Add one Markdown file to this directory for every user-visible package change:

```md
---
"openchannel": minor
---

Describe the change and any migration notes.
```

Run `pnpm changeset` to create a changeset interactively, `pnpm changeset:status` to inspect pending releases, and `pnpm release:version` to apply versions and changelogs. Public SDK distributions use the package name `openchannel` on npm, PyPI, and crates.io; their import identifier is `openchannel` in all three. Release image/container identifiers retain ecosystem suffixes such as `open-channel-ts`, `open-channel-py`, and `open-channel-rs`.

Generated changelog entries use the GitHub-aware Changesets adapter and link back to `openchannelprotocol/open-channel`.

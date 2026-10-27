---
"ocp-sdk": patch
---

Make `ocp-sdk` self-contained. The published type declarations no longer import the internal `ocp-*` workspace packages or the `@frontal-labs` npm scope, and those packages are no longer published. Consumers no longer need any `@frontal-labs` scope configuration in `.npmrc`, and they get real types instead of `any`. The public API is unchanged: the same names are exported from the same subpaths.

Also fixes the published package:

- `ocp-sdk/openchannel` now ships its type declarations, which were missing from 2.2.0.
- Build output from older releases (such as the removed `opa` adapter) is no longer packed.
- `zod` is no longer an optional peer dependency, because it is bundled and nothing requires it at install time.

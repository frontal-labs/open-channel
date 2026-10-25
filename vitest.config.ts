import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Order matters: subpath imports (`ocp-sdk/slack`) must resolve before the bare `ocp-sdk`.
    alias: [
      { find: /^ocp-sdk\/(.+)$/, replacement: `${root}sdks/typescript/src/$1/index.ts` },
      { find: /^ocp-sdk$/, replacement: `${root}sdks/typescript/src/index.ts` },
      { find: "@openchannel/adapter", replacement: `${root}packages/adapter/src/index.ts` },
      { find: "@openchannel/cli", replacement: `${root}cli/src/index.ts` },
      { find: "@openchannel/core", replacement: `${root}packages/core/src/index.ts` },
      { find: "@openchannel/policy", replacement: `${root}packages/policy/src/index.ts` },
      { find: "@openchannel/protocol", replacement: `${root}packages/protocol/src/index.ts` },
      { find: "@openchannel/runtime", replacement: `${root}packages/runtime/src/index.ts` },
      { find: "@openchannel/testing", replacement: `${root}packages/testing/src/index.ts` },
    ],
  },
  test: {
    globals: true,
    include: [
      "tests/**/*.test.ts",
      "packages/**/tests/**/*.test.ts",
      "cli/tests/**/*.test.ts",
      "sdks/typescript/tests/**/*.test.ts",
    ],
  },
});

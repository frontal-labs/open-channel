import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    // Order matters: subpath imports (`@openchannelprotocol/sdk/slack`) must resolve before the bare `@openchannelprotocol/sdk`.
    alias: [
      { find: /^@openchannelprotocol\/sdk\/(.+)$/, replacement: `${root}sdks/typescript/src/$1/index.ts` },
      { find: /^@openchannelprotocol\/sdk$/, replacement: `${root}sdks/typescript/src/index.ts` },
      { find: "@openchannelprotocol/adapter", replacement: `${root}packages/adapter/src/index.ts` },
      { find: "@openchannelprotocol/cli", replacement: `${root}cli/src/index.ts` },
      { find: "@openchannelprotocol/core", replacement: `${root}packages/core/src/index.ts` },
      { find: "@openchannelprotocol/policy", replacement: `${root}packages/policy/src/index.ts` },
      { find: "@openchannelprotocol/protocol", replacement: `${root}packages/protocol/src/index.ts` },
      { find: "@openchannelprotocol/runtime", replacement: `${root}packages/runtime/src/index.ts` },
      { find: "@openchannelprotocol/testing", replacement: `${root}packages/testing/src/index.ts` },
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

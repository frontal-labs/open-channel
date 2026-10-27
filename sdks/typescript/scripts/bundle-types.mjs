import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import { findEntryPoints } from "./entry-points.mjs";

// Declarations for every public entry point. The internal workspace packages (ocp-core,
// ocp-protocol, ...) are resolved through tsconfig paths and inlined, so the published .d.ts
// files only reference relative paths inside dist/ plus the runtime dependencies that remain.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const outDir = join(root, "dist");

const tsExtension = /\.ts$/;
const input = Object.fromEntries(
  findEntryPoints(srcDir).map((entry) => [entry.replace(tsExtension, ""), join(srcDir, entry)]),
);

const bundle = await rollup({
  external: [/^@bufbuild\//, /^node:/, "zod"],
  input,
  plugins: [dts({ tsconfig: join(root, "tsconfig.json") })],
});

await bundle.write({
  chunkFileNames: "_chunks/[name]-[hash].d.ts",
  dir: outDir,
  entryFileNames: "[name].d.ts",
  format: "es",
});
await bundle.close();

console.log(`Bundled declarations for ${Object.keys(input).length} entry points.`);

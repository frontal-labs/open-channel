import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { findEntryPoints } from "./entry-points.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const outDir = join(root, "dist");

// Start from an empty dist so files from older builds (renamed or removed modules) never ship.
rmSync(outDir, { force: true, recursive: true });

const entryPoints = findEntryPoints(srcDir);

const baseConfig = {
  bundle: true,
  format: "esm",
  logLevel: "warning",
  platform: "node",
  target: "node22",
  tsconfig: join(root, "..", "..", "tsconfig.base.json"),
};

for (const entry of entryPoints) {
  const outPath = entry.replace(/\.ts$/, ".js");
  const out = join(outDir, outPath);
  const outDirForFile = dirname(out);
  if (!existsSync(outDirForFile)) {
    mkdirSync(outDirForFile, { recursive: true });
  }
  console.log(`bundling ${entry} -> ${outPath}`);
  // biome-ignore lint/performance/noAwaitInLoops: esbuild builds must run sequentially
  await build({
    ...baseConfig,
    entryPoints: [join(srcDir, entry)],
    outfile: out,
  });
}

console.log(`\nBundled ${entryPoints.length} entry points.`);

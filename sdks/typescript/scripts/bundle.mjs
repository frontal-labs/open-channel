import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const outDir = join(root, "dist");

function findEntryPoints(dir, prefix = "") {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries.push(...findEntryPoints(full, rel));
    } else if (name === "index.ts") {
      entries.push(rel);
    }
  }
  return entries;
}

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

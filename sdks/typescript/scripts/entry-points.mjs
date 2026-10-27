import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Returns every `index.ts` under `dir`, relative to `dir` (e.g. "index.ts", "slack/index.ts").
export function findEntryPoints(dir, prefix = "") {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) {
      entries.push(...findEntryPoints(full, rel));
    } else if (name === "index.ts") {
      entries.push(rel);
    }
  }
  return entries;
}

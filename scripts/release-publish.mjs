import { execFileSync } from "node:child_process";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });

// Generated protobuf bindings are not tracked, so they must exist before any package builds.
// Verify registry ownership before anything is uploaded, since changeset publish runs first.
run("node", ["scripts/check-package-owners.mjs"]);
run("pnpm", ["generate"]);
// Packages publish their dist/ output, so build every workspace package before uploading.
run("pnpm", ["build"]);
run("pnpm", ["exec", "changeset", "publish"]);
run("pnpm", ["release:publish:sdk"]);

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Publishes every public TypeScript workspace package to GitHub Packages (the npm registry for
// the @openchannel scope). GitHub Packages does not host crates or PyPI distributions, so Rust and
// Python stay on crates.io and PyPI. A version that already exists on GitHub Packages is skipped,
// which makes re-runs safe.

const REGISTRY = "https://npm.pkg.github.com";
const SCOPE = "@openchannel";
const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const token = process.env.GITHUB_TOKEN ?? process.env.NODE_AUTH_TOKEN;

if (!(dryRun || token)) {
  throw new Error("GITHUB_TOKEN is required to publish to GitHub Packages.");
}

// Write the credentials to a temporary npm config so they never reach the repository or logs.
const configDir = mkdtempSync(join(tmpdir(), "ocp-gpr-"));
const userconfig = join(configDir, ".npmrc");
writeFileSync(
  userconfig,
  `${SCOPE}:registry=${REGISTRY}\n//npm.pkg.github.com/:_authToken=${token ?? ""}\n`,
);

const capture = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_USERCONFIG: userconfig },
  });
const run = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, NPM_CONFIG_USERCONFIG: userconfig },
    stdio: "inherit",
  });

const packages = JSON.parse(capture("pnpm", ["m", "ls", "--depth", "-1", "--json"])).filter(
  (project) => !project.private && project.name?.startsWith(`${SCOPE}/`),
);

const alreadyPublished = (name, version) => {
  try {
    return (
      capture("npm", ["view", `${name}@${version}`, "version", "--registry", REGISTRY]).trim() ===
      version
    );
  } catch {
    return false;
  }
};

try {
  for (const project of packages) {
    if (alreadyPublished(project.name, project.version)) {
      console.log(`skip ${project.name}@${project.version}: already on GitHub Packages`);
      continue;
    }
    const args = ["publish", "--registry", REGISTRY, "--access", "public", "--no-git-checks"];
    if (dryRun) {
      args.push("--dry-run");
    }
    console.log(`${dryRun ? "dry run" : "publish"} ${project.name}@${project.version}`);
    run("pnpm", args, project.path);
  }
} finally {
  rmSync(configDir, { force: true, recursive: true });
}

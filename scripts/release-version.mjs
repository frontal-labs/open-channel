import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tomlVersionPattern = /(^\s*version\s*=\s*")[^"]+("\s*$)/m;
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

run("pnpm", ["exec", "changeset", "version"]);

const readPackageVersion = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8")).version;

const compareVersions = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) {
      return (a[index] ?? 0) - (b[index] ?? 0);
    }
  }
  return 0;
};

const releaseVersion = [
  readPackageVersion("cli/package.json"),
  readPackageVersion("sdks/typescript/package.json"),
]
  .sort(compareVersions)
  .at(-1);

const updatePackageVersion = (file) => {
  const path = resolve(root, file);
  const packageJson = JSON.parse(readFileSync(path, "utf8"));
  if (packageJson.version !== releaseVersion) {
    packageJson.version = releaseVersion;
    writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
};

const updateTomlVersion = (file) => {
  const path = resolve(root, file);
  const content = readFileSync(path, "utf8");
  const updated = content.replace(tomlVersionPattern, `$1${releaseVersion}$2`);
  if (updated !== content) {
    writeFileSync(path, updated);
  }
};

updatePackageVersion("cli/package.json");
updatePackageVersion("sdks/typescript/package.json");
updateTomlVersion("sdks/python/pyproject.toml");
updateTomlVersion("sdks/rust/Cargo.toml");

const updateLockVersion = (file, packageName) => {
  const path = resolve(root, file);
  if (!existsSync(path)) {
    return;
  }
  const content = readFileSync(path, "utf8");
  const marker = `name = "${packageName}"\nversion = "`;
  const valueStart = content.indexOf(marker);
  if (valueStart === -1) {
    return;
  }
  const versionStart = valueStart + marker.length;
  const versionEnd = content.indexOf('"', versionStart);
  const updated = `${content.slice(0, versionStart)}${releaseVersion}${content.slice(versionEnd)}`;
  if (updated !== content) {
    writeFileSync(path, updated);
  }
};

updateLockVersion("sdks/rust/Cargo.lock", "ocp-sdk");
updateLockVersion("examples/native-rust/Cargo.lock", "ocp-sdk");

console.log(`Synchronized SDK versions to ${releaseVersion}.`);

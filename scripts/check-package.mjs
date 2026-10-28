import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

// Packs a publishable package, unpacks the tarball, and fails if the published files or manifest
// reference the internal workspace packages or the @openchannelprotocol scope. Consumers must be able to
// install the package without any registry scope configuration.
//
// Usage: node scripts/check-package.mjs [packageDir] [--pack-destination <dir>]
// The tarball is left in the pack destination (default: <tmpdir>/ocp-pack) for smoke-consumer.mjs.

const forbiddenText = [
  "@openchannelprotocol/",
  "@openchannel/",
  "@openchannelprotocol/core",
  "@openchannelprotocol/policy",
  "@openchannelprotocol/adapter",
  "@openchannelprotocol/runtime",
  "@openchannelprotocol/testing",
  "@openchannelprotocol/protocol",
];
const forbiddenDependency =
  /^(@openchannelprotocol\/|@openchannel\/|ocp-(core|policy|adapter|runtime|testing|protocol)$)/;
const dependencyFields = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
];

const args = process.argv.slice(2);
const destIndex = args.indexOf("--pack-destination");
const defaultPackDestination = join(tmpdir(), "ocp-pack");
const packDestination = destIndex === -1 ? defaultPackDestination : resolve(args[destIndex + 1]);
mkdirSync(packDestination, { recursive: true });
const positional = args.filter((_arg, index) => index !== destIndex && index !== destIndex + 1);
const packageDir = resolve(positional[0] ?? "sdks/typescript");

const packed = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: packageDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const tarball = join(packDestination, packed[0].filename);

const unpacked = mkdtempSync(join(tmpdir(), "ocp-unpacked-"));
execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
const root = join(unpacked, "package");

const failures = [];

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

for (const file of listFiles(root)) {
  const contents = readFileSync(file);
  for (const needle of forbiddenText) {
    if (contents.includes(needle)) {
      failures.push(`${relative(root, file)} contains "${needle}"`);
    }
  }
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const field of dependencyFields) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (forbiddenDependency.test(name)) {
      failures.push(`package.json ${field} lists "${name}"`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Packed ${manifest.name}@${manifest.version} references internal packages:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `${manifest.name}@${manifest.version} is self-contained: no internal or scoped references.`,
);
console.log(`tarball: ${tarball}`);

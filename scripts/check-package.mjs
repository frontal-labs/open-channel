import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

// Packs a publishable package, unpacks the tarball, and fails if the published files or manifest
// import the internal workspace packages or the old `@openchannel`/`@frontal-labs` scopes.
// Consumers must be able to install the package without any registry scope configuration.
//
// Usage: node scripts/check-package.mjs [packageDir] [--pack-destination <dir>]
// The tarball is left in the pack destination (default: <tmpdir>/ocp-pack) for smoke-consumer.mjs.

// The published package itself is `@openchannelprotocol/sdk`, so references to
// `@openchannelprotocol/sdk` (its own name) and `@openchannelprotocol/sdk/*` (its own
// subpaths) are self-references and are allowed. What must be absent are imports of the
// internal workspace packages (`@openchannelprotocol/{core,protocol,adapter,policy,runtime,testing,cli}`)
// and anything under the old `@openchannel/` or `@frontal-labs/` scopes, since consumers
// must be able to install the package without any registry scope configuration.
const forbiddenText = [
  "@openchannelprotocol/core",
  "@openchannelprotocol/protocol",
  "@openchannelprotocol/adapter",
  "@openchannelprotocol/policy",
  "@openchannelprotocol/runtime",
  "@openchannelprotocol/testing",
  "@openchannelprotocol/cli",
  "@openchannel/",
];
// The public library `@frontal-labs/error` is a declared dependency and its path appears in bundle
// comments, so it is allowed. Any other `@frontal-labs/` package is still forbidden.
const forbiddenFrontalScope = /@frontal-labs\/(?!error(?:[/"'\s]|$))/;
const forbiddenDependency =
  /^(@openchannelprotocol\/(core|protocol|adapter|policy|runtime|testing|cli)$|@openchannel\/|@frontal-labs\/(?!error$)|ocp-(core|policy|adapter|runtime|testing|protocol)$)/;
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

// `@frontal-labs/error` is bundled into the SDK, and its runtime tags errors with this symbol key.
// The key is a string value, not an import, so it is the one `@frontal-labs/` reference allowed.
const allowedBundledText = 'Symbol.for("@frontal-labs/error")';

for (const file of listFiles(root)) {
  const contents = readFileSync(file, "utf8").split(allowedBundledText).join("");
  for (const needle of forbiddenText) {
    if (contents.includes(needle)) {
      failures.push(`${relative(root, file)} contains "${needle}"`);
    }
  }
  if (forbiddenFrontalScope.test(contents)) {
    failures.push(`${relative(root, file)} contains a non-allowed "@frontal-labs/" package`);
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

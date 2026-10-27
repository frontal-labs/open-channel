import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Installs a packed SDK tarball into a clean project and checks that every public subpath
// type-checks under strict mode with skipLibCheck disabled, and that every subpath loads at runtime.
// The project has no .npmrc and npm ignores the user config, so no registry scope mapping applies.
//
// Usage: node scripts/smoke-consumer.mjs [path-to-tarball] [typescriptVersion]
// Without a tarball path, uses the newest ocp-sdk-*.tgz that check-package.mjs left in <tmpdir>/ocp-pack.

const packDir = join(tmpdir(), "ocp-pack");
const tarballName = /^ocp-sdk-.*\.tgz$/;
const [tarballArg, typescriptVersion = "5.9.3", nodeTypesVersion = "22"] = process.argv.slice(2);
// Self-contained examples that compile against the published SDK. Examples that need third-party
// agent frameworks are not installed here, so they are not part of this check.
const examples = ["native-typescript", "slack-typescript"];
const root = resolve(import.meta.dirname, "..");
const tarball = resolve(tarballArg ?? newestTarball(packDir));

function newestTarball(dir) {
  const candidates = readdirSync(dir)
    .filter((name) => tarballName.test(name))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) {
    console.error(`No ocp-sdk tarball in ${dir}. Run scripts/check-package.mjs first.`);
    process.exit(1);
  }
  return candidates[0];
}
const project = mkdtempSync(join(tmpdir(), "ocp-consumer-"));
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: project, stdio: "inherit", ...options });

// An empty user config keeps the consumer on the default registry and free of scope mappings.
writeFileSync(join(project, "empty.npmrc"), "");
writeFileSync(
  join(project, "package.json"),
  JSON.stringify({ name: "ocp-consumer-smoke", private: true, type: "module" }, null, 2),
);

run("npm", [
  "install",
  "--no-audit",
  "--no-fund",
  "--userconfig",
  join(project, "empty.npmrc"),
  tarball,
  `typescript@${typescriptVersion}`,
  `@types/node@${nodeTypesVersion}`,
]);

const sdkDir = join(project, "node_modules", "ocp-sdk");
const sdkManifest = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8"));
const specifiers = Object.keys(sdkManifest.exports).map((key) =>
  key === "." ? "ocp-sdk" : `ocp-sdk/${key.slice(2)}`,
);

// Import every public subpath so a missing or unresolvable declaration fails the type check.
mkdirSync(join(project, "src"));
const namespaceImports = specifiers
  .map((specifier, index) => `import * as subpath${index} from "${specifier}";`)
  .join("\n");
const namespaceList = specifiers.map((_, index) => `subpath${index}`).join(", ");

writeFileSync(
  join(project, "src", "subpaths.ts"),
  `${namespaceImports}\n\nexport const subpaths = [${namespaceList}];\n`,
);

// A few typed APIs that consumers actually call, so the check covers real signatures too.
writeFileSync(
  join(project, "src", "usage.ts"),
  `import { openChannel, type OpenChannel, type OpenChannelOptions } from "ocp-sdk";
import { slackChannel } from "ocp-sdk/slack";

export type Runtime = OpenChannel;
export type Options = OpenChannelOptions;
export const channel = slackChannel;
export const start = openChannel;
`,
);

writeFileSync(
  join(project, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: "ES2022",
        types: ["node"],
      },
      include: ["src/**/*.ts", "examples/*/src/**/*.ts"],
    },
    null,
    2,
  ),
);

for (const name of examples) {
  const dest = join(project, "examples", name, "src");
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(join(root, "examples", name, "src"))) {
    copyFileSync(join(root, "examples", name, "src", file), join(dest, file));
  }
}

console.log(
  `Type-checking ${specifiers.length} public specifiers and ${examples.length} examples in ${project}`,
);
run(join(project, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"]);

const importer = specifiers
  .map((specifier) => `await import(${JSON.stringify(specifier)});`)
  .join("\n");
writeFileSync(
  join(project, "runtime.mjs"),
  `${importer}\nconsole.log("loaded ${specifiers.length} subpaths");\n`,
);
run(process.execPath, ["runtime.mjs"]);

console.log(`Consumer smoke test passed for ${sdkManifest.name}@${sdkManifest.version}.`);

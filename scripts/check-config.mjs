import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.json",
  "proto/buf.yaml",
  "proto/buf.gen.yaml",
  ".changeset/config.json",
  ".frontal-code/settings.json",
  ".cursor/mcp.json",
  ".cursor/rules/ocp-repository.mdc",
  ".claude/settings.json",
  ".husky/pre-commit",
  ".husky/commit-msg",
  "AGENTS.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "renovate.json",
  "ruff.toml",
  "rust-toolchain.toml",
  "rustfmt.toml",
  "docs/README.md",
  "docs/DEVELOPMENT.md",
  "docs/SPEC.md",
  "examples/README.md",
  "skills/ocp-examples/SKILL.md",
  "skills/ocp-governance/SKILL.md",
];
const packageJsonFiles = [
  "package.json",
  "cli/package.json",
  "packages/adapter/package.json",
  "packages/core/package.json",
  "packages/demo/package.json",
  "packages/policy/package.json",
  "packages/protocol/package.json",
  "packages/runtime/package.json",
  "packages/testing/package.json",
  "sdks/typescript/package.json",
];
const jsonFiles = [
  ...packageJsonFiles,
  "turbo.json",
  "tsconfig.json",
  "tsconfig.base.json",
  "skills.sh.json",
  ".changeset/config.json",
  ".frontal-code/settings.json",
  ".cursor/mcp.json",
  ".claude/settings.json",
  "renovate.json",
  "skills.sh.json",
];
const metadataTextChecks = {
  "proto/buf.yaml": ["name: buf.build/frontal-labs/open-channel"],
  "sdks/python/pyproject.toml": [
    'name = "ocp-sdk"',
    'readme = "README.md"',
    "[project.urls]",
    'Repository = "https://github.com/frontal-labs/open-channel"',
  ],
  "sdks/rust/Cargo.toml": [
    'name = "ocp-sdk"',
    'readme = "README.md"',
    'repository = "https://github.com/frontal-labs/open-channel"',
    'documentation = "https://docs.rs/ocp-sdk"',
  ],
};

const missing = [];
for (const file of requiredFiles) {
  try {
    // biome-ignore lint/performance/noAwaitInLoops: These checks produce clearer per-file diagnostics when read in order.
    await access(join(root, file), constants.F_OK);
  } catch {
    missing.push(file);
  }
}

const invalidJson = [];
const packageMetadataFailures = [];
const packageMetadata = [];
for (const file of jsonFiles) {
  try {
    // biome-ignore lint/performance/noAwaitInLoops: These checks produce clearer per-file diagnostics when read in order.
    const parsed = JSON.parse(await readFile(join(root, file), "utf8"));
    if (packageJsonFiles.includes(file)) {
      packageMetadata.push([file, parsed]);
    }
  } catch (error) {
    invalidJson.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const [file, metadata] of packageMetadata) {
  for (const field of [
    "description",
    "license",
    "repository",
    "homepage",
    "bugs",
    "keywords",
    "author",
  ]) {
    if (!metadata[field]) {
      packageMetadataFailures.push(`${file}: missing ${field}`);
    }
  }
  if (!Array.isArray(metadata.keywords) || metadata.keywords.length === 0) {
    packageMetadataFailures.push(`${file}: keywords must be a non-empty array`);
  }
  if (
    typeof metadata.repository !== "object" ||
    !metadata.repository.url?.includes("github.com/frontal-labs/open-channel")
  ) {
    packageMetadataFailures.push(
      `${file}: repository must point to github.com/frontal-labs/open-channel`,
    );
  }
  if (typeof metadata.bugs !== "object" || !metadata.bugs.url?.endsWith("/issues")) {
    packageMetadataFailures.push(`${file}: bugs.url must point to the repository issues page`);
  }
}

for (const [file, expectedValues] of Object.entries(metadataTextChecks)) {
  try {
    // biome-ignore lint/performance/noAwaitInLoops: These checks produce clearer per-file diagnostics when read in order.
    const content = await readFile(join(root, file), "utf8");
    for (const expectedValue of expectedValues) {
      if (!content.includes(expectedValue)) {
        packageMetadataFailures.push(`${file}: missing ${expectedValue}`);
      }
    }
  } catch (error) {
    packageMetadataFailures.push(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (missing.length > 0 || invalidJson.length > 0 || packageMetadataFailures.length > 0) {
  console.error("Repository configuration check failed.");
  for (const file of missing) {
    console.error(`Missing: ${file}`);
  }
  for (const error of invalidJson) {
    console.error(`Invalid JSON: ${error}`);
  }
  for (const failure of packageMetadataFailures) {
    console.error(`Metadata: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Configuration check passed (${requiredFiles.length} required files).`);
}

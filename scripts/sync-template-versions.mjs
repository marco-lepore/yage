#!/usr/bin/env node
/**
 * Syncs @yagejs/* dependency versions in create-yage's template _package.json
 * files — and the `YAGE_RANGE` constant in `src/features.ts` that drives the
 * `--features` add-on deps — to match the version of @yagejs/core in the
 * monorepo. Intended to run as a pre-publish step so a scaffolded project
 * pins the exact versions of the release we're publishing.
 *
 * Both surfaces must move together: the templates and `features.ts` both
 * inject @yagejs/* deps into the scaffolded package.json, so if only the
 * templates were synced, `create-yage --features ui` would pin the base
 * template to the new version while the feature deps stayed on the old one.
 *
 * Usage:
 *   node scripts/sync-template-versions.mjs
 *
 * Idempotent — running it twice produces no diff the second time.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const corePkgPath = join(repoRoot, "packages", "core", "package.json");
const coreVersion = readJson(corePkgPath).version;
if (!coreVersion) {
  throw new Error(`Could not read version from ${corePkgPath}`);
}

const templatesRoot = join(
  repoRoot,
  "packages",
  "create-yage",
  "templates",
);

const templates = ["recommended", "minimal"];
const versionSpec = `^${coreVersion}`;

let changed = 0;
for (const template of templates) {
  const pkgPath = join(templatesRoot, template, "_package.json");
  const pkg = readJson(pkgPath);
  let touched = false;

  for (const section of ["dependencies", "devDependencies"]) {
    const deps = pkg[section];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith("@yagejs/") && deps[name] !== versionSpec) {
        deps[name] = versionSpec;
        touched = true;
      }
    }
  }

  if (touched) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`  updated ${template}/_package.json → ${versionSpec}`);
    changed++;
  } else {
    console.log(`  ${template}/_package.json already at ${versionSpec}`);
  }
}

console.log(
  changed === 0
    ? "All template versions already in sync."
    : `Synced ${changed} template(s) to ${versionSpec}.`,
);

// features.ts hardcodes the @yagejs/* range for the `--features` add-on deps
// in a single `YAGE_RANGE` constant; rewrite it the same way.
const featuresPath = join(
  templatesRoot,
  "..",
  "src",
  "features.ts",
);
const featuresSrc = readFileSync(featuresPath, "utf8");
const rangeRe = /(const YAGE_RANGE = )"[^"]*"(;)/;
if (!rangeRe.test(featuresSrc)) {
  throw new Error(
    `Could not find the YAGE_RANGE constant in ${featuresPath} — ` +
      `did its declaration change?`,
  );
}
const nextFeaturesSrc = featuresSrc.replace(
  rangeRe,
  `$1"${versionSpec}"$2`,
);
if (nextFeaturesSrc !== featuresSrc) {
  writeFileSync(featuresPath, nextFeaturesSrc);
  console.log(`  updated src/features.ts YAGE_RANGE → ${versionSpec}`);
} else {
  console.log(`  src/features.ts YAGE_RANGE already at ${versionSpec}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

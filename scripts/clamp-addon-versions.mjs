#!/usr/bin/env node
/**
 * Corrects the addon versions and engine peer ranges that `changeset version`
 * produces, so addons follow YAGE's pre-1.0 addon policy instead of changesets'
 * defaults. Intended to run right after `changeset version` in the
 * `version-packages` script.
 *
 * Three corrections, all a consequence of the same changesets behavior: addons
 * declare engine packages as `peerDependencies` with a capped range
 * (e.g. `>=0.9.0 <0.10.0`), and when an engine minor pushes that peer out of
 * range changesets force-bumps the addon.
 *
 *   1. Version: changesets bumps an out-of-range peer-dependent by `major`.
 *      On a pre-1.0 package `semver.inc("0.3.0", "major")` is `1.0.0`, so every
 *      addon jumps to 1.0.0 regardless of its current 0.x version. In pre-1.0
 *      semver a breaking change is a *minor* bump, so we clamp that back to
 *      `0.(minor+1).0` — and rewrite the generated CHANGELOG headings (the
 *      addon's own, and the "Updated dependencies" lines in consumers) so no
 *      release note cites a version that will never be published.
 *      (See packages/addons/AGENTS.md — "never propose 1.0.0".)
 *
 *   2. Peer range: changesets rewrites the capped `>=0.9.0 <0.10.0` to an
 *      open-ended `>=0.10.0`, dropping the upper bound the addon relies on
 *      (each engine minor is breaking pre-1.0). We restore the cap, re-flooring
 *      to the engine's new version: `>=0.10.0 <0.11.0`.
 *
 *   3. Engine dev-dependency floors must stay open (`>=<engine>`) per policy so
 *      the current workspace and the next engine minor both resolve. We
 *      normalize them, in case an addon authored a capped or caret range that
 *      changesets carried forward.
 *
 * Only addons whose version actually changed this release are touched, so a
 * no-op release stays a no-op.
 *
 * The "previous" version of each addon is read from a git ref (default `HEAD`,
 * which during `changeset version` is the pre-bump commit). Override with
 * ADDON_CLAMP_BASE_REF when running against an already-committed bump. The ref
 * must resolve — an unresolvable ref aborts the run rather than silently
 * skipping every addon (which would publish unclamped 1.0.0 versions).
 *
 * Usage:
 *   node scripts/clamp-addon-versions.mjs
 *   ADDON_CLAMP_BASE_REF=HEAD^ node scripts/clamp-addon-versions.mjs
 *
 * Idempotent — running it twice produces no diff the second time.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const baseRef = process.env.ADDON_CLAMP_BASE_REF || "HEAD";

const ENGINE_SCOPE = "@yagejs/";
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];

// name -> current workspace version, for every engine package under packages/*.
const engineVersions = new Map();
for (const entry of readdirSync(join(repoRoot, "packages"))) {
  const pkgPath = join(repoRoot, "packages", entry, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = readJson(pkgPath);
  if (pkg.name?.startsWith(ENGINE_SCOPE))
    engineVersions.set(pkg.name, pkg.version);
}

assertBaseRefResolves(baseRef);

const addonsRoot = join(repoRoot, "packages", "addons");
const clamped = new Map(); // addon name -> { generated, final }

for (const entry of readdirSync(addonsRoot)) {
  const pkgPath = join(addonsRoot, entry, "package.json");
  if (!existsSync(pkgPath)) continue;

  const relPath = `packages/addons/${entry}/package.json`;
  const pkg = readJson(pkgPath);
  const generated = pkg.version; // what changeset version wrote
  const previous = versionAtRef(baseRef, relPath);

  // Untouched this release (or brand-new addon) — leave it alone.
  if (previous === null || generated === previous) continue;

  // 1. Clamp an unwanted pre-1.0 -> 1.x graduation back to a 0.x minor.
  let finalVersion = generated;
  const [prevMajor, prevMinor] = previous.split(".").map(Number);
  if (prevMajor === 0 && major(generated) >= 1) {
    finalVersion = `0.${prevMinor + 1}.0`;
  }

  // 2. Restore the capped engine peer ranges changesets opened up.
  const peers = pkg.peerDependencies ?? {};
  for (const name of Object.keys(peers)) {
    const engineVersion = engineVersions.get(name);
    if (!engineVersion) continue; // non-engine peer (e.g. another addon) — leave it
    peers[name] = `>=${engineVersion} <${nextBreaking(engineVersion)}`;
  }

  // 3. Keep engine dev-dependency floors open per policy.
  const devDeps = pkg.devDependencies ?? {};
  for (const name of Object.keys(devDeps)) {
    const engineVersion = engineVersions.get(name);
    if (!engineVersion) continue;
    devDeps[name] = `>=${engineVersion}`;
  }

  if (finalVersion !== generated) {
    rewriteChangelogHeading(join(addonsRoot, entry), generated, finalVersion);
  }
  pkg.version = finalVersion;
  writeJson(pkgPath, pkg);
  clamped.set(pkg.name, { generated, final: finalVersion });

  const note =
    finalVersion === generated
      ? "peers re-floored"
      : `${generated} → ${finalVersion}`;
  console.log(`  ${pkg.name}: ${note}`);
}

// Re-point every workspace dependent at the clamped addon versions — changesets
// wrote e.g. "^1.0.0" into examples/e2e when it graduated the addons — and fix
// the version each dependent's generated changelog cites.
if (clamped.size > 0) {
  for (const pkgPath of workspacePackageJsons()) {
    const pkg = readJson(pkgPath);
    let touched = false;
    for (const section of DEP_SECTIONS) {
      const deps = pkg[section];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (!clamped.has(name)) continue;
        const range = deps[name];
        if (/^(workspace|file|link):/.test(range)) continue; // local protocol — leave it
        const prefix = range.match(/^[\^~]/)?.[0] ?? "^";
        const desired = `${prefix}${clamped.get(name).final}`;
        if (range !== desired) {
          deps[name] = desired;
          touched = true;
        }
      }
    }
    if (touched) {
      writeJson(pkgPath, pkg);
      console.log(`  re-pinned addon deps in ${rel(pkgPath)}`);
    }
    rewriteDependencyChangelog(dirname(pkgPath));
  }
}

console.log(
  clamped.size === 0
    ? "No addon versions needed clamping."
    : `Clamped ${clamped.size} addon(s) to the pre-1.0 policy.`,
);

// --- helpers ---------------------------------------------------------------

function major(version) {
  return Number(version.split(".")[0]);
}

// Next version an addon must exclude to stay pinned to one engine release line.
// Pre-1.0 the breaking bump is the next minor; from 1.x it's the next major.
function nextBreaking(version) {
  const [maj, min] = version.split(".").map(Number);
  return maj === 0 ? `0.${min + 1}.0` : `${maj + 1}.0.0`;
}

// A bad base ref must abort, not be mistaken for "every addon is new" — that
// would skip clamping entirely and publish 1.0.0 addons with uncapped peers.
function assertBaseRefResolves(ref) {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      {
        cwd: repoRoot,
        stdio: "ignore",
      },
    );
  } catch {
    throw new Error(
      `Base ref "${ref}" does not resolve — aborting so a bad ref can't ` +
        `silently skip clamping. Set ADDON_CLAMP_BASE_REF to a valid commit.`,
    );
  }
}

function versionAtRef(ref, relPath) {
  let raw;
  try {
    raw = execFileSync("git", ["show", `${ref}:${relPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // file absent at this (already-validated) ref — a new addon
  }
  // Malformed JSON is a real problem — let it throw rather than skip clamping.
  return JSON.parse(raw).version ?? null;
}

function rewriteChangelogHeading(addonDir, fromVersion, toVersion) {
  const changelogPath = join(addonDir, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return;
  const src = readFileSync(changelogPath, "utf8");
  const heading = `## ${fromVersion}`;
  if (!src.includes(heading)) return;
  writeFileSync(changelogPath, src.replace(heading, `## ${toVersion}`));
}

// Rewrite "Updated dependencies" lines that still cite a pre-clamp addon
// version (e.g. "@yagejs-addons/dialogue@1.0.0" -> "@0.4.0"). The clamped-away
// version only appears in the entry changesets just generated, so a targeted
// string replace is safe.
function rewriteDependencyChangelog(dir) {
  const changelogPath = join(dir, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return;
  let src = readFileSync(changelogPath, "utf8");
  let changed = false;
  for (const [name, { generated, final }] of clamped) {
    if (generated === final) continue;
    const needle = `${name}@${generated}`;
    if (src.includes(needle)) {
      src = src.split(needle).join(`${name}@${final}`);
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(changelogPath, src);
    console.log(`  rewrote changelog dep refs in ${rel(changelogPath)}`);
  }
}

function workspacePackageJsons() {
  const paths = [];
  for (const dir of ["packages", "packages/addons"]) {
    for (const entry of readdirSync(join(repoRoot, dir))) {
      const p = join(repoRoot, dir, entry, "package.json");
      if (existsSync(p)) paths.push(p);
    }
  }
  for (const dir of ["examples", "e2e", "docs"]) {
    const p = join(repoRoot, dir, "package.json");
    if (existsSync(p)) paths.push(p);
  }
  return paths;
}

function rel(path) {
  return path.slice(repoRoot.length + 1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

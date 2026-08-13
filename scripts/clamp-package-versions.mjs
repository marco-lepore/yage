#!/usr/bin/env node
/**
 * Corrects the versions and engine peer ranges that `changeset version`
 * produces, so they follow YAGE's pre-1.0 policy instead of changesets'
 * defaults. Intended to run right after `changeset version` in the
 * `version-packages` script.
 *
 * Corrections 1 to 3 cover the independently versioned packages under
 * `packages/addons/*` and `packages/tools/*`, and are a consequence of one
 * changesets behavior: these packages declare engine packages as
 * `peerDependencies` with a capped range (e.g. `>=0.9.0 <0.10.0`), and when an
 * engine minor pushes that peer out of range changesets force-bumps the
 * dependent. Correction 4 covers the engine packages themselves.
 *
 *   1. Version: changesets bumps an out-of-range peer-dependent by `major`.
 *      On a pre-1.0 package `semver.inc("0.3.0", "major")` is `1.0.0`, so every
 *      one of them jumps to 1.0.0 regardless of its current 0.x version. In
 *      pre-1.0 semver a breaking change is a *minor* bump, so we clamp that
 *      back to `0.(minor+1).0` — and rewrite the generated CHANGELOG headings
 *      (the package's own, and the "Updated dependencies" lines in consumers)
 *      so no release note cites a version that will never be published.
 *      (See packages/addons/AGENTS.md — "never propose 1.0.0".)
 *
 *   2. Peer range: changesets rewrites the capped `>=0.9.0 <0.10.0` to an
 *      open-ended `>=0.10.0`, dropping the upper bound the package relies on
 *      (each engine minor is breaking pre-1.0). We restore the cap, re-flooring
 *      to the engine's new version: `>=0.10.0 <0.11.0`.
 *
 *   3. Engine dev-dependency floors must stay open (`>=<engine>`) per policy so
 *      the current workspace and the next engine minor both resolve. We
 *      normalize them, in case a package authored a capped or caret range that
 *      changesets carried forward.
 *
 *   4. Engine-on-engine peer ranges under `packages/*` get the same treatment
 *      as the addons — floored at the engine's version, capped below the next
 *      minor. Changesets leaves a peer range that the new version already
 *      satisfies, so a hand-written window stays open across minors and lets
 *      npm resolve two engine minors into one install.
 *
 * For corrections 1 to 3 only packages whose version actually changed this
 * release are touched, so a no-op release stays a no-op. Correction 4 compares
 * against the range already written and skips a manifest that needs no change,
 * so it is a no-op on the same terms.
 *
 * The "previous" version of each package is read from a git ref (default
 * `HEAD`, which during `changeset version` is the pre-bump commit). Override
 * with CLAMP_BASE_REF when running against an already-committed bump. The ref
 * must resolve — an unresolvable ref aborts the run rather than silently
 * skipping every package (which would publish unclamped 1.0.0 versions).
 *
 * Usage:
 *   node scripts/clamp-package-versions.mjs
 *   CLAMP_BASE_REF=HEAD^ node scripts/clamp-package-versions.mjs
 *
 * Idempotent — running it twice produces no diff the second time.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const baseRef = process.env.CLAMP_BASE_REF || "HEAD";

const ENGINE_SCOPE = "@yagejs/";
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"];
/** Directories under packages/ whose packages are versioned independently. */
const GROUPS = ["addons", "tools"];

// Every engine package under packages/*, by name: current workspace version,
// and the manifest to write back to.
const engineVersions = new Map();
const enginePackagePaths = new Map();
for (const entry of readdirSync(join(repoRoot, "packages"))) {
  const pkgPath = join(repoRoot, "packages", entry, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = readJson(pkgPath);
  if (pkg.name?.startsWith(ENGINE_SCOPE)) {
    engineVersions.set(pkg.name, pkg.version);
    enginePackagePaths.set(pkg.name, pkgPath);
  }
}

assertBaseRefResolves(baseRef);

// Cap every engine-on-engine peer range to the release's minor line.
//
// Engine packages are in the `fixed` group, so changesets gives them all one
// version and rewrites their caret dependency ranges to match. It leaves a
// peer range alone when the new version already satisfies it, so a range like
// `>=0.3.0 <1.0.0` stays open across every minor. npm then accepts a game that
// installs two engine minors side by side and resolves a second copy of a
// shared package under one of them, with no warning — separate service
// containers and class identities, so an entity made through one is not usable
// through the other.
//
// Membership is read off disk rather than listed: a peer is an engine peer
// when `engineVersions` has it, so a new package or a new peer edge is covered
// with no bookkeeping, and a third-party peer such as pixi.js is skipped.
for (const [name, pkgPath] of enginePackagePaths) {
  const pkg = readJson(pkgPath);
  const peers = pkg.peerDependencies ?? {};
  let touched = false;
  for (const peerName of Object.keys(peers)) {
    const engineVersion = engineVersions.get(peerName);
    if (!engineVersion) continue; // non-engine peer — leave it
    const desired = `>=${engineVersion} <${nextBreaking(engineVersion)}`;
    if (peers[peerName] === desired) continue;
    peers[peerName] = desired;
    touched = true;
  }
  if (touched) {
    writeJson(pkgPath, pkg);
    console.log(`  ${name}: engine peers capped`);
  }
}

const clamped = new Map(); // package name -> { generated, final }

for (const { dir, relPath } of independentPackages()) {
  const pkgPath = join(dir, "package.json");
  const pkg = readJson(pkgPath);
  const generated = pkg.version; // what changeset version wrote
  const previous = versionAtRef(baseRef, relPath);

  // Untouched this release (or brand-new package) — leave it alone.
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
    rewriteChangelogHeading(dir, generated, finalVersion);
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

// Re-point every workspace dependent at the clamped versions — changesets
// wrote e.g. "^1.0.0" into examples/e2e when it graduated them — and fix the
// version each dependent's generated changelog cites.
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
      console.log(`  re-pinned deps in ${rel(pkgPath)}`);
    }
    rewriteDependencyChangelog(dirname(pkgPath));
  }
}

console.log(
  clamped.size === 0
    ? "No versions needed clamping."
    : `Clamped ${clamped.size} package(s) to the pre-1.0 policy.`,
);

// --- helpers ---------------------------------------------------------------

function major(version) {
  return Number(version.split(".")[0]);
}

// Next version a package must exclude to stay pinned to one engine release
// line. Pre-1.0 the breaking bump is the next minor; from 1.x it's the major.
function nextBreaking(version) {
  const [maj, min] = version.split(".").map(Number);
  return maj === 0 ? `0.${min + 1}.0` : `${maj + 1}.0.0`;
}

// A bad base ref must abort, not be mistaken for "every package is new" — that
// would skip clamping entirely and publish 1.0.0 versions with uncapped peers.
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
        `silently skip clamping. Set CLAMP_BASE_REF to a valid commit.`,
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
    return null; // file absent at this (already-validated) ref — a new package
  }
  // Malformed JSON is a real problem — let it throw rather than skip clamping.
  return JSON.parse(raw).version ?? null;
}

function rewriteChangelogHeading(dir, fromVersion, toVersion) {
  const changelogPath = join(dir, "CHANGELOG.md");
  if (!existsSync(changelogPath)) return;
  const src = readFileSync(changelogPath, "utf8");
  const heading = `## ${fromVersion}`;
  if (!src.includes(heading)) return;
  writeFileSync(changelogPath, src.replace(heading, `## ${toVersion}`));
}

// Rewrite "Updated dependencies" lines that still cite a pre-clamp version
// (e.g. "@yagejs-addons/dialogue@1.0.0" -> "@0.4.0"). The clamped-away version
// only appears in the entry changesets just generated, so a targeted string
// replace is safe.
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

/**
 * The packages this script governs: everything under the groups that version
 * independently. Returns `{ dir, relPath }`, where `relPath` is what `git show`
 * needs to read the same file at the base ref.
 */
function independentPackages() {
  const found = [];
  for (const group of GROUPS) {
    const groupRoot = join(repoRoot, "packages", group);
    if (!existsSync(groupRoot)) continue;
    for (const entry of readdirSync(groupRoot)) {
      const dir = join(groupRoot, entry);
      if (!existsSync(join(dir, "package.json"))) continue;
      found.push({ dir, relPath: `packages/${group}/${entry}/package.json` });
    }
  }
  return found;
}

function workspacePackageJsons() {
  const paths = [];
  for (const dir of ["packages", ...GROUPS.map((g) => `packages/${g}`)]) {
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

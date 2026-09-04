#!/usr/bin/env node
/**
 * Corrects the versions and engine peer ranges that `changeset version`
 * produces, so they follow YAGE's pre-1.0 policy instead of changesets'
 * defaults. Intended to run right after `changeset version` in the
 * `version-packages` script.
 *
 * YAGE keeps breaking releases on the next minor while a package is below
 * 1.0. Changesets can generate a major when an engine peer leaves its capped
 * range, and propagate that major through a fixed version group.
 *
 * Versions are corrected first, for fixed groups (including create-yage) and
 * independently versioned addons and tools. Dependency ranges and generated
 * changelogs then use those final versions. Engine peers are capped below the
 * next breaking release; addon and tool engine dev-dependencies stay open.
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

assertBaseRefResolves(baseRef);

const packagePaths = workspacePackageJsons();
const packagesByName = new Map(
  packagePaths.map((path) => [readJson(path).name, path]),
);
const independent = independentPackages();
const clamped = new Map(); // package name -> { generated, final }

// Fixed members share the next minor of the group's highest previous version,
// including newly added members that have no version at the base ref.
const { fixed } = readJson(join(repoRoot, ".changeset", "config.json"));
for (const names of fixed) {
  const paths = names.map((name) => {
    const path = packagesByName.get(name);
    if (!path)
      throw new Error(`Fixed release package "${name}" was not found.`);
    return path;
  });
  const previous = paths
    .map((path) => versionAtRef(baseRef, rel(path)))
    .filter((version) => version !== null);
  if (
    previous.length === 0 ||
    previous.some((version) => major(version) !== 0)
  ) {
    continue;
  }
  if (!paths.some((path) => major(readJson(path).version) >= 1)) continue;
  const nextMinor =
    Math.max(...previous.map((v) => Number(v.split(".")[1]))) + 1;
  for (const path of paths) clampVersion(path, `0.${nextMinor}.0`);
}

for (const { dir, relPath } of independent) {
  const path = join(dir, "package.json");
  const previous = versionAtRef(baseRef, relPath);
  if (
    previous !== null &&
    major(previous) === 0 &&
    major(readJson(path).version) >= 1
  ) {
    clampVersion(path, `0.${Number(previous.split(".")[1]) + 1}.0`);
  }
}

// Engine ranges must use the corrected versions, not Changesets' output.
const enginePackagePaths = new Map(
  [...packagesByName].filter(
    ([name, path]) =>
      name.startsWith(ENGINE_SCOPE) &&
      dirname(dirname(path)) === join(repoRoot, "packages"),
  ),
);
const engineVersions = new Map(
  [...enginePackagePaths].map(([name, path]) => [name, readJson(path).version]),
);

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

for (const { dir, relPath } of independent) {
  const pkgPath = join(dir, "package.json");
  const pkg = readJson(pkgPath);
  const previous = versionAtRef(baseRef, relPath);

  // Untouched this release (or brand-new package) — leave it alone.
  if (previous === null || pkg.version === previous) continue;

  // Engine peer ranges cover one breaking release line.
  const peers = pkg.peerDependencies ?? {};
  for (const name of Object.keys(peers)) {
    const engineVersion = engineVersions.get(name);
    if (!engineVersion) continue; // non-engine peer (e.g. another addon) — leave it
    peers[name] = `>=${engineVersion} <${nextBreaking(engineVersion)}`;
  }

  // Engine dev-dependency floors stay open per policy.
  const devDeps = pkg.devDependencies ?? {};
  for (const name of Object.keys(devDeps)) {
    const engineVersion = engineVersions.get(name);
    if (!engineVersion) continue;
    devDeps[name] = `>=${engineVersion}`;
  }

  writeJson(pkgPath, pkg);
  console.log(`  ${pkg.name}: peers re-floored`);
}

// Re-point every workspace dependent at the clamped versions — changesets
// wrote e.g. "^1.0.0" into examples/e2e when it graduated them — and fix the
// version each dependent's generated changelog cites.
if (clamped.size > 0) {
  for (const pkgPath of packagePaths) {
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
        const version = clamped.get(name).final;
        const isEngine = engineVersions.has(name);
        const isIndependent = independent.some(
          ({ dir }) => dir === dirname(pkgPath),
        );
        const desired =
          isEngine && section === "peerDependencies"
            ? `>=${version} <${nextBreaking(version)}`
            : isEngine && section === "devDependencies" && isIndependent
              ? `>=${version}`
              : `${prefix}${version}`;
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

function clampVersion(path, version) {
  const pkg = readJson(path);
  if (pkg.version === version) return;
  clamped.set(pkg.name, { generated: pkg.version, final: version });
  rewriteChangelogHeading(dirname(path), pkg.version, version);
  console.log(`  ${pkg.name}: ${pkg.version} → ${version}`);
  pkg.version = version;
  writeJson(path, pkg);
}

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

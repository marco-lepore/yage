#!/usr/bin/env node
/**
 * Build a game from another checkout against this repository's packages, so a
 * native run exercises this engine rather than the versions the game
 * declares.
 *
 * Usage:
 *   node e2e/native/prepare-game.mjs --source <checkout> --workspace <name>
 *     [--build-script build] [--out dist] [--slug <name>]
 *
 * It copies what the named workspace needs into its own directory under
 * `.work/games/<slug>/src`, packs every engine, addon and tool package that
 * copy depends on, points each reference at the packed file, installs,
 * builds, and records exactly what went in.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(nativeDir, "../..");
const workDir = resolve(nativeDir, ".work");

/** Where this repository keeps the packages a game can be built against. */
const PACKAGE_ROOTS = ["packages", "packages/addons", "packages/tools"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    buildScript: "build",
    out: "dist",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) fail(`prepare-game: ${flag} needs a value.`);
    if (flag === "--source") args.source = resolve(value);
    else if (flag === "--workspace") args.workspace = value;
    else if (flag === "--build-script") args.buildScript = value;
    else if (flag === "--out") args.out = value;
    else if (flag === "--slug") args.slug = value;
    else fail(`prepare-game: unknown option ${JSON.stringify(flag)}.`);
  }
  if (!args.source) fail("prepare-game: --source is required.");
  if (!args.workspace) fail("prepare-game: --workspace is required.");
  args.slug ??= args.workspace.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    ...options,
  });
}

/** Every workspace directory of a checkout, by package name. */
function readWorkspaces(source) {
  const manifest = readJson(resolve(source, "package.json"));
  const patterns = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  if (patterns.length === 0) {
    fail(
      `prepare-game: ${resolve(source, "package.json")} lists no workspaces.`,
    );
  }
  const found = new Map();
  for (const pattern of patterns) {
    const parts = pattern.split("/");
    const dirs =
      parts.at(-1) === "*"
        ? readdirSync(resolve(source, parts.slice(0, -1).join("/")), {
            withFileTypes: true,
          })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(parts.slice(0, -1).join("/"), entry.name))
        : [pattern];
    for (const dir of dirs) {
      const path = resolve(source, dir, "package.json");
      if (!existsSync(path)) continue;
      found.set(readJson(path).name, dir);
    }
  }
  return found;
}

/** The dependency names one manifest declares. */
function dependencyNames(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
}

/** This repository's packages, by package name. */
function readLocalPackages() {
  const found = new Map();
  for (const root of PACKAGE_ROOTS) {
    for (const entry of readdirSync(resolve(repoRoot, root), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const path = resolve(repoRoot, root, entry.name, "package.json");
      if (!existsSync(path)) continue;
      found.set(readJson(path).name, `${root}/${entry.name}`);
    }
  }
  return found;
}

const args = parseArgs(process.argv.slice(2));
if (!existsSync(resolve(args.source, "package.json"))) {
  fail(`prepare-game: ${args.source} has no package.json.`);
}
const workspaces = readWorkspaces(args.source);
if (!workspaces.has(args.workspace)) {
  fail(
    `prepare-game: ${args.source} has no workspace named ` +
      `${JSON.stringify(args.workspace)}. It has: ` +
      `${[...workspaces.keys()].join(", ")}.`,
  );
}

const sourceCommit = run("git", [
  "-C",
  args.source,
  "rev-parse",
  "HEAD",
]).trim();
const sourceDirty = run("git", ["-C", args.source, "status", "--porcelain"])
  .split("\n")
  .filter((line) => line !== "");

// --- 1. Copy what the workspace needs -------------------------------------

const gameDir = resolve(workDir, "games", args.slug);
const copyDir = resolve(gameDir, "src");
const packsDir = resolve(gameDir, "packs");
rmSync(gameDir, { recursive: true, force: true });
mkdirSync(copyDir, { recursive: true });
mkdirSync(packsDir, { recursive: true });

const needed = new Set();
const queue = [args.workspace];
while (queue.length > 0) {
  const name = queue.shift();
  if (needed.has(name)) continue;
  const dir = workspaces.get(name);
  if (dir === undefined) continue;
  needed.add(name);
  const manifest = readJson(resolve(args.source, dir, "package.json"));
  for (const dependency of dependencyNames(manifest)) {
    if (workspaces.has(dependency)) queue.push(dependency);
  }
}

for (const entry of readdirSync(args.source, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  cpSync(resolve(args.source, entry.name), resolve(copyDir, entry.name));
}
const copiedDirs = [];
for (const name of needed) {
  const dir = workspaces.get(name);
  copiedDirs.push(dir);
  cpSync(resolve(args.source, dir), resolve(copyDir, dir), {
    recursive: true,
    filter: (path) => {
      const base = path.split("/").at(-1);
      return !["node_modules", ".git", "dist", "output"].includes(base);
    },
  });
}
const rootManifest = readJson(resolve(copyDir, "package.json"));
rootManifest.workspaces = copiedDirs;
writeJson(resolve(copyDir, "package.json"), rootManifest);
// The copy's engine references become packed files below, which the source's
// lock file cannot describe: npm then reports every rewritten package as
// missing. The install resolves the whole tree itself, and the provenance
// records the third-party versions it settled on.
rmSync(resolve(copyDir, "package-lock.json"), { force: true });

// --- 2. Pack the engine packages the copy uses ----------------------------

const localPackages = readLocalPackages();
const wanted = new Set();
const declared = new Set();
const packQueue = [];
for (const dir of copiedDirs) {
  const manifest = readJson(resolve(copyDir, dir, "package.json"));
  for (const name of dependencyNames(manifest)) declared.add(name);
  packQueue.push(...dependencyNames(manifest));
}
while (packQueue.length > 0) {
  const name = packQueue.shift();
  if (!localPackages.has(name) || wanted.has(name)) continue;
  wanted.add(name);
  const manifest = readJson(
    resolve(repoRoot, localPackages.get(name), "package.json"),
  );
  packQueue.push(...Object.keys(manifest.dependencies ?? {}));
  packQueue.push(...Object.keys(manifest.peerDependencies ?? {}));
}
if (wanted.size === 0) {
  fail(
    `prepare-game: the copied workspaces declare no package of this ` +
      `repository, so there is nothing to build against.`,
  );
}
for (const name of wanted) {
  const dist = resolve(repoRoot, localPackages.get(name), "dist");
  if (!existsSync(dist)) {
    fail(`prepare-game: ${name} has no built dist. Run npx turbo build first.`);
  }
}
const packed = JSON.parse(
  run(
    "npm",
    [
      "pack",
      ...[...wanted].flatMap((name) => ["-w", name]),
      "--pack-destination",
      packsDir,
      "--json",
    ],
    { cwd: repoRoot },
  ),
);
const tarballs = new Map();
for (const entry of packed) {
  tarballs.set(entry.name, {
    name: entry.name,
    version: entry.version,
    file: resolve(packsDir, entry.filename),
    integrity: entry.integrity ?? entry.shasum ?? null,
  });
}
for (const name of wanted) {
  if (!tarballs.has(name)) fail(`prepare-game: npm packed no ${name}.`);
}

// --- 3. Point every reference at a packed file ----------------------------

const overrides = {};
for (const [name, tarball] of tarballs) {
  overrides[name] = `file:${tarball.file}`;
}
for (const dir of ["", ...copiedDirs]) {
  const path = resolve(copyDir, dir, "package.json");
  const manifest = readJson(path);
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (overrides[name]) manifest[field][name] = overrides[name];
    }
  }
  if (dir === "") manifest.overrides = { ...manifest.overrides, ...overrides };
  writeJson(path, manifest);
}

// --- 4. Install, verify, build -------------------------------------------

run("npm", ["install", "--no-audit", "--no-fund"], {
  cwd: copyDir,
  stdio: "inherit",
});

const installed = JSON.parse(
  run("npm", ["ls", "--all", "--json"], { cwd: copyDir }),
);
const foreign = [];
const fromPacks = new Set();
// A node without `resolved` is a reference to a copy listed elsewhere in the
// tree, so only a node that names where it came from is checked.
const visit = (node, name) => {
  if (name !== undefined && tarballs.has(name) && node.resolved) {
    if (node.resolved.includes(`${packsDir}/`)) fromPacks.add(name);
    else foreign.push(`${name} came from ${node.resolved}`);
  }
  for (const [child, value] of Object.entries(node.dependencies ?? {})) {
    visit(value, child);
  }
};
visit(installed);
// Every package the copy declares must come from a packed file. A packed
// peer of an engine package that nothing installed is not in the tree, which
// is the install's own answer about what the game needs.
const unused = [...declared].filter(
  (name) => tarballs.has(name) && !fromPacks.has(name),
);
if (foreign.length > 0 || unused.length > 0) {
  fail(
    `prepare-game: the install did not use the packed files for every ` +
      `package.\n${[
        ...foreign,
        ...unused.map((name) => `${name} is in no installed copy`),
      ].join("\n")}`,
  );
}

run("npm", ["run", args.buildScript, "-w", args.workspace], {
  cwd: copyDir,
  stdio: "inherit",
});

const built = resolve(copyDir, workspaces.get(args.workspace), args.out);
if (!existsSync(built)) {
  fail(`prepare-game: the build produced no directory at ${built}.`);
}
const webDir = resolve(workDir, "web", `game-${args.slug}`);
rmSync(webDir, { recursive: true, force: true });
mkdirSync(dirname(webDir), { recursive: true });
cpSync(built, webDir, { recursive: true });

// --- 5. Record what went in ----------------------------------------------

function hashDir(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const bytes = readFileSync(path);
        files.push({
          path: relative(dir, path),
          bytes: statSync(path).size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  };
  walk(dir);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    files,
    digest: createHash("sha256")
      .update(files.map((file) => `${file.sha256}  ${file.path}`).join("\n"))
      .digest("hex"),
  };
}

/**
 * The version the built workspace resolves: its own `node_modules` first, then
 * each directory up to the copy's root and no further, so a package the copy
 * does not install reads `null` rather than a version from another tree.
 */
function installedVersion(name) {
  let dir = resolve(copyDir, workspaces.get(args.workspace));
  for (;;) {
    const path = resolve(dir, "node_modules", name, "package.json");
    if (existsSync(path)) return readJson(path).version;
    if (dir === copyDir) return null;
    dir = resolve(dir, "..");
  }
}

const lockPath = resolve(copyDir, "package-lock.json");

const provenance = {
  source: args.source,
  commit: sourceCommit,
  dirty: sourceDirty,
  workspace: args.workspace,
  copiedWorkspaces: copiedDirs,
  lockFile: {
    path: relative(gameDir, lockPath),
    sha256: createHash("sha256").update(readFileSync(lockPath)).digest("hex"),
  },
  packages: [...tarballs.values()].map((tarball) => ({
    ...tarball,
    file: relative(gameDir, tarball.file),
  })),
  resolved: Object.fromEntries(
    [
      "pixi.js",
      "@pixi/sound",
      "@dimforge/rapier2d",
      "yoga-layout",
      "react",
    ].map((name) => [name, installedVersion(name)]),
  ),
  build: hashDir(webDir),
};
const provenancePath = resolve(gameDir, "provenance.json");
writeJson(provenancePath, provenance);

console.log(`web directory: ${webDir}`);
console.log(`provenance: ${provenancePath}`);
console.log(`digest: ${provenance.build.digest}`);

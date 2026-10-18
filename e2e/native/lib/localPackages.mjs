/**
 * Build this repository's packages into tarballs and point a manifest at
 * them, so an installed project runs the code in this checkout rather than
 * the versions it declares.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Where this repository keeps the packages a game can be built against. */
const PACKAGE_ROOTS = ["packages", "packages/addons", "packages/tools"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** This repository's packages, by package name. */
export function readLocalPackages() {
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

/**
 * Pack the named packages and everything they depend on inside this
 * repository, and return each one's name, version, tarball and integrity by
 * package name.
 */
export function packLocalPackages({ names, destination }) {
  const local = readLocalPackages();
  const wanted = new Set();
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!local.has(name) || wanted.has(name)) continue;
    wanted.add(name);
    const manifest = readJson(
      resolve(repoRoot, local.get(name), "package.json"),
    );
    queue.push(...Object.keys(manifest.dependencies ?? {}));
    queue.push(...Object.keys(manifest.peerDependencies ?? {}));
  }
  if (wanted.size === 0) {
    throw new Error(
      "packLocalPackages: none of the named packages belongs to this " +
        "repository, so there is nothing to build against.",
    );
  }
  for (const name of wanted) {
    const dist = resolve(repoRoot, local.get(name), "dist");
    if (!existsSync(dist)) {
      throw new Error(
        `packLocalPackages: ${name} has no built dist. Run npx turbo build first.`,
      );
    }
  }
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        ...[...wanted].flatMap((name) => ["-w", name]),
        "--pack-destination",
        destination,
        "--json",
      ],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 1 << 26 },
    ),
  );
  const tarballs = new Map();
  for (const entry of packed) {
    tarballs.set(entry.name, {
      name: entry.name,
      version: entry.version,
      file: resolve(destination, entry.filename),
      integrity: entry.integrity ?? entry.shasum ?? null,
    });
  }
  for (const name of wanted) {
    if (!tarballs.has(name)) {
      throw new Error(`packLocalPackages: npm packed no ${name}.`);
    }
  }
  return tarballs;
}

/**
 * Point every dependency of `manifest` that was packed at its tarball, and
 * return the overrides that pin the whole tree to the same files. The
 * manifest is changed in place.
 */
export function pointAtTarballs(manifest, tarballs) {
  const overrides = {};
  for (const [name, tarball] of tarballs)
    overrides[name] = `file:${tarball.file}`;
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (overrides[name]) manifest[field][name] = overrides[name];
    }
  }
  return overrides;
}

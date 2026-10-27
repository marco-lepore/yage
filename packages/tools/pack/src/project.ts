import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * The identifiers Capacitor and the Electron shell both accept: letters and
 * digits in each dot-separated part, starting with a letter. An underscore is
 * refused by the shell and a hyphen by Capacitor, so neither is allowed.
 */
export const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;

/** Where each host's web build is read from, relative to the game's root. */
export const WEB_DIRS: Readonly<Record<"electron" | "capacitor", string>> =
  Object.freeze({ electron: "dist-electron", capacitor: "dist-capacitor" });

/** The one name, version and identifier both hosts are built from. */
export interface AppIdentity {
  readonly appId: string;
  readonly name: string;
  readonly version: string;
}

/** The fields of a `package.json` this tool reads. */
export interface GameManifest {
  readonly name?: unknown;
  readonly productName?: unknown;
  readonly version?: unknown;
  readonly main?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly workspaces?: unknown;
  readonly yage?: { readonly appId?: unknown };
}

/** Read `<root>/package.json`, or `undefined` when there is none. */
export function readManifest(root: string): GameManifest | undefined {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as GameManifest;
}

/**
 * The app's name, version and identifier, read from the game's own
 * `package.json`. Both hosts are configured from these three fields, so a
 * desktop build and a mobile build can never disagree about them.
 */
export function readIdentity(root: string, prefix: string): AppIdentity {
  const manifest = readManifest(root);
  if (manifest === undefined) {
    throw new Error(
      `${prefix}: no package.json in ${root}. Run this from the game's root directory.`,
    );
  }
  const name = manifest.productName;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(
      `${prefix}: package.json must set "productName" to the app's name, got ${JSON.stringify(name)}.`,
    );
  }
  const appId = manifest.yage?.appId;
  if (typeof appId !== "string" || !APP_ID_PATTERN.test(appId)) {
    throw new Error(
      `${prefix}: package.json "yage.appId" must match ${APP_ID_PATTERN.source}, got ${JSON.stringify(appId)}.`,
    );
  }
  const version = manifest.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(
      `${prefix}: package.json must set "version", got ${JSON.stringify(version)}.`,
    );
  }
  return { appId, name, version };
}

/**
 * The `node_modules` directories the game's packages can come from, nearest
 * first: the game's own, then one per directory up to the root of the npm
 * workspace the game belongs to. A game outside a workspace has only its own.
 */
export function nodeModulesChain(root: string): string[] {
  const game = path.resolve(root);
  const top = searchTop(game);
  const chain: string[] = [];
  for (let dir = game; ; dir = path.dirname(dir)) {
    chain.push(path.join(dir, "node_modules"));
    if (dir === top) return chain;
  }
}

/** The manifest of a package as the game resolves it, or `undefined`. */
export function resolvePackage(
  root: string,
  name: string,
): { readonly dir: string; readonly manifest: GameManifest } | undefined {
  const game = path.resolve(root);
  const dir = lookUp(game, name, searchTop(game));
  if (dir === undefined) return undefined;
  return { dir, manifest: readPackageManifest(dir) };
}

/** The installed version of a package, or `null` when it is not installed. */
export function installedVersion(root: string, name: string): string | null {
  const found = resolvePackage(root, name);
  const version = found?.manifest.version;
  return typeof version === "string" ? version : null;
}

/** One package of a production-dependency closure. */
export interface ClosurePackage {
  readonly name: string;
  /** Where the install put it; `undefined` when it is not installed. */
  readonly dir: string | undefined;
}

/**
 * The named packages and every package they load through `dependencies` or
 * `optionalDependencies`, each found the way Node finds it from the package
 * that depends on it. An optional dependency the install left out, such as a
 * native build for another platform, is not part of the closure. The Electron
 * packager copies a symbolic link as the files it points to, so a linked
 * package keeps the path the game's folder gives it.
 */
export function productionClosure(
  root: string,
  names: readonly string[],
): ClosurePackage[] {
  return closure(root, names, {
    edges: (manifest) => Object.keys(manifest.dependencies ?? {}),
    optionalEdges: (manifest) =>
      Object.keys(manifest.optionalDependencies ?? {}),
    realPaths: false,
  });
}

/** One installed copy of a package and what loads it. */
export interface LoadedCopy {
  /** The copy's folder, with symbolic links resolved. */
  readonly dir: string;
  readonly version: string;
  /** `the game`, or the names of the packages that load this copy. */
  readonly loadedBy: readonly string[];
}

/**
 * The copies of `name` the game's module graph loads. The graph holds every
 * package the game lists in `dependencies` or `devDependencies`, and every
 * package that a package in the graph lists in `dependencies` or
 * `peerDependencies`, at any depth. Each is found the way Node finds it, from
 * the folder a symbolic link points to. Each package that declares `name`
 * loads the copy it resolves from its own folder, and the game loads the copy
 * it resolves when it lists `name` itself.
 */
export function loadedCopies(root: string, name: string): LoadedCopy[] {
  const game = path.resolve(root);
  const top = searchTop(game);
  const manifest = readManifest(game);
  const declared = (found: GameManifest): string[] => [
    ...Object.keys(found.dependencies ?? {}),
    ...Object.keys(found.peerDependencies ?? {}),
  ];
  const listed = [
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ];
  const loaders: { readonly name: string; readonly from: string }[] =
    listed.includes(name) ? [{ name: "the game", from: game }] : [];
  for (const entry of closure(game, listed, {
    edges: declared,
    realPaths: true,
  })) {
    if (entry.dir === undefined) continue;
    if (declared(readPackageManifest(entry.dir)).includes(name)) {
      loaders.push({ name: entry.name, from: entry.dir });
    }
  }
  const copies = new Map<
    string,
    { dir: string; version: string; loadedBy: string[] }
  >();
  for (const loader of loaders) {
    const dir = lookUp(loader.from, name, top);
    if (dir === undefined) continue;
    const real = realpathSync(dir);
    const version = readPackageManifest(dir).version;
    const copy = copies.get(real) ?? {
      dir: real,
      version: typeof version === "string" ? version : "unknown",
      loadedBy: [],
    };
    copy.loadedBy.push(loader.name);
    copies.set(real, copy);
  }
  return [...copies.values()];
}

/**
 * The named packages and every package `edges` and `optionalEdges` name from
 * their manifests, each found from the folder of the package that names it.
 * A package `optionalEdges` names and the install left out is skipped; any
 * other package that is not installed is listed with no `dir`. With
 * `realPaths`, the folder is the one a symbolic link points to, as Node and a
 * bundler resolve it; without, it keeps the path the game's folder gives it.
 */
function closure(
  root: string,
  names: readonly string[],
  options: {
    readonly edges: (manifest: GameManifest) => readonly string[];
    readonly optionalEdges?: (manifest: GameManifest) => readonly string[];
    readonly realPaths: boolean;
  },
): ClosurePackage[] {
  const game = path.resolve(root);
  const top = searchTop(game);
  const found: ClosurePackage[] = [];
  const seen = new Set<string>();
  const queue = names.map((name) => ({ name, from: game, optional: false }));
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const located = lookUp(next.from, next.name, top);
    if (located === undefined && next.optional) continue;
    const dir =
      located !== undefined && options.realPaths
        ? realpathSync(located)
        : located;
    const key = dir ?? `missing ${next.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name: next.name, dir });
    if (dir === undefined) continue;
    const manifest = readPackageManifest(dir);
    for (const dependency of options.edges(manifest)) {
      queue.push({ name: dependency, from: dir, optional: false });
    }
    for (const dependency of options.optionalEdges?.(manifest) ?? []) {
      queue.push({ name: dependency, from: dir, optional: true });
    }
  }
  return found;
}

/**
 * The packaging guide's section on installing a workspace member's packages
 * in its own `node_modules`, with what each route changes.
 */
export const WORKSPACE_GUIDE =
  "https://yage.dev/tooling/packaging#a-game-inside-an-npm-workspace";

/**
 * Whether a package directory is inside the game's own `node_modules`, the
 * only packages an Electron package carries.
 */
export function inGameModules(root: string, dir: string): boolean {
  const modules = path.join(path.resolve(root), "node_modules");
  return dir.startsWith(`${modules}${path.sep}`);
}

/**
 * The last directory whose `node_modules` the game's packages come from: the
 * root of the npm workspace the game belongs to, or the game itself. An
 * ancestor is that root when its `node_modules` links the game in under the
 * game's package name, as npm does for each workspace member, and its
 * `package.json` declares `workspaces`.
 */
function searchTop(game: string): string {
  const name = readManifest(game)?.name;
  if (typeof name !== "string" || name.length === 0) return game;
  const real = realpathSync(game);
  for (let dir = path.dirname(game); ; dir = path.dirname(dir)) {
    const link = path.join(dir, "node_modules", ...name.split("/"));
    if (
      existsSync(link) &&
      realpathSync(link) === real &&
      readManifest(dir)?.workspaces !== undefined
    ) {
      return dir;
    }
    if (path.dirname(dir) === dir) return game;
  }
}

/** A package's directory as Node finds it from `from`, searching up to `top`. */
function lookUp(from: string, name: string, top: string): string | undefined {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", ...name.split("/"));
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === top || path.dirname(dir) === dir) return undefined;
  }
}

function readPackageManifest(dir: string): GameManifest {
  return JSON.parse(
    readFileSync(path.join(dir, "package.json"), "utf8"),
  ) as GameManifest;
}

/**
 * Whether `version` falls in `range`, which must be written `^X.Y.Z`. Every
 * range this tool compares comes from a YAGE package's own
 * `peerDependencies`, and a range in any other form is a mistake in that
 * manifest rather than something to interpret.
 */
export function satisfiesCaret(version: string, range: string): boolean {
  const wanted = parseVersion(range.startsWith("^") ? range.slice(1) : "");
  if (!range.startsWith("^") || wanted === undefined) {
    throw new Error(
      `satisfiesCaret: range must be written ^X.Y.Z, got ${JSON.stringify(range)}.`,
    );
  }
  const found = parseVersion(version);
  if (found === undefined) return false;
  if (compareVersions(found, wanted) < 0) return false;
  // A caret keeps the leftmost non-zero part: ^1.2.3 allows 1.x, ^0.2.3
  // allows 0.2.x and ^0.0.3 only 0.0.3.
  const ceiling: readonly [number, number, number] =
    wanted[0] !== 0
      ? [wanted[0] + 1, 0, 0]
      : wanted[1] !== 0
        ? [0, wanted[1] + 1, 0]
        : [0, 0, wanted[2] + 1];
  return compareVersions(found, ceiling) < 0;
}

/** Whether `version` is at least `floor`, both written `X.Y.Z`. */
export function atLeast(version: string, floor: string): boolean {
  const found = parseVersion(version);
  const wanted = parseVersion(floor);
  if (found === undefined || wanted === undefined) return false;
  return compareVersions(found, wanted) >= 0;
}

/** The three numbers of a version, ignoring any prerelease or build suffix. */
export function parseVersion(
  version: string,
): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return 0;
}

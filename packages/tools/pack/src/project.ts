import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

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
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly scripts?: Record<string, string>;
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

/** The manifest of a package as the game resolves it, or `undefined`. */
export function resolvePackage(
  root: string,
  name: string,
): { readonly dir: string; readonly manifest: GameManifest } | undefined {
  const require = createRequire(path.join(root, "package.json"));
  let file: string;
  try {
    file = require.resolve(`${name}/package.json`);
  } catch {
    // A package whose `exports` hides its manifest is still found by walking
    // the node_modules chain, which is where every install puts it.
    const walked = walkToPackage(root, name);
    if (walked === undefined) return undefined;
    file = walked;
  }
  return {
    dir: path.dirname(file),
    manifest: JSON.parse(readFileSync(file, "utf8")) as GameManifest,
  };
}

/** The installed version of a package, or `null` when it is not installed. */
export function installedVersion(root: string, name: string): string | null {
  const found = resolvePackage(root, name);
  const version = found?.manifest.version;
  return typeof version === "string" ? version : null;
}

function walkToPackage(root: string, name: string): string | undefined {
  let dir = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
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

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { hashDirectory, type HashedFile } from "./hash.js";
import { gradleSetting, nativePaths, xcodeSetting } from "./native.js";
import {
  installedVersion,
  nodeModulesChain,
  readIdentity,
  WEB_DIRS,
} from "./project.js";
import { run as defaultRun, javaBinary, type RunResult } from "./run.js";
import type { Target } from "./types.js";

/** What a build produced, by the shape the target's tools give it. */
export type ArtifactKind =
  | "electron-app"
  | "electron-zip"
  | "electron-maker-file"
  | "ios-simulator-app"
  | "ios-app"
  | "ios-archive"
  | "ios-ipa"
  | "android-apk"
  | "android-aab";

/** One file or bundle a build produced. */
export interface BuildArtifact {
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly isDirectory: boolean;
  readonly bytes: number;
  readonly sha256: string;
  readonly signed: "signed" | "ad-hoc" | "unsigned" | "unknown";
}

/** Everything that went into one build, written beside its artifacts. */
export interface BuildRecord {
  readonly schema: 1;
  readonly createdAt: string;
  readonly target: Target;
  readonly profile: "development" | "release";
  readonly app: {
    readonly appId: string;
    readonly name: string;
    readonly version: string;
    readonly build: string | null;
  };
  readonly source: {
    readonly commit: string | null;
    readonly dirty: readonly string[] | null;
  };
  readonly packages: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly hostBridgeProtocol: number | null;
  readonly toolchain: {
    readonly node: string;
    readonly os: string;
    readonly osVersion: string;
    readonly arch: string;
    readonly xcode: string | null;
    readonly java: string | null;
  };
  readonly web: {
    readonly dir: string;
    readonly files: readonly HashedFile[];
    readonly digest: string;
  };
  readonly artifacts: readonly BuildArtifact[];
}

/** Third-party packages whose resolved version a record names. */
const RECORDED_DEPENDENCIES = [
  "pixi.js",
  "@pixi/sound",
  "@dimforge/rapier2d",
  "yoga-layout",
  "electron",
  "@electron-forge/cli",
  "@capacitor/cli",
  "@capacitor/core",
  "@capacitor/ios",
  "@capacitor/android",
  "@capacitor/app",
  "@capacitor/filesystem",
  "@capacitor/screen-orientation",
] as const;

export interface BuildRecordOptions {
  /** The game's root. */
  readonly root: string;
  readonly target: Target;
  readonly profile: "development" | "release";
  /** Paths of the artifacts the build produced. */
  readonly artifacts: readonly string[];
  readonly run?: (command: string, args: readonly string[]) => RunResult;
}

/** Collect what went into a build, without writing anything. */
export async function buildRecord(
  options: BuildRecordOptions,
): Promise<BuildRecord> {
  const root = path.resolve(options.root);
  const target = options.target;
  const run = options.run ?? ((c, a) => defaultRun(c, a, { cwd: root }));
  const identity = readIdentity(root, "record");
  const webDir = target === "electron" ? WEB_DIRS.electron : WEB_DIRS.capacitor;
  const web = await hashDirectory(path.join(root, webDir));

  const artifacts: BuildArtifact[] = [];
  for (const artifact of options.artifacts) {
    artifacts.push(await describeArtifact(artifact, target, run));
  }

  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    target,
    profile: options.profile,
    app: {
      ...identity,
      build: readBuildNumber(root, target, options.profile),
    },
    source: readSource(run),
    packages: readYagePackages(root),
    dependencies: readDependencies(root),
    hostBridgeProtocol: readBridgeProtocol(root, target),
    toolchain: readToolchain(target, run),
    web: { dir: webDir, files: web.files, digest: web.digest },
    artifacts,
  };
}

/**
 * Write a build record as JSON. An existing file is replaced only when it is
 * a record of its own: a path naming something else is refused, so a mistyped
 * output cannot overwrite a file the build needs.
 */
export async function writeBuildRecord(
  options: BuildRecordOptions & { readonly out: string },
): Promise<{ readonly record: BuildRecord; readonly file: string }> {
  const file = path.resolve(options.out);
  if (!file.endsWith(".json")) {
    throw new Error(`record: --out must end in .json, got ${options.out}.`);
  }
  if (existsSync(file)) {
    let existing: unknown;
    try {
      existing = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      existing = undefined;
    }
    const shaped =
      typeof existing === "object" &&
      existing !== null &&
      (existing as { schema?: unknown }).schema === 1 &&
      typeof (existing as { target?: unknown }).target === "string";
    if (!shaped) {
      throw new Error(
        `record: ${file} exists and is not a build record. Choose another --out.`,
      );
    }
  }
  const record = await buildRecord(options);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { record, file };
}

/** The artifact kinds a target can produce, as an error message lists them. */
function expectedKinds(target: Target): string {
  if (target === "electron") {
    return "a packaged app directory or a file an Electron Forge maker wrote";
  }
  if (target === "ios") return "an .app, .xcarchive or .ipa";
  return "an .apk or .aab";
}

async function describeArtifact(
  artifact: string,
  target: Target,
  run: (command: string, args: readonly string[]) => RunResult,
): Promise<BuildArtifact> {
  const file = path.resolve(artifact);
  const kind = artifactKind(file, target);
  const resolved = kind === "electron-app" ? electronAppPath(file) : file;
  const isDirectory = statSync(resolved).isDirectory();
  let bytes: number;
  let sha256: string;
  if (isDirectory) {
    const hashed = await hashDirectory(resolved);
    bytes = hashed.files.reduce((sum, entry) => sum + entry.bytes, 0);
    sha256 = hashed.digest;
  } else {
    const contents = readFileSync(resolved);
    bytes = contents.byteLength;
    sha256 = createHash("sha256").update(contents).digest("hex");
  }
  return {
    path: resolved,
    kind,
    isDirectory,
    bytes,
    sha256,
    signed: readSignature(resolved, kind, run),
  };
}

function artifactKind(file: string, target: Target): ArtifactKind {
  const extension = path.extname(file).toLowerCase();
  if (target === "electron") {
    if (isExistingDirectory(electronAppPath(file))) return "electron-app";
    // A maker writes files of its own kinds: installers, archives, and the
    // update metadata next to them (RELEASES, RELEASES.json, .nupkg).
    if (existsSync(file) && statSync(file).isFile()) {
      return extension === ".zip" ? "electron-zip" : "electron-maker-file";
    }
  }
  if (target === "ios") {
    if (extension === ".xcarchive") return "ios-archive";
    if (extension === ".ipa") return "ios-ipa";
    if (extension === ".app") {
      // A simulator build sets its platform name, iphonesimulator, in the
      // bundle's Info.plist. XML and binary plists both store that ASCII
      // string as plain bytes, so a byte search finds it without a parser.
      const plist = path.join(file, "Info.plist");
      const simulator =
        existsSync(plist) &&
        readFileSync(plist, "latin1").includes("iphonesimulator");
      return simulator ? "ios-simulator-app" : "ios-app";
    }
  }
  if (target === "android") {
    if (extension === ".apk") return "android-apk";
    if (extension === ".aab") return "android-aab";
  }
  throw new Error(
    `record: cannot tell what ${file} is for ${target}. Expected ${expectedKinds(target)}.`,
  );
}

/** The `.app` inside a Forge output directory, or the directory itself. */
function electronAppPath(file: string): string {
  if (path.extname(file) === ".app" || !isExistingDirectory(file)) return file;
  const app = readdirSync(file).find((entry) => entry.endsWith(".app"));
  if (app !== undefined) return path.join(file, app);
  return file;
}

function isExistingDirectory(file: string): boolean {
  return existsSync(file) && statSync(file).isDirectory();
}

function readSignature(
  file: string,
  kind: ArtifactKind,
  run: (command: string, args: readonly string[]) => RunResult,
): BuildArtifact["signed"] {
  const signable =
    process.platform === "darwin" &&
    (path.extname(file) === ".app" || kind === "ios-archive");
  if (!signable) return "unknown";
  const result = run("codesign", ["-dv", file]);
  const output = `${result.stdout}${result.stderr}`;
  if (output.includes("not signed at all")) return "unsigned";
  if (/Signature\s*=\s*adhoc/.test(output)) return "ad-hoc";
  if (/\bAuthority=/.test(output)) return "signed";
  return "unknown";
}

function readBuildNumber(
  root: string,
  target: Target,
  profile: BuildRecord["profile"],
): string | null {
  if (target === "ios") {
    const setting = xcodeSetting(
      nativePaths(root, "ios").project,
      profile === "release" ? "Release" : "Debug",
      "CURRENT_PROJECT_VERSION",
    );
    return "value" in setting ? setting.value : null;
  }
  if (target === "android") {
    return (
      gradleSetting(nativePaths(root, "android").project, "versionCode") ?? null
    );
  }
  return null;
}

function readSource(
  run: (command: string, args: readonly string[]) => RunResult,
): BuildRecord["source"] {
  const head = run("git", ["rev-parse", "HEAD"]);
  if (head.status !== 0) return { commit: null, dirty: null };
  const status = run("git", ["status", "--porcelain"]);
  const dirty =
    status.status === 0
      ? status.stdout.split("\n").filter((line) => line.trim().length > 0)
      : null;
  return { commit: head.stdout.trim(), dirty };
}

/** Every YAGE package the game resolves; the nearest copy of each wins. */
function readYagePackages(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const modules of nodeModulesChain(root)) {
    for (const scope of ["@yagejs", "@yagejs-tools", "@yagejs-addons"]) {
      const dir = path.join(modules, scope);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const manifest = path.join(dir, name, "package.json");
        if (found[`${scope}/${name}`] !== undefined || !existsSync(manifest)) {
          continue;
        }
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
          version?: string;
        };
        if (parsed.version !== undefined)
          found[`${scope}/${name}`] = parsed.version;
      }
    }
  }
  return found;
}

function readDependencies(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of RECORDED_DEPENDENCIES) {
    const version = installedVersion(root, name);
    if (version !== null) found[name] = version;
  }
  return found;
}

/**
 * The bridge protocol the game's own Electron host package speaks. The shell
 * and the page load the same installed copy, so one number stands for both.
 */
function readBridgeProtocol(root: string, target: Target): number | null {
  if (target !== "electron") return null;
  try {
    const require = createRequire(path.join(root, "package.json"));
    const loaded = require("@yagejs/host-electron") as {
      HOST_BRIDGE_PROTOCOL?: unknown;
    };
    return typeof loaded.HOST_BRIDGE_PROTOCOL === "number"
      ? loaded.HOST_BRIDGE_PROTOCOL
      : null;
  } catch {
    return null;
  }
}

function readToolchain(
  target: Target,
  run: (command: string, args: readonly string[]) => RunResult,
): BuildRecord["toolchain"] {
  const xcode =
    target === "ios" ? firstLine(run("xcodebuild", ["-version"])) : null;
  const java =
    target === "android"
      ? firstLine(run(javaBinary(process.env), ["-version"]))
      : null;
  const version =
    process.platform === "darwin"
      ? (firstLine(run("sw_vers", ["-productVersion"])) ?? os.release())
      : os.release();
  return {
    node: process.version,
    os: process.platform,
    osVersion: version,
    arch: process.arch,
    xcode,
    java,
  };
}

function firstLine(result: RunResult): string | null {
  if (result.status !== 0) return null;
  const text = `${result.stdout}${result.stderr}`.trim();
  return text.length === 0 ? null : (text.split("\n")[0] as string).trim();
}

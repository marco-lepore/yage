import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  atLeast,
  inGameModules,
  installedVersion,
  loadedCopies,
  parseVersion,
  productionClosure,
  readManifest,
  resolvePackage,
  satisfiesCaret,
  WORKSPACE_GUIDE,
} from "./project.js";
import { run as defaultRun, javaBinary, type RunResult } from "./run.js";
import {
  HOST_PACKAGE,
  REQUIRED_PACKAGES,
  TARGETS,
  type CheckReport,
  type CheckResult,
  type Target,
} from "./types.js";

/** The Node version each target's build tools require. */
const NODE_FLOOR: Readonly<Record<Target, string>> = {
  electron: "22.13.0",
  ios: "22.12.0",
  android: "22.12.0",
};

/** The Pixi version every engine package is built against. */
const PIXI_FLOOR = "8.22.0";

/** The Xcode version the generated iOS project's Swift package needs. */
const XCODE_FLOOR = "15.0.0";

/** The Java version the generated Android project compiles with. */
const JAVA_FLOOR = 21;

/** The Android platform the generated project compiles against. */
const DEFAULT_COMPILE_SDK = "36";

export interface DoctorOptions {
  /** The game's root. */
  readonly root: string;
  /** Targets to check; every installed target when left out. */
  readonly targets?: readonly Target[];
  readonly run?: (command: string, args: readonly string[]) => RunResult;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly nodeVersion?: string;
}

/**
 * Check that this machine can build each target. Nothing is installed and no
 * global tool selection changes: every failure names the command or setting
 * that fixes it.
 */
export async function runDoctor(
  options: DoctorOptions,
): Promise<CheckReport[]> {
  const root = path.resolve(options.root);
  const env = options.env ?? process.env;
  const run = options.run ?? ((c, a) => defaultRun(c, a, { cwd: root, env }));
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.version;
  const targets = options.targets ?? installedTargets(root);
  if (targets.length === 0) {
    throw new Error(
      "yage-pack doctor: no target to check. Install @yagejs/host-electron " +
        "or @yagejs/host-capacitor, or pass --target.",
    );
  }
  return targets.map((target) => {
    const results: CheckResult[] = [
      nodeRule(target, nodeVersion),
      packagesRule(root, target),
      hostDependencyRule(root, target),
      peerRule(root, target),
      pixiRule(root),
    ];
    // Without the host package, `packages` already names what to install.
    if (
      target === "electron" &&
      installedVersion(root, HOST_PACKAGE.electron) !== null
    ) {
      results.push(gameFolderRule(root));
    }
    if (target === "ios") {
      const xcode = xcodeRule(env, run);
      results.push(macOsRule(platform), xcode);
      // Both run through the selected developer directory, so with the
      // command-line tools selected they would fail with fixes that do not
      // apply.
      if (xcode.ok) results.push(firstLaunchRule(run), simulatorRule(run));
    }
    if (target === "android") {
      results.push(jdkRule(env, run), androidSdkRule(root, env));
    }
    return {
      command: "doctor" as const,
      target,
      ok: results.every((result) => result.ok),
      results,
    };
  });
}

/** Targets whose host package and platform package the game has installed. */
function installedTargets(root: string): Target[] {
  return TARGETS.filter((target) => {
    if (installedVersion(root, HOST_PACKAGE[target]) === null) return false;
    if (target === "ios")
      return installedVersion(root, "@capacitor/ios") !== null;
    if (target === "android")
      return installedVersion(root, "@capacitor/android") !== null;
    return true;
  });
}

function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail, fix: null };
}

function fail(name: string, detail: string, fix: string): CheckResult {
  return { name, ok: false, detail, fix };
}

function nodeRule(target: Target, version: string): CheckResult {
  const floor = NODE_FLOOR[target];
  return atLeast(version, floor)
    ? pass("node", `Node ${version}.`)
    : fail(
        "node",
        `Node ${version} is below ${floor}.`,
        `Install Node.js ${floor} or later and run the command again.`,
      );
}

function packagesRule(root: string, target: Target): CheckResult {
  const required = REQUIRED_PACKAGES[target];
  const missing = {
    dependencies: required.dependencies.filter(
      (name) => installedVersion(root, name) === null,
    ),
    devDependencies: required.devDependencies.filter(
      (name) => installedVersion(root, name) === null,
    ),
  };
  const count = missing.dependencies.length + missing.devDependencies.length;
  if (count === 0) {
    return pass(
      "packages",
      `Every package a ${target} build needs is installed.`,
    );
  }
  const lines = [
    missing.dependencies.length > 0
      ? `npm install ${missing.dependencies.join(" ")}`
      : null,
    missing.devDependencies.length > 0
      ? `npm install --save-dev ${missing.devDependencies.join(" ")}`
      : null,
  ].filter((line): line is string => line !== null);
  return fail(
    "packages",
    `${count} package${count === 1 ? " is" : "s are"} missing: ${[
      ...missing.dependencies,
      ...missing.devDependencies,
    ].join(", ")}.`,
    lines.join("\n"),
  );
}

function hostDependencyRule(root: string, target: Target): CheckResult {
  const name = HOST_PACKAGE[target];
  const manifest = readManifest(root);
  if (manifest?.dependencies?.[name] !== undefined) {
    return pass("host package in dependencies", `${name} is a dependency.`);
  }
  return fail(
    "host package in dependencies",
    `${name} is not in "dependencies".`,
    manifest?.devDependencies?.[name] !== undefined
      ? `Move ${name} from devDependencies to dependencies: the packaged app loads it at run time.`
      : `Add ${name} to dependencies: npm install ${name}`,
  );
}

function peerRule(root: string, target: Target): CheckResult {
  const host = resolvePackage(root, HOST_PACKAGE[target]);
  if (host === undefined) {
    return fail(
      "peer versions",
      `${HOST_PACKAGE[target]} is not installed.`,
      `npm install ${HOST_PACKAGE[target]}`,
    );
  }
  const manifest = readManifest(root);
  const peers = host.manifest.peerDependencies ?? {};
  const problems: string[] = [];
  const fixes: string[] = [];
  for (const [name, range] of Object.entries(peers)) {
    const version = installedVersion(root, name);
    if (version === null || !satisfiesCaret(version, range)) {
      problems.push(`${name} ${version ?? "is not installed"}`);
      fixes.push(`npm install ${name}@${range}`);
      continue;
    }
    if (
      name.startsWith("@capacitor/") &&
      manifest?.dependencies?.[name] === undefined
    ) {
      problems.push(`${name} is not listed in dependencies`);
      fixes.push(
        `Add ${name} to dependencies in package.json: npx cap sync installs native code only for plugins the app lists.`,
      );
    }
  }
  return problems.length === 0
    ? pass(
        "peer versions",
        `Every package ${HOST_PACKAGE[target]} needs is at a version it accepts.`,
      )
    : fail("peer versions", `${problems.join("; ")}.`, fixes.join("\n"));
}

/**
 * An Electron package carries the game's folder and nothing above it, so the
 * packages the shell loads have to be installed inside it. In an npm
 * workspace, npm installs them at the workspace root.
 */
function gameFolderRule(root: string): CheckResult {
  const name = "packages in the game's folder";
  const outside = productionClosure(root, [HOST_PACKAGE.electron]).filter(
    (entry) => entry.dir !== undefined && !inGameModules(root, entry.dir),
  );
  if (outside.length === 0) {
    return pass(
      name,
      `${HOST_PACKAGE.electron} and the packages it loads are in the game's node_modules.`,
    );
  }
  return fail(
    name,
    `${outside
      .map((entry) => `${entry.name} (${String(entry.dir)})`)
      .join(", ")} ${outside.length === 1 ? "is" : "are"} installed outside ` +
      "the game's node_modules, and an Electron package carries only the packages in the game's own node_modules.",
    `Install ${outside.length === 1 ? "it" : "them"} in the game's own node_modules. ` +
      `The packaging guide lists the ways to do that in an npm workspace and what each one changes: ${WORKSPACE_GUIDE}`,
  );
}

/**
 * Two copies of pixi.js fail each other's class checks, so the game and every
 * `@yagejs/*` package it loads have to resolve the same one. A copy that none
 * of them resolves does not count.
 */
function pixiRule(root: string): CheckResult {
  const copies = loadedCopies(root, "pixi.js");
  const [only] = copies;
  if (only === undefined) {
    return fail(
      "pixi.js",
      "pixi.js is not installed.",
      `npm install pixi.js@^${PIXI_FLOOR}`,
    );
  }
  if (copies.length > 1) {
    return fail(
      "pixi.js",
      `The game loads ${copies.length} copies of pixi.js: ${copies
        .map(
          (copy) =>
            `${copy.version} at ${copy.dir}, loaded by ${copy.loadedBy.join(", ")}`,
        )
        .join("; ")}.`,
      "Leave one copy that the game and every @yagejs package resolve: two copies of " +
        "pixi.js fail each other's class checks. npm ls pixi.js shows which package " +
        `installed each copy. For a game in an npm workspace, see ${WORKSPACE_GUIDE}`,
    );
  }
  return atLeast(only.version, PIXI_FLOOR)
    ? pass("pixi.js", `One copy of pixi.js, ${only.version}.`)
    : fail(
        "pixi.js",
        `pixi.js ${only.version} is below ${PIXI_FLOOR}.`,
        `npm install pixi.js@^${PIXI_FLOOR}`,
      );
}

function macOsRule(platform: NodeJS.Platform): CheckResult {
  return platform === "darwin"
    ? pass("macOS", "This machine runs macOS.")
    : fail(
        "macOS",
        `This machine runs ${platform}.`,
        "iOS builds need a Mac with Xcode.",
      );
}

const XCODE_DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

function xcodeRule(
  env: NodeJS.ProcessEnv,
  run: (command: string, args: readonly string[]) => RunResult,
): CheckResult {
  const selected =
    env.DEVELOPER_DIR ?? run("xcode-select", ["-p"]).stdout.trim();
  const suffix = path.join(".app", "Contents", "Developer");
  if (!selected.endsWith(suffix)) {
    const suggestion = existsSync(XCODE_DEVELOPER_DIR)
      ? `Run the command with DEVELOPER_DIR=${XCODE_DEVELOPER_DIR}, or select Xcode with sudo xcode-select -s ${XCODE_DEVELOPER_DIR}.`
      : "Install Xcode from the App Store.";
    return fail(
      "Xcode",
      `The selected developer directory is ${selected || "unset"}.`,
      `xcode-select points to ${selected || "nothing"}, the command-line tools. ${suggestion}`,
    );
  }
  const version = run("xcodebuild", ["-version"]);
  // Xcode reports two parts when its patch number is zero.
  const printed = /Xcode\s+([\d.]+)/.exec(version.stdout)?.[1] ?? "";
  const reported = parseVersion(
    printed.split(".").length < 3 ? `${printed}.0` : printed,
  );
  if (version.status !== 0 || reported === undefined) {
    return fail(
      "Xcode",
      "xcodebuild did not report a version.",
      `Install Xcode from the App Store, then run sudo xcode-select -s ${XCODE_DEVELOPER_DIR}.`,
    );
  }
  const found = reported.join(".");
  return atLeast(found, XCODE_FLOOR)
    ? pass("Xcode", `Xcode ${found} at ${selected}.`)
    : fail(
        "Xcode",
        `Xcode ${found} is below ${XCODE_FLOOR}.`,
        `Update Xcode to ${XCODE_FLOOR} or later in the App Store.`,
      );
}

function firstLaunchRule(
  run: (command: string, args: readonly string[]) => RunResult,
): CheckResult {
  const result = run("xcodebuild", ["-checkFirstLaunchStatus"]);
  return result.status === 0
    ? pass("Xcode first launch", "Xcode's first-launch tasks are done.")
    : fail(
        "Xcode first launch",
        "Xcode has first-launch tasks left.",
        "sudo xcodebuild -runFirstLaunch",
      );
}

function simulatorRule(
  run: (command: string, args: readonly string[]) => RunResult,
): CheckResult {
  const result = run("xcrun", ["simctl", "list", "runtimes", "--json"]);
  let runtimes: { name?: string; isAvailable?: boolean }[] = [];
  if (result.status === 0) {
    try {
      runtimes =
        (JSON.parse(result.stdout) as { runtimes?: typeof runtimes })
          .runtimes ?? [];
    } catch {
      runtimes = [];
    }
  }
  const available = runtimes.filter(
    (runtime) => runtime.isAvailable === true && /iOS/.test(runtime.name ?? ""),
  );
  return available.length > 0
    ? pass(
        "iOS simulator",
        `${available.length} available iOS runtime${available.length === 1 ? "" : "s"}.`,
      )
    : fail(
        "iOS simulator",
        "No available iOS simulator runtime.",
        "Install an iOS simulator runtime in Xcode > Settings > Components.",
      );
}

function jdkRule(
  env: NodeJS.ProcessEnv,
  run: (command: string, args: readonly string[]) => RunResult,
): CheckResult {
  const binary = javaBinary(env);
  const missing = fail(
    "JDK",
    "No Java runtime answered.",
    "Install JDK 21 (Android Studio ships one) and set JAVA_HOME to it.",
  );
  const result = run(binary, ["-version"]);
  if (result.status !== 0) return missing;
  const reported = /version "?(\d+)/.exec(`${result.stderr}${result.stdout}`);
  const major = reported === null ? 0 : Number(reported[1]);
  return major >= JAVA_FLOOR
    ? pass("JDK", `Java ${major} at ${binary}.`)
    : fail(
        "JDK",
        `Java ${major === 0 ? "reported no version" : major} is below ${JAVA_FLOOR}.`,
        "Install JDK 21 (Android Studio ships one) and set JAVA_HOME to it.",
      );
}

function androidSdkRule(root: string, env: NodeJS.ProcessEnv): CheckResult {
  const compileSdk = readCompileSdk(root);
  const fixText = `Install the Android SDK with the platform for API ${compileSdk} in Android Studio > SDK Manager, and set ANDROID_HOME to its directory.`;
  const home = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (home === undefined || !existsSync(home)) {
    return fail(
      "Android SDK",
      home === undefined
        ? "Neither ANDROID_HOME nor ANDROID_SDK_ROOT is set."
        : `${home} is not a directory.`,
      fixText,
    );
  }
  const platform = path.join(home, "platforms", `android-${compileSdk}`);
  const buildTools = path.join(home, "build-tools");
  const tools = existsSync(buildTools)
    ? readdirSync(buildTools).filter((entry) => entry.length > 0)
    : [];
  if (!existsSync(platform) || tools.length === 0) {
    return fail(
      "Android SDK",
      !existsSync(platform)
        ? `${home} has no platforms/android-${compileSdk}.`
        : `${home} has no build tools.`,
      fixText,
    );
  }
  return pass(
    "Android SDK",
    `Android ${compileSdk} and build tools in ${home}.`,
  );
}

/** The platform the generated project compiles against, when it exists. */
function readCompileSdk(root: string): string {
  const variables = path.join(root, "android", "variables.gradle");
  if (!existsSync(variables)) return DEFAULT_COMPILE_SDK;
  const match = /compileSdkVersion\s*=\s*(\d+)/.exec(
    readFileSync(variables, "utf8"),
  );
  return match?.[1] ?? DEFAULT_COMPILE_SDK;
}

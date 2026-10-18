import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  atLeast,
  installedVersion,
  parseVersion,
  readManifest,
  resolvePackage,
  satisfiesCaret,
} from "./project.js";
import { run as defaultRun, type RunResult } from "./run.js";
import {
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

/** The host package each target's game entry imports. */
const HOST_PACKAGE: Readonly<Record<Target, string>> = {
  electron: "@yagejs/host-electron",
  ios: "@yagejs/host-capacitor",
  android: "@yagejs/host-capacitor",
};

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
    if (target === "ios") {
      results.push(
        macOsRule(platform),
        xcodeRule(env, run),
        firstLaunchRule(run),
        simulatorRule(run),
      );
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
  const listed = manifest?.dependencies?.[name] !== undefined;
  return listed
    ? pass("host package in dependencies", `${name} is a dependency.`)
    : fail(
        "host package in dependencies",
        `${name} is not in "dependencies".`,
        `Move ${name} from devDependencies to dependencies: the packaged app loads it at run time.`,
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

function pixiRule(root: string): CheckResult {
  const copies = findPixiCopies(path.join(root, "node_modules"), 0);
  if (copies.length === 0) {
    return fail(
      "pixi.js",
      "pixi.js is not installed.",
      `npm install pixi.js@^${PIXI_FLOOR}`,
    );
  }
  const extra = copies.slice(1);
  if (extra.length > 0) {
    return fail(
      "pixi.js",
      `${copies.length} copies of pixi.js are installed.`,
      extra
        .map(
          (copy) =>
            `Remove the second copy at ${copy.dir}: two copies of pixi.js fail each other's class checks.`,
        )
        .join("\n"),
    );
  }
  const only = copies[0] as PixiCopy;
  return atLeast(only.version, PIXI_FLOOR)
    ? pass("pixi.js", `One copy of pixi.js, ${only.version}.`)
    : fail(
        "pixi.js",
        `pixi.js ${only.version} is below ${PIXI_FLOOR}.`,
        `npm install pixi.js@^${PIXI_FLOOR}`,
      );
}

interface PixiCopy {
  readonly dir: string;
  readonly version: string;
}

/** Every installed `pixi.js`, including the nested copies npm leaves behind. */
function findPixiCopies(modules: string, depth: number): PixiCopy[] {
  if (depth > 6 || !existsSync(modules)) return [];
  const found: PixiCopy[] = [];
  const own = path.join(modules, "pixi.js", "package.json");
  if (existsSync(own)) {
    const parsed = JSON.parse(readFileSync(own, "utf8")) as {
      version?: string;
    };
    found.push({
      dir: path.dirname(own),
      version: parsed.version ?? "unknown",
    });
  }
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "pixi.js") continue;
    const inner = entry.name.startsWith("@")
      ? readdirSync(path.join(modules, entry.name), { withFileTypes: true })
          .filter((scoped) => scoped.isDirectory())
          .map((scoped) => path.join(modules, entry.name, scoped.name))
      : [path.join(modules, entry.name)];
    for (const dir of inner) {
      found.push(...findPixiCopies(path.join(dir, "node_modules"), depth + 1));
    }
  }
  return found;
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
  const binary =
    env.JAVA_HOME === undefined
      ? "java"
      : path.join(env.JAVA_HOME, "bin", "java");
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

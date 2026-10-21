import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "./doctor.js";
import type { RunResult } from "./run.js";
import { addFile, installed, makeTree, removeTrees } from "./test/tree.js";
import { REQUIRED_PACKAGES, type CheckReport, type Target } from "./types.js";

const XCODE_DIR = "/Applications/Xcode.app/Contents/Developer";

/** A fake command table: anything not listed answers as a missing tool. */
function fakeRun(
  table: Record<string, Partial<RunResult>>,
): (command: string, args: readonly string[]) => RunResult {
  return (command, args) => {
    const key = [command, ...args].join(" ");
    const match =
      table[key] ?? table[command] ?? ({ status: null } as Partial<RunResult>);
    return { status: null, stdout: "", stderr: "", ...match };
  };
}

const workingTools = {
  "xcode-select -p": { status: 0, stdout: `${XCODE_DIR}\n` },
  "xcodebuild -version": {
    status: 0,
    stdout: "Xcode 26.2\nBuild version 17C52\n",
  },
  "xcodebuild -checkFirstLaunchStatus": { status: 0 },
  "xcrun simctl list runtimes --json": {
    status: 0,
    stdout: JSON.stringify({
      runtimes: [{ name: "iOS 26.3", isAvailable: true }],
    }),
  },
  java: { status: 0, stderr: 'openjdk version "21.0.4" 2024-07-16\n' },
};

/** A game with everything one target needs installed. */
function healthyGame(target: Target): string {
  const required = REQUIRED_PACKAGES[target];
  const manifest = {
    name: "game",
    productName: "My Game",
    version: "1.0.0",
    yage: { appId: "com.example.mygame" },
    dependencies: Object.fromEntries(
      required.dependencies.map((name) => [name, "*"]),
    ),
    devDependencies: Object.fromEntries(
      required.devDependencies.map((name) => [name, "*"]),
    ),
  };
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(manifest)}\n`,
    ...installed("pixi.js", { version: "8.22.0" }),
    ...installed("@yagejs/host-electron", {
      version: "0.12.0",
      peerDependencies: { electron: "^44.7.0" },
    }),
    ...installed("@yagejs/host-capacitor", {
      version: "0.12.0",
      peerDependencies: {
        "@capacitor/app": "^8.1.2",
        "@capacitor/core": "^8.5.3",
        "@capacitor/filesystem": "^8.1.4",
        "@capacitor/screen-orientation": "^8.0.2",
      },
    }),
    ...installed("electron", { version: "44.7.0" }),
    ...installed("@capacitor/core", { version: "8.5.3" }),
    ...installed("@capacitor/app", { version: "8.1.2" }),
    ...installed("@capacitor/filesystem", { version: "8.1.4" }),
    ...installed("@capacitor/screen-orientation", { version: "8.0.2" }),
  };
  for (const name of [...required.dependencies, ...required.devDependencies]) {
    if (files[`node_modules/${name}/package.json`] === undefined) {
      Object.assign(files, installed(name));
    }
  }
  return makeTree(files);
}

async function report(
  root: string,
  target: Target,
  overrides: Partial<Parameters<typeof runDoctor>[0]> = {},
): Promise<CheckReport> {
  const reports = await runDoctor({
    root,
    targets: [target],
    run: fakeRun(workingTools),
    env: { DEVELOPER_DIR: XCODE_DIR, JAVA_HOME: undefined },
    platform: "darwin",
    nodeVersion: "v24.15.0",
    ...overrides,
  });
  return reports[0] as CheckReport;
}

function rule(found: CheckReport, name: string) {
  const result = found.results.find((entry) => entry.name === name);
  if (result === undefined) throw new Error(`no ${name} rule in the report`);
  return result;
}

afterEach(() => {
  removeTrees();
});

describe("runDoctor", () => {
  it("passes every Electron rule for a complete install", async () => {
    const found = await report(healthyGame("electron"), "electron");
    expect(found.results.filter((result) => !result.ok)).toEqual([]);
    expect(found.ok).toBe(true);
  });

  it("names the Node version each target's tools require", async () => {
    const found = await report(healthyGame("electron"), "electron", {
      nodeVersion: "v22.12.0",
    });
    expect(rule(found, "node").fix).toBe(
      "Install Node.js 22.13.0 or later and run the command again.",
    );
  });

  it("lists the missing packages by the section they belong in", async () => {
    const root = makeTree({
      "package.json": JSON.stringify({ name: "game" }),
    });
    const found = await report(root, "electron");
    expect(rule(found, "packages").fix).toBe(
      "npm install @yagejs/host-electron\n" +
        "npm install --save-dev electron @electron-forge/cli @electron-forge/maker-zip " +
        "@electron-forge/plugin-fuses @electron/fuses @yagejs-tools/pack",
    );
  });

  it("asks for the host package to be a runtime dependency", async () => {
    const root = healthyGame("electron");
    addFile(
      root,
      "package.json",
      JSON.stringify({
        name: "game",
        devDependencies: { "@yagejs/host-electron": "*" },
      }),
    );
    const found = await report(root, "electron");
    expect(rule(found, "host package in dependencies").fix).toBe(
      "Move @yagejs/host-electron from devDependencies to dependencies: the packaged app loads it at run time.",
    );
  });

  it("asks for the host package to be added when no section lists it", async () => {
    const root = healthyGame("electron");
    addFile(root, "package.json", JSON.stringify({ name: "game" }));
    const found = await report(root, "electron");
    expect(rule(found, "host package in dependencies").fix).toBe(
      "Add @yagejs/host-electron to dependencies: npm install @yagejs/host-electron",
    );
  });

  it("names the version a peer has to be at", async () => {
    const root = healthyGame("electron");
    addFile(
      root,
      "node_modules/electron/package.json",
      JSON.stringify({ name: "electron", version: "43.0.0" }),
    );
    const found = await report(root, "electron");
    expect(rule(found, "peer versions").fix).toBe(
      "npm install electron@^44.7.0",
    );
  });

  it("asks for a Capacitor plugin the app does not list", async () => {
    const root = healthyGame("ios");
    const manifest = JSON.parse(
      readFileSync(`${root}/package.json`, "utf8"),
    ) as { dependencies: Record<string, string> };
    delete manifest.dependencies["@capacitor/app"];
    addFile(root, "package.json", JSON.stringify(manifest));
    const found = await report(root, "ios");
    expect(rule(found, "peer versions").fix).toBe(
      "Add @capacitor/app to dependencies in package.json: npx cap sync installs native code only for plugins the app lists.",
    );
  });

  it("names the second copy of pixi.js", async () => {
    const root = healthyGame("electron");
    addFile(
      root,
      "node_modules/some-addon/package.json",
      JSON.stringify({ name: "some-addon", version: "1.0.0" }),
    );
    addFile(
      root,
      "node_modules/some-addon/node_modules/pixi.js/package.json",
      JSON.stringify({ name: "pixi.js", version: "8.21.0" }),
    );
    const found = await report(root, "electron");
    expect(rule(found, "pixi.js").fix).toContain(
      "node_modules/some-addon/node_modules/pixi.js",
    );
    expect(rule(found, "pixi.js").fix).toContain(
      "two copies of pixi.js fail each other's class checks.",
    );
  });

  it("asks for a Pixi version the engine packages are built against", async () => {
    const root = healthyGame("electron");
    addFile(
      root,
      "node_modules/pixi.js/package.json",
      JSON.stringify({ name: "pixi.js", version: "8.21.0" }),
    );
    const found = await report(root, "electron");
    expect(rule(found, "pixi.js").fix).toBe("npm install pixi.js@^8.22.0");
  });

  it("reads a workspace member's packages up to the workspace root", async () => {
    const workspace = makeTree({
      "package.json": JSON.stringify({ private: true, workspaces: ["game"] }),
      "game/package.json": JSON.stringify({ name: "my-game" }),
      ...installed("pixi.js", { version: "8.22.0" }),
    });
    const root = path.join(workspace, "game");
    expect(rule(await report(root, "electron"), "pixi.js").fix).toBe(
      "npm install pixi.js@^8.22.0",
    );
    // npm links each workspace member into the workspace root's node_modules.
    symlinkSync(root, path.join(workspace, "node_modules", "my-game"));
    expect(rule(await report(root, "electron"), "pixi.js").detail).toBe(
      "One copy of pixi.js, 8.22.0.",
    );
  });

  it("counts a workspace member's own copy of pixi.js once", async () => {
    const workspace = makeTree({
      "package.json": JSON.stringify({ private: true, workspaces: ["game"] }),
      "game/package.json": JSON.stringify({ name: "my-game" }),
      "game/node_modules/pixi.js/package.json": JSON.stringify({
        name: "pixi.js",
        version: "8.22.0",
      }),
    });
    const root = path.join(workspace, "game");
    mkdirSync(path.join(workspace, "node_modules"));
    symlinkSync(root, path.join(workspace, "node_modules", "my-game"));
    expect(rule(await report(root, "electron"), "pixi.js").ok).toBe(true);
  });

  it("names the packages an Electron package cannot carry from a workspace root", async () => {
    const workspace = makeTree({
      "package.json": JSON.stringify({ private: true, workspaces: ["game"] }),
      "game/package.json": JSON.stringify({
        name: "my-game",
        dependencies: { "@yagejs/host-electron": "*" },
      }),
      ...installed("@yagejs/host-electron", {
        version: "0.12.0",
        dependencies: { "@yagejs/save": "^0.12.0" },
      }),
      "game/node_modules/@yagejs/save/package.json": JSON.stringify({
        name: "@yagejs/save",
        version: "0.12.0",
      }),
    });
    const root = path.join(workspace, "game");
    symlinkSync(root, path.join(workspace, "node_modules", "my-game"));
    const result = rule(
      await report(root, "electron"),
      "packages in the game's folder",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(
      `@yagejs/host-electron (${path.join(workspace, "node_modules", "@yagejs", "host-electron")}) ` +
        "is installed outside the game's node_modules, and an Electron package carries only the game's folder.",
    );
    expect(result.fix).toBe(
      `Run npm install --workspaces=false in ${root}: it installs the game's packages in its own ` +
        "node_modules. An npm install at the workspace root moves them out again.",
    );
  });

  it("passes every iOS rule when Xcode answers", async () => {
    const found = await report(healthyGame("ios"), "ios");
    expect(found.results.filter((result) => !result.ok)).toEqual([]);
  });

  it("names the developer directory a build needs when the tools are selected", async () => {
    const found = await report(healthyGame("ios"), "ios", {
      env: {},
      run: fakeRun({
        ...workingTools,
        "xcode-select -p": {
          status: 0,
          stdout: "/Library/Developer/CommandLineTools\n",
        },
      }),
    });
    expect(rule(found, "Xcode").ok).toBe(false);
    expect(rule(found, "Xcode").fix).toContain(
      "xcode-select points to /Library/Developer/CommandLineTools, the command-line tools.",
    );
    // The two rules that run through Xcode are left out until it is selected.
    expect(found.results.map((result) => result.name)).not.toContain(
      "Xcode first launch",
    );
    expect(found.results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("asks for the first-launch tasks and a simulator runtime", async () => {
    const found = await report(healthyGame("ios"), "ios", {
      run: fakeRun({
        ...workingTools,
        "xcodebuild -checkFirstLaunchStatus": { status: 1 },
        "xcrun simctl list runtimes --json": {
          status: 0,
          stdout: JSON.stringify({ runtimes: [] }),
        },
      }),
    });
    expect(rule(found, "Xcode first launch").fix).toBe(
      "sudo xcodebuild -runFirstLaunch",
    );
    expect(rule(found, "iOS simulator").fix).toBe(
      "Install an iOS simulator runtime in Xcode > Settings > Components.",
    );
  });

  it("says an iOS build needs a Mac", async () => {
    const found = await report(healthyGame("ios"), "ios", {
      platform: "win32",
    });
    expect(rule(found, "macOS").fix).toBe("iOS builds need a Mac with Xcode.");
  });

  it("reports a missing Java runtime rather than failing", async () => {
    const found = await report(healthyGame("android"), "android", {
      run: fakeRun({}),
    });
    expect(rule(found, "JDK").ok).toBe(false);
    expect(rule(found, "JDK").fix).toBe(
      "Install JDK 21 (Android Studio ships one) and set JAVA_HOME to it.",
    );
  });

  it("asks for the Android SDK the generated project compiles against", async () => {
    const root = healthyGame("android");
    addFile(
      root,
      "android/variables.gradle",
      "ext {\n  compileSdkVersion = 35\n}\n",
    );
    const found = await report(root, "android", { env: {} });
    expect(rule(found, "Android SDK").fix).toBe(
      "Install the Android SDK with the platform for API 35 in Android Studio > SDK Manager, and set ANDROID_HOME to its directory.",
    );
  });

  it("passes the Android toolchain rules when the SDK is there", async () => {
    const root = healthyGame("android");
    addFile(root, "sdk/platforms/android-36/marker", "");
    addFile(root, "sdk/build-tools/36.0.0/marker", "");
    const found = await report(root, "android", {
      env: { ANDROID_HOME: `${root}/sdk` },
    });
    expect(rule(found, "Android SDK").ok).toBe(true);
    expect(rule(found, "JDK").ok).toBe(true);
  });

  it("refuses to guess a target when no host package is installed", async () => {
    const root = makeTree({ "package.json": "{}" });
    await expect(runDoctor({ root })).rejects.toThrow(
      "yage-pack doctor: no target to check. Install @yagejs/host-electron or @yagejs/host-capacitor, or pass --target.",
    );
  });

  it("checks every installed target when none is named", async () => {
    const root = healthyGame("ios");
    const reports = await runDoctor({
      root,
      run: fakeRun(workingTools),
      env: { DEVELOPER_DIR: XCODE_DIR },
      platform: "darwin",
      nodeVersion: "v24.15.0",
    });
    expect(reports.map((entry) => entry.target)).toEqual(["electron", "ios"]);
  });
});

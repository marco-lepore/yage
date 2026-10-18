import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { listPackage } from "@electron/asar";
import type { BuildRecord } from "@yagejs-tools/pack";
import { RELEASE_FUSES } from "@yagejs-tools/pack/forge";
import { buildBaseline } from "../lib/build.js";
import {
  electronCacheRoot,
  installAgainstThisRepository,
  npmRun,
  packagedApp,
  packagedExecutable,
  seedElectronCache,
} from "../lib/forge.js";
import {
  installClean,
  launchWithConsole,
  selectSimulator,
  terminate,
} from "../lib/ios.js";
import { nativeDir, repoRoot, workDir } from "../lib/paths.js";
import { hashWebDir } from "../lib/report.js";

/** The identifier the packaged fixture is built under. */
const FIXTURE_APP_ID = "dev.yage.baseline";

/** What the shell prints once the window has the game. */
const STARTED = '"started"';

interface SpawnResult {
  code: number | null;
  output: string;
}

/** Run a packaged app and collect what it printed, stopping after `ms`. */
function runApp(
  executable: string,
  options: {
    readonly env: Record<string, string>;
    readonly args?: readonly string[];
    readonly ms: number;
    readonly until?: (output: string) => boolean;
  },
): Promise<SpawnResult> {
  return new Promise((done) => {
    const child = spawn(executable, [...(options.args ?? [])], {
      env: { ...(process.env as Record<string, string>), ...options.env },
    });
    let output = "";
    const take = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (options.until?.(output) === true) child.kill("SIGTERM");
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => child.kill("SIGTERM"), options.ms);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });
}

/** Read a build record a command wrote. */
function readRecord(file: string): BuildRecord {
  return JSON.parse(readFileSync(file, "utf8")) as BuildRecord;
}

/** Every save file a profile's directory holds. */
function saveFiles(appData: string, appId: string, profile: string): string[] {
  const dir = resolve(appData, appId, "saves", profile);
  return existsSync(dir) ? readdirSync(dir) : [];
}

test.describe("packaging", () => {
  test.skip(process.platform !== "darwin", "The packaged checks need macOS.");

  test("the baseline fixture runs from a Forge-packaged app", async () => {
    const webDir = await buildBaseline("electron", "release");
    const project = resolve(workDir, "forge-fixture");
    rmSync(project, { recursive: true, force: true });
    mkdirSync(resolve(project, "electron"), { recursive: true });
    cpSync(
      resolve(nativeDir, "electron/main.cjs"),
      resolve(project, "electron/main.cjs"),
    );
    cpSync(webDir, resolve(project, "dist-electron"), { recursive: true });
    writeFileSync(
      resolve(project, "package.json"),
      `${JSON.stringify(
        {
          name: "yage-baseline-package",
          productName: "YAGE Baseline",
          version: "0.0.0",
          private: true,
          main: "electron/main.cjs",
          yage: { appId: FIXTURE_APP_ID },
          dependencies: { "@yagejs/host-electron": "*" },
          devDependencies: {
            "@yagejs-tools/pack": "*",
            electron: "44.7.0",
            "@electron-forge/cli": "8.0.1",
            "@electron-forge/maker-zip": "8.0.1",
            "@electron-forge/plugin-fuses": "8.0.1",
            "@electron/fuses": "2.1.3",
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      resolve(project, "forge.config.cjs"),
      `const { electronForgeConfig } = require("@yagejs-tools/pack/forge");

module.exports = electronForgeConfig({
  packagerConfig: { download: { cacheRoot: ${JSON.stringify(electronCacheRoot)} } },
});
`,
    );
    seedElectronCache();
    installAgainstThisRepository(project, [
      "@yagejs/host-electron",
      "@yagejs-tools/pack",
    ]);

    npmRun(
      "npx",
      [
        "electron-forge",
        "make",
        "--platform",
        "darwin",
        "--arch",
        process.arch,
      ],
      project,
    );

    const record = readRecord(resolve(project, "out/yage-build-electron.json"));
    expect(record.target).toBe("electron");
    expect(record.app.appId).toBe(FIXTURE_APP_ID);
    expect(record.hostBridgeProtocol).toBe(1);
    expect(record.artifacts.map((artifact) => artifact.kind)).toEqual([
      "electron-app",
      "electron-zip",
    ]);
    expect(record.web.digest).toBe(
      (await hashWebDir(resolve(project, "dist-electron"))).digest,
    );

    const app = packagedApp(project);
    const { getCurrentFuseWire, FuseV1Options, FuseState } =
      await import("@electron/fuses");
    const read = (await getCurrentFuseWire(app)) as unknown as Record<
      number,
      number
    >;
    for (const [name, wanted] of Object.entries(RELEASE_FUSES)) {
      const index = FuseV1Options[
        name as keyof typeof FuseV1Options
      ] as unknown as number;
      expect([name, read[index] === FuseState.ENABLE]).toEqual([name, wanted]);
    }

    const archive = resolve(app, "Contents/Resources/app.asar");
    const entries = listPackage(archive, { isPack: false });
    expect(entries).toContain("/package.json");
    expect(entries).toContain("/electron/main.cjs");
    expect(entries).toContain("/dist-electron/index.html");
    expect(entries).toContain(
      "/node_modules/@yagejs/host-electron/dist/preload.cjs",
    );
    const foreign = entries.filter(
      (entry) =>
        entry.startsWith("/node_modules/") &&
        entry.split("/").length > 4 &&
        !entry.startsWith("/node_modules/@yagejs/host-electron/") &&
        !entry.startsWith("/node_modules/@yagejs/save/") &&
        !entry.startsWith("/node_modules/@yagejs/core/"),
    );
    expect(foreign).toEqual([]);
    expect(entries.filter((entry) => entry.startsWith("/src/"))).toEqual([]);
    expect(entries.filter((entry) => entry.startsWith("/out/"))).toEqual([]);

    const executable = packagedExecutable(app);
    const appData = resolve(workDir, "forge-fixture-data");
    rmSync(appData, { recursive: true, force: true });
    mkdirSync(appData, { recursive: true });
    const env = {
      YAGE_BASELINE_APP_DATA: appData,
      YAGE_BASELINE_PROFILE: "release",
    };
    const started = await runApp(executable, { env, ms: 20_000 });
    expect(started.output).toContain(STARTED);
    expect(started.output).not.toContain("did-fail-load");
    expect(started.output).not.toContain("render-process-gone");
    expect(
      saveFiles(appData, FIXTURE_APP_ID, "release").filter((file) =>
        file.endsWith(".sav"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      saveFiles(appData, FIXTURE_APP_ID, "release").filter((file) =>
        file.endsWith(".new"),
      ),
    ).toEqual([]);

    const asNode = await runApp(executable, {
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      args: ["-e", "console.log('yage-run-as-node')"],
      ms: 30_000,
      until: (output) => output.includes(STARTED),
    });
    expect(asNode.output).toContain(STARTED);
    expect(asNode.output).not.toContain("yage-run-as-node");

    const copy = resolve(workDir, "forge-fixture-tampered.app");
    rmSync(copy, { recursive: true, force: true });
    cpSync(app, copy, { recursive: true });
    const copiedArchive = resolve(copy, "Contents/Resources/app.asar");
    const bytes = readFileSync(copiedArchive);
    const at = bytes.indexOf(Buffer.from("startGame("));
    expect(at).toBeGreaterThan(0);
    bytes[at] = bytes[at] === 0x73 ? 0x74 : 0x73;
    writeFileSync(copiedArchive, bytes);
    const tampered = await runApp(packagedExecutable(copy), {
      env,
      ms: 20_000,
    });
    expect(tampered.output).toContain("ASAR Integrity Violation");
    expect(tampered.code).not.toBe(0);

    // A packaged app cannot be driven by a test driver: the fuse that lets
    // one attach is off, so a debugger argument is ignored and the game
    // simply starts.
    const inspected = await runApp(executable, {
      env,
      args: ["--inspect=9333"],
      ms: 20_000,
      until: (output) => output.includes(STARTED),
    });
    expect(inspected.output).toContain(STARTED);
    expect(inspected.output).not.toContain("Debugger listening");

    renameSync(
      resolve(project, "dist-electron"),
      resolve(project, "dist-electron-moved"),
    );
    let failure = "";
    try {
      npmRun("npx", ["electron-forge", "package"], project);
    } catch (error) {
      const spawned = error as { stdout?: string; stderr?: string };
      failure = `${spawned.stdout ?? ""}${spawned.stderr ?? ""}`;
    }
    expect(failure).toContain("web build");
    renameSync(
      resolve(project, "dist-electron-moved"),
      resolve(project, "dist-electron"),
    );
  });

  test("a scaffolded game is set up, checked and packaged", async () => {
    const parent = resolve(workDir, "pack");
    const project = resolve(parent, "My Game");
    rmSync(parent, { recursive: true, force: true });
    mkdirSync(parent, { recursive: true });

    npmRun(
      "node",
      [
        resolve(repoRoot, "packages/create-yage/dist/index.js"),
        project,
        "--template",
        "recommended",
        "--features",
        "electron,capacitor",
        "--no-install",
        "--no-git",
        "--yes",
      ],
      parent,
    );
    expect(
      (
        JSON.parse(readFileSync(resolve(project, "package.json"), "utf8")) as {
          name: string;
        }
      ).name,
    ).toBe("my-game");

    // Everything the scaffold declares that this repository builds, so the
    // game runs this engine rather than the published one.
    installAgainstThisRepository(project);
    npmRun("git", ["init", "-q"], project);
    npmRun("git", ["add", "-A"], project);
    npmRun(
      "git",
      [
        "-c",
        "user.name=suite",
        "-c",
        "user.email=suite@example.com",
        "commit",
        "-qm",
        "scaffold",
      ],
      project,
    );

    const pack = resolve(project, "node_modules/.bin/yage-pack");
    const appId = "dev.yage.packscaffold";
    const first = npmRun(
      pack,
      [
        "init",
        "--target",
        "electron",
        "--target",
        "ios",
        "--target",
        "android",
        "--app-id",
        appId,
      ],
      project,
    );
    for (const file of [
      "src/main.electron.ts",
      "electron/main.cjs",
      "forge.config.cjs",
      "src/main.capacitor.ts",
      "capacitor.config.ts",
    ]) {
      expect(first).toContain(`wrote ${file}`);
    }
    const second = npmRun(
      pack,
      [
        "init",
        "--target",
        "electron",
        "--target",
        "ios",
        "--target",
        "android",
      ],
      project,
    );
    expect(second).not.toContain("wrote ");
    expect(() =>
      npmRun(
        pack,
        ["init", "--target", "electron", "--app-id", "dev.yage.other"],
        project,
      ),
    ).toThrow();

    expect(readFileSync(resolve(project, "forge.config.cjs"), "utf8")).toBe(
      'const { electronForgeConfig } = require("@yagejs-tools/pack/forge");\n\nmodule.exports = electronForgeConfig();\n',
    );

    const doctor = JSON.parse(
      npmRun(pack, ["doctor", "--target", "electron", "--json"], project),
    ) as { ok: boolean };
    expect(doctor.ok).toBe(true);
    for (const target of ["ios", "android"] as const) {
      // What a mobile build needs depends on the machine, so the report
      // records what this one was missing rather than asserting it.
      const report = runDoctor(pack, project, target);
      test.info().annotations.push({
        type: `doctor ${target}`,
        description:
          report.failures.length === 0
            ? "every rule passed"
            : `failed: ${report.failures.join(", ")}`,
      });
    }

    npmRun("npm", ["run", "build"], project);
    expect(existsSync(resolve(project, "dist/sw.js"))).toBe(true);
    npmRun("npm", ["run", "build:electron"], project);
    npmRun("npm", ["run", "build:capacitor"], project);
    for (const [dir, marker] of [
      ["dist-electron", "no YAGE host bridge on this page"],
      ["dist-capacitor", "this page is not running inside a Capacitor app"],
    ] as const) {
      const built = resolve(project, dir);
      expect(existsSync(resolve(built, "index.html"))).toBe(true);
      expect(existsSync(resolve(built, "sw.js"))).toBe(false);
      const sources = readdirSync(resolve(built, "assets")).map((file) =>
        readFileSync(resolve(built, "assets", file), "utf8"),
      );
      expect(sources.some((source) => source.includes(marker))).toBe(true);
      expect(
        sources.some((source) => source.includes("serviceWorker.register")),
      ).toBe(false);
    }

    writeFileSync(
      resolve(project, "forge.config.cjs"),
      `const { electronForgeConfig } = require("@yagejs-tools/pack/forge");

module.exports = electronForgeConfig({
  packagerConfig: { download: { cacheRoot: ${JSON.stringify(electronCacheRoot)} } },
});
`,
    );
    const check = JSON.parse(
      npmRun(pack, ["check", "--target", "electron", "--json"], project),
    ) as { ok: boolean };
    expect(check.ok).toBe(true);

    seedElectronCache();
    npmRun("npm", ["run", "make:electron"], project);
    const record = readRecord(resolve(project, "out/yage-build-electron.json"));
    expect(record.app.appId).toBe(appId);
    expect(record.artifacts.map((artifact) => artifact.kind)).toEqual([
      "electron-app",
      "electron-zip",
    ]);
    const entries = listPackage(
      resolve(packagedApp(project), "Contents/Resources/app.asar"),
      { isPack: false },
    );
    expect(entries).toContain("/dist-electron/index.html");
    expect(entries.filter((entry) => entry.startsWith("/src/"))).toEqual([]);

    const added = npmRun(
      "npx",
      ["cap", "add", "ios", "--packagemanager", "SPM"],
      project,
    );
    expect(added).toContain("yage-pack check — ios");
    const addedAndroid = npmRun("npx", ["cap", "add", "android"], project);
    expect(addedAndroid).toContain("yage-pack check — android");

    const iosRelease = checkRelease(pack, project, "ios");
    expect(iosRelease.failures).toEqual(["privacy manifest", "version"]);
    const androidRelease = checkRelease(pack, project, "android");
    expect(androidRelease.failures).toEqual(["game category", "version"]);

    applyAndroidFixes(project);
    const androidFixed = checkRelease(pack, project, "android");
    expect(androidFixed.failures).toEqual([]);

    npmRun("git", ["add", "-A"], project);
    npmRun(
      "git",
      [
        "-c",
        "user.name=suite",
        "-c",
        "user.email=suite@example.com",
        "commit",
        "-qm",
        "targets",
      ],
      project,
    );

    // The simulator build, when this machine has an Xcode to build it with.
    if (process.env["DEVELOPER_DIR"] !== undefined) {
      const derivedData = resolve(workDir, "pack-ios-derived");
      npmRun(
        "xcodebuild",
        [
          "-project",
          resolve(project, "ios/App/App.xcodeproj"),
          "-scheme",
          "App",
          "-configuration",
          "Debug",
          "-sdk",
          "iphonesimulator",
          "-destination",
          "generic/platform=iOS Simulator",
          "-derivedDataPath",
          derivedData,
          "CODE_SIGNING_ALLOWED=NO",
          "build",
        ],
        project,
      );
      const builtApp = resolve(
        derivedData,
        "Build/Products/Debug-iphonesimulator/App.app",
      );
      expect(existsSync(builtApp)).toBe(true);

      const device = selectSimulator();
      await installClean(device.udid, builtApp, appId);
      const launched = launchWithConsole(device.udid, appId);
      try {
        await launched.waitFor(
          (line) => line.includes("WebView loaded"),
          60_000,
        );
      } finally {
        launched.close();
        await terminate(device.udid, appId);
      }

      npmRun(
        pack,
        [
          "record",
          "--target",
          "ios",
          "--profile",
          "development",
          "--artifact",
          builtApp,
          "--out",
          resolve(project, "out/yage-build-ios.json"),
        ],
        project,
      );
      const iosRecord = readRecord(resolve(project, "out/yage-build-ios.json"));
      expect(iosRecord.artifacts[0]?.kind).toBe("ios-simulator-app");
      expect(iosRecord.app.build).toBe("1");
      expect(iosRecord.web.digest).toBe(
        (await hashWebDir(resolve(project, "dist-capacitor"))).digest,
      );
    }

    // The native projects are the game's: an edit survives a sync, a file
    // missing from the build leaves the native project with it, and no
    // tracked file is rewritten.
    const plist = resolve(project, "ios/App/App/Info.plist");
    writeFileSync(
      plist,
      readFileSync(plist, "utf8").replace(
        "<dict>",
        "<dict>\n\t<key>UIRequiresFullScreen</key>\n\t<true/>",
      ),
    );
    writeFileSync(resolve(project, "dist-capacitor/stale.txt"), "stale\n");
    npmRun("npx", ["cap", "sync"], project);
    expect(existsSync(resolve(project, "ios/App/App/public/stale.txt"))).toBe(
      true,
    );
    npmRun("npm", ["run", "sync:capacitor"], project);
    npmRun("npm", ["run", "sync:capacitor"], project);
    expect(existsSync(resolve(project, "ios/App/App/public/stale.txt"))).toBe(
      false,
    );
    expect(
      existsSync(
        resolve(project, "android/app/src/main/assets/public/stale.txt"),
      ),
    ).toBe(false);
    expect(readFileSync(plist, "utf8")).toContain("UIRequiresFullScreen");
    const tracked = npmRun("git", ["status", "--short"], project)
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("??"));
    expect(tracked).toEqual([" M ios/App/App/Info.plist"]);
  });
});

/** What `doctor` reported for one target on this machine. */
function runDoctor(
  pack: string,
  project: string,
  target: "ios" | "android",
): { failures: string[] } {
  let output = "";
  try {
    output = npmRun(pack, ["doctor", "--target", target, "--json"], project);
  } catch (error) {
    output = (error as { stdout?: string }).stdout ?? "";
  }
  const report = JSON.parse(output) as {
    results: { name: string; ok: boolean }[];
  };
  return {
    failures: report.results
      .filter((result) => !result.ok)
      .map((result) => result.name),
  };
}

/** The names of the rules a release check failed. */
function checkRelease(
  pack: string,
  project: string,
  target: "ios" | "android",
): { failures: string[] } {
  let output = "";
  try {
    output = npmRun(
      pack,
      ["check", "--target", target, "--release", "--json"],
      project,
    );
  } catch (error) {
    output = (error as { stdout?: string }).stdout ?? "";
  }
  const report = JSON.parse(output) as {
    results: { name: string; ok: boolean }[];
  };
  return {
    failures: report.results
      .filter((result) => !result.ok)
      .map((result) => result.name)
      .sort(),
  };
}

/** Apply the two fixes the Android release rules print. */
function applyAndroidFixes(project: string): void {
  const manifestFile = resolve(
    project,
    "android/app/src/main/AndroidManifest.xml",
  );
  writeFileSync(
    manifestFile,
    readFileSync(manifestFile, "utf8").replace(
      "<application",
      '<application\n        android:appCategory="game"',
    ),
  );
  const gradleFile = resolve(project, "android/app/build.gradle");
  const version = (
    JSON.parse(readFileSync(resolve(project, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  writeFileSync(
    gradleFile,
    readFileSync(gradleFile, "utf8").replace(
      /versionName\s+"[^"]*"/,
      `versionName "${version}"`,
    ),
  );
}

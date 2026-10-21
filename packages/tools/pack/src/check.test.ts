import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "./check.js";
import { installFuseReader, wire } from "./test/fuses.js";
import { addFile, makeTree, removeTrees, snapshot } from "./test/tree.js";
import { xcodeProject } from "./test/xcode.js";
import type { CheckReport } from "./types.js";

const APP_ID = "com.example.mygame";

const manifest = {
  productName: "My Game",
  version: "1.2.3",
  yage: { appId: APP_ID },
};

const copiedConfig = {
  appId: APP_ID,
  appName: "My Game",
  webDir: "dist-capacitor",
  ios: { contentInset: "never" },
};

/** The build-file entry Xcode writes when the App target copies the file. */
const PRIVACY_BUILD_FILE =
  "\t\t1A2B /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = 3C4D /* PrivacyInfo.xcprivacy */; };\n";

const PRIVACY_OBJECTS = `${PRIVACY_BUILD_FILE}\t\t3C4D /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; path = PrivacyInfo.xcprivacy; };\n`;

/** The App target's Release settings of a project that agrees with the game. */
const RELEASE = {
  CURRENT_PROJECT_VERSION: "1",
  MARKETING_VERSION: "1.2.3",
  PRODUCT_BUNDLE_IDENTIFIER: APP_ID,
};

/** The Xcode project of a synced game, with the App target's settings. */
function pbxproj(
  release: Record<string, string> = RELEASE,
  more: Omit<Parameters<typeof xcodeProject>[0], "release"> = {},
): string {
  return xcodeProject({ objects: PRIVACY_OBJECTS, release, ...more });
}

const PBXPROJ = pbxproj();

const BUILD_GRADLE = `android {
    namespace "${APP_ID}"
    defaultConfig {
        applicationId "${APP_ID}"
        versionCode 1
        versionName "1.2.3"
    }
}
`;

const ANDROID_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:appCategory="game"
        android:label="@string/app_name">
    </application>
</manifest>
`;

const PRIVACY = `<plist version="1.0"><dict>
<key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
</dict></plist>
`;

/** A game with both web builds and a synced iOS and Android project. */
function game(overrides: Record<string, string> = {}): string {
  return makeTree({
    "package.json": JSON.stringify(manifest),
    "dist-electron/index.html": "<!doctype html>\n",
    "dist-capacitor/index.html": "<!doctype html>\n",
    "ios/App/App.xcodeproj/project.pbxproj": PBXPROJ,
    "ios/App/App/capacitor.config.json": JSON.stringify(copiedConfig),
    "ios/App/App/PrivacyInfo.xcprivacy": PRIVACY,
    "android/app/build.gradle": BUILD_GRADLE,
    "android/app/src/main/AndroidManifest.xml": ANDROID_MANIFEST,
    "android/app/src/main/assets/capacitor.config.json":
      JSON.stringify(copiedConfig),
    ...overrides,
  });
}

function rule(report: CheckReport, name: string) {
  const result = report.results.find((entry) => entry.name === name);
  if (result === undefined) throw new Error(`no ${name} rule in the report`);
  return result;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  removeTrees();
});

describe("runCheck contract rules", () => {
  it("passes for a synced project whose identity agrees everywhere", async () => {
    const root = game();
    for (const target of ["ios", "android"] as const) {
      const report = await runCheck({ root, target, release: false });
      expect(report.results.filter((result) => !result.ok)).toEqual([]);
    }
  });

  it("names the build command when the web build is missing", async () => {
    const root = makeTree({ "package.json": JSON.stringify(manifest) });
    expect(
      rule(
        await runCheck({ root, target: "electron", release: false }),
        "web build",
      ).fix,
    ).toBe("Build it first: npm run build:electron.");
    expect(
      rule(await runCheck({ root, target: "ios", release: false }), "web build")
        .fix,
    ).toBe("Build it first: npm run build:capacitor.");
  });

  it("refuses a native build that registers a service worker", async () => {
    const root = game({
      "dist-capacitor/sw-registration.js":
        "navigator.serviceWorker.register('/sw.js');\n",
    });
    const result = rule(
      await runCheck({ root, target: "ios", release: false }),
      "no service worker",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("sw-registration.js");
    expect(result.fix).toContain(
      "VitePWA is registered for the web build only",
    );
  });

  it("names the command that generates a missing native project", async () => {
    const root = makeTree({
      "package.json": JSON.stringify(manifest),
      "dist-capacitor/index.html": "<!doctype html>\n",
    });
    expect(
      rule(
        await runCheck({ root, target: "ios", release: false }),
        "native project",
      ).fix,
    ).toBe("npx cap add ios --packagemanager SPM");
    expect(
      rule(
        await runCheck({ root, target: "android", release: false }),
        "native project",
      ).fix,
    ).toBe("npx cap add android");
  });

  it("names the setting that carries a stale bundle identifier", async () => {
    const root = game({
      "ios/App/App.xcodeproj/project.pbxproj": pbxproj({
        ...RELEASE,
        PRODUCT_BUNDLE_IDENTIFIER: "com.example.old",
      }),
    });
    const result = rule(
      await runCheck({ root, target: "ios", release: false }),
      "app id in the native project",
    );
    expect(result.ok).toBe(false);
    expect(result.fix).toBe(
      `Set the bundle identifier of the App target in Xcode (Signing & Capabilities) to ${APP_ID}; npx cap sync never changes it.`,
    );
  });

  it("reads the App target's Release configuration, not a Debug-only identifier", async () => {
    const root = game({
      "ios/App/App.xcodeproj/project.pbxproj": pbxproj(RELEASE, {
        debug: { ...RELEASE, PRODUCT_BUNDLE_IDENTIFIER: `${APP_ID}.dev` },
        projectRelease: { MARKETING_VERSION: "9.9.9" },
      }),
    });
    const report = await runCheck({ root, target: "ios", release: true });
    expect(rule(report, "app id in the native project").ok).toBe(true);
    expect(rule(report, "version").ok).toBe(true);
  });

  it("reports a bundle identifier the App target inherits as unreadable", async () => {
    const root = game({
      "ios/App/App.xcodeproj/project.pbxproj": pbxproj(
        { CURRENT_PROJECT_VERSION: "1", MARKETING_VERSION: "1.2.3" },
        {
          projectRelease: { PRODUCT_BUNDLE_IDENTIFIER: APP_ID },
        },
      ),
    });
    const result = rule(
      await runCheck({ root, target: "ios", release: false }),
      "app id in the native project",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(
      `Expected ${APP_ID}, but the project's PRODUCT_BUNDLE_IDENTIFIER cannot be read, ` +
        "because the App target's Release configuration does not set it, so any value " +
        "comes from the project or an xcconfig file.",
    );
    expect(result.fix).toBe(
      `Set the bundle identifier of the App target in Xcode (Signing & Capabilities) to ${APP_ID}; ` +
        "npx cap sync never changes it. The check reads it from the App target's Release " +
        "configuration in project.pbxproj.",
    );
  });

  it("reports a version built from other settings as unreadable", async () => {
    const root = game({
      "ios/App/App.xcodeproj/project.pbxproj": pbxproj({
        ...RELEASE,
        MARKETING_VERSION: '"$(APP_VERSION)"',
      }),
    });
    const result = rule(
      await runCheck({ root, target: "ios", release: true }),
      "version",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(
      "MARKETING_VERSION cannot be read, because the App target's Release configuration " +
        "sets it to $(APP_VERSION), which refers to other settings.",
    );
  });

  it("asks for a sync before the rules that read the copied configuration", async () => {
    for (const target of ["ios", "android"] as const) {
      const root = game({});
      const copied =
        target === "ios"
          ? "ios/App/App/capacitor.config.json"
          : "android/app/src/main/assets/capacitor.config.json";
      rmSync(path.join(root, copied));
      const report = await runCheck({ root, target, release: true });
      expect(report.results.filter((result) => !result.ok)).toEqual([
        rule(report, "copied config"),
      ]);
      expect(rule(report, "copied config").fix).toBe(`npx cap sync ${target}`);
      const names = report.results.map((result) => result.name);
      for (const gated of [
        "app id in the native project",
        "YAGE settings",
        "no development server",
        "no credentials in the config",
      ]) {
        expect([target, names]).not.toEqual([
          target,
          expect.arrayContaining([gated]),
        ]);
      }
    }
  });

  it("reads a Gradle setting written with an equals sign", async () => {
    const root = game({
      "android/app/build.gradle": BUILD_GRADLE.replace(
        `applicationId "${APP_ID}"`,
        `applicationId = "${APP_ID}"`,
      ).replace('versionName "1.2.3"', 'versionName = "1.2.3"'),
    });
    const report = await runCheck({ root, target: "android", release: true });
    expect(rule(report, "app id in the native project").ok).toBe(true);
    expect(rule(report, "version").ok).toBe(true);
  });

  it("names the Gradle setting on Android", async () => {
    const root = game({
      "android/app/build.gradle": BUILD_GRADLE.replace(
        `applicationId "${APP_ID}"`,
        'applicationId "com.example.old"',
      ),
    });
    expect(
      rule(
        await runCheck({ root, target: "android", release: false }),
        "app id in the native project",
      ).fix,
    ).toBe(
      `Set applicationId and namespace in android/app/build.gradle to ${APP_ID}; npx cap sync never changes it.`,
    );
  });

  it("names a setting the adapter depends on that was overridden", async () => {
    const root = game({
      "ios/App/App/capacitor.config.json": JSON.stringify({
        ...copiedConfig,
        ios: { contentInset: "automatic" },
        plugins: { App: { disableBackButtonHandler: true } },
      }),
    });
    const result = rule(
      await runCheck({ root, target: "ios", release: false }),
      "YAGE settings",
    );
    expect(result.ok).toBe(false);
    expect(result.fix).toBe(
      "Export capacitorConfig() from capacitor.config.ts without overriding ios.contentInset or plugins.App.disableBackButtonHandler.",
    );
  });

  it("reports a manifest it cannot read as the identity failure", async () => {
    const root = makeTree({ "package.json": JSON.stringify({ version: "1" }) });
    const report = await runCheck({ root, target: "ios", release: false });
    expect(rule(report, "identity").ok).toBe(false);
    expect(rule(report, "identity").fix).toContain('must set "productName"');
  });

  it("skips the rules that compare against an identity it could not read", async () => {
    const root = game({
      "package.json": JSON.stringify({ ...manifest, productName: undefined }),
    });
    const previous = addFile(
      root,
      "last-release.json",
      JSON.stringify({ schema: 1, target: "ios", app: { appId: APP_ID } }),
    );
    const report = await runCheck({
      root,
      target: "ios",
      release: true,
      previous,
    });
    expect(report.results.filter((result) => !result.ok)).toEqual([
      rule(report, "identity"),
    ]);
    const names = report.results.map((result) => result.name);
    expect(names).not.toContain("app id in the native project");
    expect(names).not.toContain("version");
    expect(names).not.toContain("same app id as the last release");
  });

  it("takes the target from the Capacitor hook's environment", async () => {
    vi.stubEnv("CAPACITOR_PLATFORM_NAME", "android");
    const { runCli } = await import("./cli/run.js");
    const lines: string[] = [];
    const code = await runCli(
      ["check"],
      "0.0.0",
      { out: (text) => lines.push(text), err: (text) => lines.push(text) },
      game(),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("yage-pack check — android");
  });

  it("has no rules for the browser platform the sync hook also runs for", async () => {
    vi.stubEnv("CAPACITOR_PLATFORM_NAME", "web");
    const { runCli } = await import("./cli/run.js");
    const lines: string[] = [];
    const code = await runCli(
      ["check"],
      "0.0.0",
      { out: (text) => lines.push(text), err: (text) => lines.push(text) },
      game(),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toBe(
      "yage-pack check — web: no rules for this platform.",
    );
  });

  it("asks for a target when nothing names one", async () => {
    vi.stubEnv("CAPACITOR_PLATFORM_NAME", "");
    const { runCli } = await import("./cli/run.js");
    const errors: string[] = [];
    const code = await runCli(
      ["check"],
      "0.0.0",
      { out: () => {}, err: (text) => errors.push(text) },
      game(),
    );
    expect(code).toBe(1);
    expect(errors[0]).toBe(
      "yage-pack: yage-pack check: pass --target electron, ios or android.",
    );
  });
});

describe("runCheck release rules", () => {
  it("passes a release-ready iOS and Android project", async () => {
    const root = game();
    for (const target of ["ios", "android"] as const) {
      const report = await runCheck({ root, target, release: true });
      expect(report.results.filter((result) => !result.ok)).toEqual([]);
    }
  });

  it("names every development setting in the copied configuration", async () => {
    const root = game({
      "android/app/src/main/assets/capacitor.config.json": JSON.stringify({
        ...copiedConfig,
        server: { url: "http://10.0.2.2:5173", cleartext: true },
        android: {
          allowMixedContent: true,
          webContentsDebuggingEnabled: true,
          buildOptions: { keystorePassword: "secret" },
        },
      }),
    });
    const report = await runCheck({ root, target: "android", release: true });
    expect(rule(report, "no development server").fix).toBe(
      "Remove server.url and server.cleartext and android.allowMixedContent and " +
        "android.webContentsDebuggingEnabled from capacitor.config.ts for a release.",
    );
    expect(rule(report, "no credentials in the config").fix).toContain(
      "every Capacitor hook script receives the whole config in CAPACITOR_CONFIG",
    );
  });

  it("names the version setting that drifted", async () => {
    const root = game({
      "ios/App/App.xcodeproj/project.pbxproj": pbxproj({
        ...RELEASE,
        MARKETING_VERSION: "1.0.0",
      }),
    });
    expect(
      rule(await runCheck({ root, target: "ios", release: true }), "version")
        .fix,
    ).toBe("Set MARKETING_VERSION of the App target in Xcode to 1.2.3.");
  });

  it("needs the privacy manifest both written and in the target", async () => {
    const withoutFile = game({
      "ios/App/App/PrivacyInfo.xcprivacy": "<plist></plist>",
    });
    expect(
      rule(
        await runCheck({ root: withoutFile, target: "ios", release: true }),
        "privacy manifest",
      ).ok,
    ).toBe(false);

    // A file added to the project with the target unticked keeps its file
    // reference and has no Resources entry.
    const withoutReference = game({
      "ios/App/App.xcodeproj/project.pbxproj": PBXPROJ.replace(
        PRIVACY_BUILD_FILE,
        "",
      ),
    });
    const result = rule(
      await runCheck({ root: withoutReference, target: "ios", release: true }),
      "privacy manifest",
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe(
      "The privacy manifest is not in the App target's resources.",
    );
    expect(result.fix).toContain("NSPrivacyAccessedAPICategoryFileTimestamp");
  });

  it("asks for the game category in the Android manifest", async () => {
    const root = game({
      "android/app/src/main/AndroidManifest.xml": ANDROID_MANIFEST.replace(
        '        android:appCategory="game"\n',
        "",
      ),
    });
    expect(
      rule(
        await runCheck({ root, target: "android", release: true }),
        "game category",
      ).fix,
    ).toBe(
      'Add android:appCategory="game" to the <application> element of android/app/src/main/AndroidManifest.xml.',
    );
  });

  it("names a fuse that differs from the release set", async () => {
    const root = game({
      "out/My Game-darwin-arm64/My Game.app/Contents/Resources/app.asar": "x",
    });
    installFuseReader(root, wire({ RunAsNode: true }));
    const report = await runCheck({ root, target: "electron", release: true });
    expect(rule(report, "fuses").ok).toBe(false);
    expect(rule(report, "fuses").fix).toBe(
      "The packaged app has RunAsNode on: remove the plugin or packager setting that changes it.",
    );
    expect(rule(report, "archive").ok).toBe(true);
  });

  it("passes the packaged app that carries the release set", async () => {
    const root = game({
      "out/My Game-darwin-arm64/My Game.app/Contents/Resources/app.asar": "x",
    });
    installFuseReader(root, wire());
    const report = await runCheck({ root, target: "electron", release: true });
    expect(report.ok).toBe(true);
  });

  it("asks for an archive when the package holds none", async () => {
    const root = game({
      "out/My Game-darwin-arm64/My Game.app/Contents/Info.plist": "",
    });
    installFuseReader(root, "missing");
    const report = await runCheck({ root, target: "electron", release: true });
    expect(rule(report, "archive").fix).toBe(
      "Package with electronForgeConfig(), which sets asar: true.",
    );
    expect(rule(report, "fuses").detail).toContain("no fuse wire");
  });

  it("reads the fuses from the executable of a Windows package", async () => {
    const root = game({
      "out/My Game-win32-x64/My Game.exe": "exe",
      "out/My Game-win32-x64/resources/app.asar": "x",
      "out/My Game-win32-x64/ffmpeg.dll": "",
      "out/My Game-win32-x64/locales/en-US.pak": "",
    });
    installFuseReader(root, wire());
    const report = await runCheck({ root, target: "electron", release: true });
    expect(report.results.filter((result) => !result.ok)).toEqual([]);
    expect(rule(report, "fuses").detail).toBe(
      "My Game.exe carries the release fuses.",
    );
  });

  it("names the route to the executable for a folder it cannot read", async () => {
    const linux = "out/my-game-linux-x64";
    const several = "out/My Game-win32-arm64";
    const root = game({
      [`${linux}/my-game`]: "elf",
      [`${linux}/resources/app.asar`]: "x",
      [`${several}/My Game.exe`]: "exe",
      [`${several}/Helper.exe`]: "exe",
      [`${several}/resources/app.asar`]: "x",
    });
    installFuseReader(root, wire());
    const report = await runCheck({
      root,
      target: "electron",
      release: true,
      apps: [path.join(root, linux), path.join(root, several)],
    });
    const fuses = report.results.filter((result) => result.name === "fuses");
    const route =
      "Name the executable that holds the fuses: yage-pack check --target electron --release --app <path to the executable>.";
    const expected = [
      "holds no .app bundle and no .exe file at its top level.",
      "holds no .app bundle and 2 .exe files at its top level (Helper.exe, My Game.exe).",
    ];
    expect(
      fuses.map((result) => [result.ok, result.fix, result.detail]),
    ).toEqual(
      [linux, several].map((dir, index) => [
        false,
        route,
        `${path.join(root, dir)} ${expected[index] as string} The fuses are read from a macOS .app bundle, ` +
          "or from the one .exe beside resources/app.asar in a Windows package.",
      ]),
    );
    expect(
      report.results.filter((result) => result.name === "archive"),
    ).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
  });

  it("reads an executable passed with --app, and the archive beside it", async () => {
    const root = game({
      "out/my-game-linux-x64/my-game": "elf",
      "out/my-game-linux-x64/resources/app.asar": "x",
    });
    installFuseReader(root, wire());
    const report = await runCheck({
      root,
      target: "electron",
      release: true,
      apps: [path.join(root, "out", "my-game-linux-x64", "my-game")],
    });
    expect(report.results.filter((result) => !result.ok)).toEqual([]);
  });

  it("names an --app that is missing once", async () => {
    const root = game();
    installFuseReader(root, wire());
    const app = path.join(root, "out", "My Game-darwin-arm64");
    const report = await runCheck({
      root,
      target: "electron",
      release: true,
      apps: [app],
    });
    expect(
      report.results
        .filter((result) => !result.ok)
        .map((result) => result.detail),
    ).toEqual([`${app} is missing.`]);
  });

  it("reports an --app that is a file as a package without fuses", async () => {
    const root = game({ "out/make/My Game.zip": "zip" });
    installFuseReader(root, "missing");
    const app = path.join(root, "out", "make", "My Game.zip");
    const report = await runCheck({
      root,
      target: "electron",
      release: true,
      apps: [app],
    });
    expect(rule(report, "fuses").detail).toContain(`${app} has no fuse wire`);
    expect(rule(report, "archive").fix).toBe(
      "Package with electronForgeConfig(), which sets asar: true.",
    );
  });

  it("refuses a release whose identifier left the last one behind", async () => {
    const root = game();
    const previous = addFile(
      root,
      "last-release.json",
      JSON.stringify({
        schema: 1,
        target: "ios",
        app: { appId: "com.example.old" },
      }),
    );
    const report = await runCheck({
      root,
      target: "ios",
      release: true,
      previous,
    });
    expect(rule(report, "same app id as the last release").fix).toBe(
      "The previous release was com.example.old. Players' saves stay under the old identifier; " +
        `restore it in package.json "yage.appId".`,
    );
  });

  it("names a --previous file that is not a build record", async () => {
    const root = game();
    for (const body of ["{ not json", "{}", "null"]) {
      const previous = addFile(root, "last-release.json", body);
      const result = rule(
        await runCheck({ root, target: "ios", release: true, previous }),
        "same app id as the last release",
      );
      expect([body, result.detail]).toEqual([
        body,
        `${previous} is not a build record.`,
      ]);
      expect(result.fix).toBe(
        "Point --previous at the build record of the last release.",
      );
    }
  });

  it("writes nothing", async () => {
    const root = game();
    const before = snapshot(root);
    await runCheck({ root, target: "ios", release: true });
    await runCheck({ root, target: "android", release: true });
    expect(snapshot(root)).toEqual(before);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(
      JSON.stringify(manifest),
    );
  });
});

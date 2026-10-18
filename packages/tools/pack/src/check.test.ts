import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "./check.js";
import { installFuseReader, wire } from "./test/fuses.js";
import { addFile, makeTree, snapshot } from "./test/tree.js";
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

const PBXPROJ = `// !$*UTF8*$!
{
  buildSettings = {
    CURRENT_PROJECT_VERSION = 1;
    MARKETING_VERSION = 1.2.3;
    PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID};
  };
  files = (
    PrivacyInfo.xcprivacy,
  );
}
`;

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
      "ios/App/App.xcodeproj/project.pbxproj": PBXPROJ.replace(
        `PRODUCT_BUNDLE_IDENTIFIER = ${APP_ID}`,
        "PRODUCT_BUNDLE_IDENTIFIER = com.example.old",
      ),
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
      "ios/App/App.xcodeproj/project.pbxproj": PBXPROJ.replace(
        "MARKETING_VERSION = 1.2.3",
        "MARKETING_VERSION = 1.0.0",
      ),
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

    const withoutReference = game({
      "ios/App/App.xcodeproj/project.pbxproj": PBXPROJ.replace(
        "    PrivacyInfo.xcprivacy,\n",
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
    const root = game({ "out/My Game-darwin-arm64/marker": "" });
    installFuseReader(root, "missing");
    const report = await runCheck({ root, target: "electron", release: true });
    expect(rule(report, "archive").fix).toBe(
      "Package with electronForgeConfig(), which sets asar: true.",
    );
    expect(rule(report, "fuses").detail).toContain("no fuse wire");
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

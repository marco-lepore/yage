import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RELEASE_FUSES } from "./fuses.js";
import {
  androidManifest,
  at,
  gradleSetting,
  nativePaths,
  privacyManifest,
  readCopiedConfig,
  xcodeCopiesResource,
  xcodeSetting,
} from "./native.js";
import { readIdentity, WEB_DIRS } from "./project.js";
import type { BuildRecord } from "./record.js";
import type { CheckReport, CheckResult, Target } from "./types.js";

/** The reason the iOS privacy manifest has to declare a file-timestamp use. */
const PRIVACY_CATEGORY = "NSPrivacyAccessedAPICategoryFileTimestamp";
const PRIVACY_REASON = "C617.1";

/** The body the privacy-manifest fix prints. */
const PRIVACY_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>${PRIVACY_CATEGORY}</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>${PRIVACY_REASON}</string>
      </array>
    </dict>
  </array>
</dict>
</plist>`;

/** Settings that turn a build into a development build. */
const DEVELOPMENT_SETTINGS = [
  "server.url",
  "server.cleartext",
  "android.allowMixedContent",
  "android.webContentsDebuggingEnabled",
  "ios.webContentsDebuggingEnabled",
] as const;

export interface CheckOptions {
  /** The game's root. */
  readonly root: string;
  readonly target: Target;
  /** Also run the rules a release has to pass. */
  readonly release: boolean;
  /** A previous release's build record, to compare the identifier with. */
  readonly previous?: string;
  /** Packaged Electron apps to read the fuse wire from. */
  readonly apps?: readonly string[];
}

/**
 * Check that the app's identity and the settings YAGE needs agree across both
 * hosts, and with `release`, that no development setting and no missing
 * native declaration reaches a release. Nothing is written: each failure
 * carries the exact command or setting that fixes it.
 */
export async function runCheck(options: CheckOptions): Promise<CheckReport> {
  const root = path.resolve(options.root);
  const target = options.target;
  const results: CheckResult[] = [];

  const identity = identityRule(root);
  // The rules that compare against the identity run only when it was read:
  // without it they would report a mismatch against an empty value.
  const known = identity.result.ok;
  results.push(identity.result);
  results.push(webBuildRule(root, target));
  results.push(await serviceWorkerRule(root, target));

  // The rules that read the native project, or the configuration `npx cap
  // sync` copies into it, run only once it is there: without it they would
  // report fixes that do not apply.
  let generated = false;
  let synced = false;
  if (target !== "electron") {
    const project = nativeProjectRule(root, target);
    results.push(project);
    generated = project.ok;
    if (generated) {
      const copied = copiedConfigRule(root, target);
      results.push(copied);
      synced = copied.ok;
    }
    if (synced) {
      if (known) results.push(appIdRule(root, target, identity.appId));
      results.push(yageSettingsRule(root, target));
    }
  }

  if (options.release) {
    if (target !== "electron") {
      if (synced) {
        results.push(developmentServerRule(root, target));
        if (target === "android") results.push(credentialsRule(root));
      }
      if (generated) {
        if (known) results.push(versionRule(root, target, identity.version));
        if (target === "ios") results.push(privacyManifestRule(root));
        if (target === "android") results.push(gameCategoryRule(root));
      }
    } else {
      results.push(...(await fuseRules(root, options.apps)));
    }
    if (known && options.previous !== undefined) {
      results.push(previousReleaseRule(options.previous, identity.appId));
    }
  }

  return {
    command: "check",
    target,
    ok: results.every((result) => result.ok),
    results,
  };
}

function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail, fix: null };
}

function fail(name: string, detail: string, fix: string): CheckResult {
  return { name, ok: false, detail, fix };
}

function identityRule(root: string): {
  readonly result: CheckResult;
  readonly appId: string;
  readonly version: string;
} {
  try {
    const identity = readIdentity(root, "check");
    return {
      result: pass(
        "identity",
        `${identity.name} ${identity.version} (${identity.appId}).`,
      ),
      appId: identity.appId,
      version: identity.version,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: fail("identity", message, message),
      appId: "",
      version: "",
    };
  }
}

function webBuildRule(root: string, target: Target): CheckResult {
  const dir = target === "electron" ? WEB_DIRS.electron : WEB_DIRS.capacitor;
  const script = target === "electron" ? "electron" : "capacitor";
  // Inside package:electron and sync:capacitor the build script has just
  // run, so the fix also says when that script writes this directory.
  return existsSync(path.join(root, dir, "index.html"))
    ? pass("web build", `${dir}/index.html is there.`)
    : fail(
        "web build",
        `${dir}/index.html is missing.`,
        `npm run build:${script} writes it when the Vite config maps ` +
          `--mode ${script} to ${dir}/ ("One build per target" in the ` +
          `packaging guide). A config without that mapping builds into dist/.`,
      );
}

async function serviceWorkerRule(
  root: string,
  target: Target,
): Promise<CheckResult> {
  const dir = target === "electron" ? WEB_DIRS.electron : WEB_DIRS.capacitor;
  const full = path.join(root, dir);
  const fix =
    `Leave service-worker registration out of the ${target} build: the app ` +
    `ships its files, and a worker would keep serving old ones after an ` +
    `update. In the templates, VitePWA is registered for the web build only.`;
  if (!existsSync(full)) {
    return pass("no service worker", `${dir} has no build to scan.`);
  }
  const needle = Buffer.from("serviceWorker.register");
  const offenders = listFiles(full).filter((file) =>
    readFileSync(file).includes(needle),
  );
  return offenders.length === 0
    ? pass("no service worker", `No file in ${dir} registers one.`)
    : fail(
        "no service worker",
        `${offenders
          .map((file) => path.relative(full, file))
          .join(", ")} registers a service worker.`,
        fix,
      );
}

function nativeProjectRule(root: string, target: Target): CheckResult {
  const project =
    target === "ios"
      ? path.join(root, "ios", "App", "App.xcodeproj")
      : path.join(root, "android", "app", "build.gradle");
  return existsSync(project)
    ? pass("native project", `${path.relative(root, project)} is there.`)
    : fail(
        "native project",
        `${path.relative(root, project)} is missing.`,
        target === "ios"
          ? "npx cap add ios --packagemanager SPM"
          : "npx cap add android",
      );
}

function copiedConfigRule(root: string, target: Target): CheckResult {
  const config = path.relative(root, nativePaths(root, target).config);
  return existsSync(path.join(root, config))
    ? pass("copied config", `${config} is there.`)
    : fail(
        "copied config",
        `${config} is missing: npx cap sync has not copied the configuration into the ${target} project.`,
        `npx cap sync ${target}`,
      );
}

/** Where a check reads Xcode build settings, for a fix to name. */
const XCODE_SOURCE =
  "The check reads it from the App target's Release configuration in project.pbxproj.";

function appIdRule(root: string, target: Target, appId: string): CheckResult {
  const copied = readCopiedConfig(root, target);
  const inConfig = at(copied, "appId");
  const project = nativePaths(root, target).project;
  const wrong: string[] = [];
  if (inConfig !== appId)
    wrong.push(`the copied config says ${String(inConfig)}`);
  let unreadable = false;
  if (target === "ios") {
    const setting = xcodeSetting(
      project,
      "Release",
      "PRODUCT_BUNDLE_IDENTIFIER",
    );
    if ("unreadable" in setting) {
      unreadable = true;
      wrong.push(
        `the project's PRODUCT_BUNDLE_IDENTIFIER cannot be read, because ${setting.unreadable}`,
      );
    } else if (setting.value !== appId) {
      wrong.push(`the project says ${setting.value}`);
    }
  } else {
    const inProject = gradleSetting(project, "applicationId");
    if (inProject !== appId)
      wrong.push(`the project says ${String(inProject)}`);
  }
  const fix =
    target === "ios"
      ? `Set the bundle identifier of the App target in Xcode (Signing & Capabilities) to ${appId}; npx cap sync never changes it.` +
        (unreadable ? ` ${XCODE_SOURCE}` : "")
      : `Set applicationId and namespace in android/app/build.gradle to ${appId}; npx cap sync never changes it.`;
  return wrong.length === 0
    ? pass("app id in the native project", `The project builds ${appId}.`)
    : fail(
        "app id in the native project",
        `Expected ${appId}, but ${wrong.join(" and ")}.`,
        fix,
      );
}

function yageSettingsRule(root: string, target: Target): CheckResult {
  const copied = readCopiedConfig(root, target);
  const wrong: string[] = [];
  if (at(copied, "ios.contentInset") !== "never") {
    wrong.push("ios.contentInset");
  }
  if (at(copied, "plugins.App.disableBackButtonHandler") === true) {
    wrong.push("plugins.App.disableBackButtonHandler");
  }
  return wrong.length === 0
    ? pass(
        "YAGE settings",
        "The copied configuration carries the settings the adapter needs.",
      )
    : fail(
        "YAGE settings",
        `${wrong.join(" and ")} in the copied configuration.`,
        `Export capacitorConfig() from capacitor.config.ts without overriding ${wrong.join(" or ")}.`,
      );
}

function developmentServerRule(root: string, target: Target): CheckResult {
  const copied = readCopiedConfig(root, target);
  const set = DEVELOPMENT_SETTINGS.filter((key) => {
    const value = at(copied, key);
    return key === "server.url" ? typeof value === "string" : value === true;
  });
  return set.length === 0
    ? pass("no development server", "The app loads the files it ships.")
    : fail(
        "no development server",
        `${set.join(", ")} is set.`,
        `Remove ${set.join(" and ")} from capacitor.config.ts for a release.`,
      );
}

function credentialsRule(root: string): CheckResult {
  const copied = readCopiedConfig(root, "android");
  const set = [
    "android.buildOptions.keystorePassword",
    "android.buildOptions.keystoreAliasPassword",
  ].filter((key) => at(copied, key) !== undefined);
  return set.length === 0
    ? pass(
        "no credentials in the config",
        "The configuration holds no password.",
      )
    : fail(
        "no credentials in the config",
        `${set.join(" and ")} is in the configuration.`,
        "Pass signing passwords on the command line or from the environment: every Capacitor hook script receives the whole config in CAPACITOR_CONFIG.",
      );
}

function versionRule(
  root: string,
  target: Target,
  version: string,
): CheckResult {
  const project = nativePaths(root, target).project;
  let found: string | undefined;
  if (target === "ios") {
    const setting = xcodeSetting(project, "Release", "MARKETING_VERSION");
    if ("unreadable" in setting) {
      return fail(
        "version",
        `MARKETING_VERSION cannot be read, because ${setting.unreadable}.`,
        `Set MARKETING_VERSION of the App target in Xcode to ${version}. ${XCODE_SOURCE}`,
      );
    }
    found = setting.value;
  } else {
    found = gradleSetting(project, "versionName");
  }
  return found === version
    ? pass("version", `The project builds ${version}.`)
    : fail(
        "version",
        `The project builds ${String(found)}, package.json says ${version}.`,
        target === "ios"
          ? `Set MARKETING_VERSION of the App target in Xcode to ${version}.`
          : `Set versionName in android/app/build.gradle to "${version}".`,
      );
}

function privacyManifestRule(root: string): CheckResult {
  const file = privacyManifest(root);
  const declared =
    existsSync(file) &&
    readFileSync(file, "utf8").includes(PRIVACY_CATEGORY) &&
    readFileSync(file, "utf8").includes(PRIVACY_REASON);
  const referenced = xcodeCopiesResource(
    nativePaths(root, "ios").project,
    "PrivacyInfo.xcprivacy",
  );
  const fix =
    `Add ios/App/App/PrivacyInfo.xcprivacy with ${PRIVACY_CATEGORY} and ` +
    `reason ${PRIVACY_REASON} (the @capacitor/filesystem plugin reads file ` +
    `timestamps), then add the file to the App target in Xcode ` +
    `(File > Add Files).\n${PRIVACY_PLIST}`;
  if (declared && referenced) {
    return pass(
      "privacy manifest",
      "The App target carries a privacy manifest declaring file timestamps.",
    );
  }
  return fail(
    "privacy manifest",
    declared
      ? "The privacy manifest is not in the App target's resources."
      : "ios/App/App/PrivacyInfo.xcprivacy is missing or declares nothing.",
    fix,
  );
}

function gameCategoryRule(root: string): CheckResult {
  const file = androidManifest(root);
  const source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const application = /<application\b[^>]*>/.exec(source)?.[0] ?? "";
  return application.includes('android:appCategory="game"')
    ? pass("game category", "The manifest declares the app a game.")
    : fail(
        "game category",
        "The <application> element declares no app category.",
        'Add android:appCategory="game" to the <application> element of android/app/src/main/AndroidManifest.xml.',
      );
}

/** The fuse reader the game installed, loaded from its own node_modules. */
async function loadFuses(root: string): Promise<{
  getCurrentFuseWire: (app: string) => Promise<Record<number, number>>;
  FuseV1Options: Record<string, number>;
  FuseState: { ENABLE: number };
}> {
  const require = createRequire(path.join(root, "package.json"));
  const loaded = (await import(
    pathToFileURL(require.resolve("@electron/fuses")).href
  )) as Record<string, unknown>;
  const api = (
    loaded.getCurrentFuseWire === undefined ? loaded.default : loaded
  ) as {
    getCurrentFuseWire: (app: string) => Promise<Record<number, number>>;
    FuseV1Options: Record<string, number>;
    FuseState: { ENABLE: number };
  };
  return api;
}

async function fuseRules(
  root: string,
  apps: readonly string[] | undefined,
): Promise<CheckResult[]> {
  const packaged = apps ?? defaultPackagedApps(root);
  if (packaged.length === 0) {
    return [
      fail(
        "fuses",
        "No packaged app to read.",
        "Package with electronForgeConfig(), which sets the release fuses.",
      ),
    ];
  }
  const results: CheckResult[] = [];
  for (const app of packaged) {
    const located = locatePackage(app);
    results.push(
      typeof located.fuses === "string"
        ? await fuseRule(root, located.fuses)
        : located.fuses,
    );
    if (located.archives.length > 0) {
      results.push(archiveRule(app, located.archives));
    }
  }
  return results;
}

/** Where the release rules read one packaged app. */
interface LocatedPackage {
  /** The file the fuse wire is read from, or the failure naming none. */
  readonly fuses: string | CheckResult;
  /**
   * The places the package's app.asar can be; none for a path that is
   * missing, which the fuses failure already reports.
   */
  readonly archives: readonly string[];
}

/**
 * Map a packaged app to the file that holds its fuses: a macOS `.app` bundle,
 * which the fuse reader maps to the framework binary inside it; a file named
 * directly, such as the executable of any platform; or the one `.exe` at the
 * top of a Windows package folder. In any other folder, such as a Linux
 * package, nothing tells the executable apart from the other files, so the
 * failure names the route to pass it.
 */
function locatePackage(app: string): LocatedPackage {
  if (!existsSync(app)) {
    return {
      fuses: fail(
        "fuses",
        `${app} is missing.`,
        "Point --app at a packaged app: a .app bundle, a package folder under out/, or the packaged executable.",
      ),
      archives: [],
    };
  }
  if (statSync(app).isFile()) {
    const dir = path.dirname(app);
    return {
      fuses: app,
      // Beside a Windows or Linux executable, or in the bundle around a
      // macOS one (Contents/MacOS/<name>).
      archives: [
        path.join(dir, "resources", "app.asar"),
        path.join(dir, "..", "Resources", "app.asar"),
      ],
    };
  }
  const child = readdirSync(app).find((entry) => entry.endsWith(".app"));
  const bundle =
    path.extname(app) === ".app"
      ? app
      : child === undefined
        ? undefined
        : path.join(app, child);
  if (bundle !== undefined) {
    return {
      fuses: bundle,
      archives: [path.join(bundle, "Contents", "Resources", "app.asar")],
    };
  }
  const archive = path.join(app, "resources", "app.asar");
  const executables = readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const only = executables.length === 1 ? executables[0] : undefined;
  if (existsSync(archive) && only !== undefined) {
    return { fuses: path.join(app, only), archives: [archive] };
  }
  const found = [
    "no .app bundle",
    executables.length === 0
      ? "no .exe file at its top level"
      : `${executables.length === 1 ? "one .exe file" : `${executables.length} .exe files`} at its top level (${executables.join(", ")})`,
    ...(existsSync(archive) ? [] : ["no resources/app.asar"]),
  ];
  return {
    fuses: fail(
      "fuses",
      `${app} holds ${listed(found)}. The fuses are read from a macOS .app ` +
        "bundle, or from the one .exe beside resources/app.asar in a Windows package.",
      "Name the executable that holds the fuses: yage-pack check --target electron --release --app <path to the executable>.",
    ),
    archives: [archive],
  };
}

/** Items joined with commas and a final "and". */
function listed(items: readonly string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] as string}`;
}

async function fuseRule(root: string, file: string): Promise<CheckResult> {
  const { getCurrentFuseWire, FuseV1Options, FuseState } =
    await loadFuses(root);
  let wire: Record<number, number>;
  try {
    wire = await getCurrentFuseWire(file);
  } catch (error) {
    return fail(
      "fuses",
      `${file} has no fuse wire: ${error instanceof Error ? error.message : String(error)}.`,
      "Package with electronForgeConfig(), which sets the release fuses.",
    );
  }
  const wrong: string[] = [];
  for (const [name, wanted] of Object.entries(RELEASE_FUSES)) {
    const state = wire[FuseV1Options[name] as number];
    const on = state === FuseState.ENABLE;
    if (on !== wanted) {
      wrong.push(
        `The packaged app has ${name} ${on ? "on" : "off"}: remove the plugin or packager setting that changes it.`,
      );
    }
  }
  return wrong.length === 0
    ? pass("fuses", `${path.basename(file)} carries the release fuses.`)
    : fail(
        "fuses",
        `${wrong.length} fuse(s) differ in ${file}.`,
        wrong.join("\n"),
      );
}

function archiveRule(app: string, archives: readonly string[]): CheckResult {
  return archives.some((file) => existsSync(file))
    ? pass("archive", `${path.basename(app)} ships an archive.`)
    : fail(
        "archive",
        `${app} holds no app.asar.`,
        "Package with electronForgeConfig(), which sets asar: true.",
      );
}

/** The packaged apps a Forge run leaves under `out/`. */
function defaultPackagedApps(root: string): string[] {
  const out = path.join(root, "out");
  if (!existsSync(out)) return [];
  return readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.split("-").length >= 3)
    .map((entry) => path.join(out, entry.name));
}

function previousReleaseRule(previous: string, appId: string): CheckResult {
  const name = "same app id as the last release";
  if (!existsSync(previous)) {
    return fail(
      name,
      `${previous} is missing.`,
      `Point --previous at the build record of the last release.`,
    );
  }
  const notRecord = fail(
    name,
    `${previous} is not a build record.`,
    `Point --previous at the build record of the last release.`,
  );
  let record: Partial<BuildRecord> | null;
  try {
    record = JSON.parse(
      readFileSync(previous, "utf8"),
    ) as Partial<BuildRecord> | null;
  } catch {
    return notRecord;
  }
  const old = record?.app?.appId;
  if (record?.schema !== 1 || typeof old !== "string") return notRecord;
  return old === appId
    ? pass(name, `The last release was ${old}.`)
    : fail(
        name,
        `The last release was ${old}, this one is ${appId}.`,
        `The previous release was ${old}. Players' saves stay under the old identifier; restore it in package.json "yage.appId".`,
      );
}

function listFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

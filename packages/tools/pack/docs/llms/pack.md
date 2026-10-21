# @yagejs-tools/pack

Package a YAGE game for desktop with Electron Forge and for mobile with
Capacitor. The vendor commands do the building; this tool adds the four
things they do not do — set the project up once, check the toolchain, check
that the app's identity and YAGE's settings agree across both hosts, and
record what went into a build.

```sh
npm install --save-dev @yagejs-tools/pack
```

## Commands

```
yage-pack init --target <electron|ios|android>... [--app-id <id>] [--name <name>] [--force]
yage-pack doctor [--target <electron|ios|android>]... [--json]
yage-pack check [--target <electron|ios|android>] [--release] [--app <path>]... [--previous <record.json>] [--json]
yage-pack record --target <electron|ios|android> --profile <development|release> --artifact <path>... [--out <file>] [--json]
```

Exit code 0 when every rule passed, 1 on a failed rule or an authored error,
printed as `yage-pack: <message>`. `--json` prints the report
(`CheckReport`, an array of them for `doctor`, or the `BuildRecord`) on
stdout. `-h`/`--help` and `-v`/`--version` are accepted everywhere. `check`
and `record` run for one `--target` and refuse a second one; `--app` belongs
to `check --target electron`.

## Conventions

| What              | Where                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| App name          | `package.json` `productName`                                                            |
| App version       | `package.json` `version`                                                                |
| App identifier    | `package.json` `yage.appId`, matching `^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$` |
| Desktop web build | `dist-electron/`                                                                        |
| Mobile web build  | `dist-capacitor/`                                                                       |
| Browser build     | `dist/`, untouched by this tool                                                         |

The identifier is the one both hosts accept: letters and digits only, at
least two dot-separated parts. It names the Electron save directory and the
mobile bundle, so changing it after a release leaves every player's saves
behind.

## One boot function, one entry per target

A build contains only the adapter it needs, so each target has its own entry
file and all of them call one boot function:

```ts
// src/boot.ts
import { Engine, type Plugin } from "@yagejs/core";

export interface BootOptions {
  readonly hostPlugins: readonly Plugin[];
}

export async function boot(options: BootOptions): Promise<Engine> {
  const engine = new Engine();
  for (const plugin of options.hostPlugins) engine.use(plugin);
  await engine.start();
  return engine;
}
```

`src/main.web.ts` calls `boot({ hostPlugins: [] })`. `yage-pack init` writes
`src/main.electron.ts` and `src/main.capacitor.ts`, which pass
`new ElectronHostPlugin()` and `new CapacitorHostPlugin()`.

With Vite, the mode picks the target:

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const target = mode === "electron" || mode === "capacitor" ? mode : "web";
  return {
    plugins: [
      {
        name: "target-entry",
        transformIndexHtml: {
          order: "pre" as const,
          handler: (html: string) =>
            target === "web"
              ? html
              : html.replace("/src/main.web.ts", `/src/main.${target}.ts`),
        },
      },
    ],
    build: { outDir: target === "web" ? "dist" : `dist-${target}` },
  };
});
```

A native build loads `.env.electron` or `.env.capacitor`, not
`.env.production`: Vite reads the file named after the mode.

## `yage-pack init`

Writes each file once and reports `wrote` or `kept` per file; `--force`
rewrites what it would keep. It validates everything before the first write
and refuses when `src/boot.ts` does not export `boot`, when the target's
host package is not installed, when no identifier is available, or when
`--app-id` differs from an existing `yage.appId`.

| Target           | Files                                                           |
| ---------------- | --------------------------------------------------------------- |
| `electron`       | `src/main.electron.ts`, `electron/main.cjs`, `forge.config.cjs` |
| `ios`, `android` | `src/main.capacitor.ts`, `capacitor.config.ts`                  |

It also sets `productName`, `yage.appId` and `main` when they are absent,
appends `dist-electron`, `out` and `dist-capacitor` to `.gitignore`, and
adds these scripts:

| Script                 | Command                                            |
| ---------------------- | -------------------------------------------------- |
| `build:electron`       | `tsc --noEmit && vite build --mode electron`       |
| `start:electron`       | `npm run build:electron && electron-forge start`   |
| `package:electron`     | `npm run build:electron && electron-forge package` |
| `make:electron`        | `npm run build:electron && electron-forge make`    |
| `build:capacitor`      | `tsc --noEmit && vite build --mode capacitor`      |
| `sync:capacitor`       | `npm run build:capacitor && cap sync`              |
| `capacitor:sync:after` | `npx yage-pack check`                              |

The type check is left out when the project has no TypeScript, and the build
scripts are left out when it does not use Vite; the report then names the
`build:electron` or `build:capacitor` script the game has to add, the
directory it writes, and the scripts that run it.

## Ownership

| Path                                                                                                                                                                          | Written by                 | Afterwards                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| `src/boot.ts`, `src/main.web.ts`, `index.html`, `vite.config.ts`                                                                                                              | `create-yage`, or you      | yours                                     |
| `src/main.electron.ts`, `src/main.capacitor.ts`, `electron/main.cjs`, `forge.config.cjs`, `capacitor.config.ts`, the npm scripts                                              | `yage-pack init`, once     | yours                                     |
| `ios/`, `android/`                                                                                                                                                            | `npx cap add`              | yours: commit them; YAGE never edits them |
| `ios/App/App/public`, the copied `capacitor.config.json` files, `ios/App/CapApp-SPM/Package.swift`, `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle` | `npx cap sync`, every time | regenerated from your config and plugins  |
| `dist/`, `dist-electron/`, `dist-capacitor/`, `out/`, `out/yage-build-*.json`                                                                                                 | the builds                 | regenerated; ignored by git               |

## `electronForgeConfig(options?)`

```ts
import type {
  ForgeConfig,
  ForgePackagerOptions,
} from "@electron-forge/shared-types";

interface ElectronForgeOptions {
  readonly root?: string;
  readonly packagerConfig?: Omit<
    ForgePackagerOptions,
    "asar" | "appBundleId" | "ignore"
  >;
  readonly makers?: ForgeConfig["makers"];
  readonly plugins?: ForgeConfig["plugins"];
  readonly hooks?: ForgeConfig["hooks"];
  readonly include?: readonly string[];
  readonly runtimeDependencies?: readonly string[];
}

declare function electronForgeConfig(
  options?: ElectronForgeOptions,
): ForgeConfig;
```

```js
// forge.config.cjs
const { electronForgeConfig } = require("@yagejs-tools/pack/forge");

module.exports = electronForgeConfig();
```

It owns `packagerConfig.asar`, `packagerConfig.appBundleId` and
`packagerConfig.ignore`, adds the fuses plugin, and adds three hooks:
`prePackage` runs the contract check, `postPackage` runs the release check
and writes the build record to `<outDir>/yage-build-electron.json`, and
`postMake` adds the installer artifacts to that record. Setting an owned
`packagerConfig` key throws at config load. Everything else passes through,
and the game's own hooks run after YAGE's with the same arguments. `plugins`
run after the fuses plugin. `makers` replaces the default, a ZIP maker for
`darwin` and `win32`.

The archive holds `package.json`, the directory of the `main` script,
`dist-electron/`, each `include` path and the production-dependency closure
of `@yagejs/host-electron` plus any `runtimeDependencies`. Nothing else.

`RELEASE_FUSES` is the set every package carries:

| Fuse                                    | Value |
| --------------------------------------- | ----- |
| `RunAsNode`                             | off   |
| `EnableCookieEncryption`                | on    |
| `EnableNodeOptionsEnvironmentVariable`  | off   |
| `EnableNodeCliInspectArguments`         | off   |
| `EnableEmbeddedAsarIntegrityValidation` | on    |
| `OnlyLoadAppFromAsar`                   | on    |
| `GrantFileProtocolExtraPrivileges`      | off   |

A packaged app therefore ignores `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and
`--inspect`, and refuses to start when its archive has changed. A test
driver cannot attach to it: check a packaged app by running it and reading
what it writes. `electron-forge start` runs unpackaged, with developer tools
on.

## `capacitorConfig(overrides?)`

```ts
import type { CapacitorConfig } from "@capacitor/cli";

declare function capacitorConfig(overrides?: CapacitorConfig): CapacitorConfig;
```

```ts
// capacitor.config.ts
import { capacitorConfig } from "@yagejs-tools/pack/capacitor";

export default capacitorConfig();
```

It sets `appId`, `appName`, `webDir` and `ios.contentInset: "never"`, and
keeps `plugins.App.disableBackButtonHandler` unset. Overriding any of them
throws at config load: the web view draws edge to edge and the page's CSS
pads for the safe areas, and with the Back handler disabled no Back press
reaches the game. Every other setting passes through unchecked.

## `yage-pack doctor`

Checks what each target's build needs and installs nothing. With no
`--target` it checks every target whose host package and platform package
are installed.

| Rule                           | Targets   | Passes when                                                                                                                        |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `node`                         | all       | Node 22.13.0 or later for `electron`, 22.12.0 for the mobile targets                                                               |
| `packages`                     | all       | every package the target's build needs is installed                                                                                |
| `host package in dependencies` | all       | the host adapter is a runtime dependency, not a development one                                                                    |
| `peer versions`                | all       | each package the host adapter declares is installed at a version it accepts, and each Capacitor plugin is listed in `dependencies` |
| `pixi.js`                      | all       | exactly one copy is installed, at 8.22.0 or later                                                                                  |
| `macOS`                        | `ios`     | the machine runs macOS                                                                                                             |
| `Xcode`                        | `ios`     | the selected developer directory is an Xcode, at 15.0 or later                                                                     |
| `Xcode first launch`           | `ios`     | `xcodebuild -checkFirstLaunchStatus` succeeds                                                                                      |
| `iOS simulator`                | `ios`     | an iOS runtime is available                                                                                                        |
| `JDK`                          | `android` | Java 21 or later answers                                                                                                           |
| `Android SDK`                  | `android` | `ANDROID_HOME` or `ANDROID_SDK_ROOT` holds the platform the project compiles against and a build-tools entry                       |

`Xcode first launch` and `iOS simulator` run only when `Xcode` passed,
because both go through the selected developer directory. Each failure
carries the exact command or setting that fixes it. Set `DEVELOPER_DIR` for
one command rather than changing the machine's selected toolchain.

## `yage-pack check`

Contract rules run every time, so they gate every `npx cap sync` through the
sync hook and every Forge package through `prePackage`.

| Rule                           | Targets          | Passes when                                                                                           |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `identity`                     | all              | `productName`, `version` and `yage.appId` are set and valid                                           |
| `web build`                    | all              | the target's web directory holds an `index.html`                                                      |
| `no service worker`            | all              | no file in it registers a service worker                                                              |
| `native project`               | `ios`, `android` | `npx cap add` has generated it                                                                        |
| `app id in the native project` | `ios`, `android` | the copied config, and `PRODUCT_BUNDLE_IDENTIFIER` or `applicationId`, equal `yage.appId`             |
| `YAGE settings`                | `ios`, `android` | the copied config has `ios.contentInset: "never"` and no `plugins.App.disableBackButtonHandler: true` |

`npx cap add` writes the bundle identifier into the native project once and
`npx cap sync` never updates it, which is why the check compares them and
names the Xcode or Gradle setting to change.

Release rules run with `--release`:

| Rule                              | Targets                | Passes when                                                                                                                                  |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `no development server`           | `ios`, `android`       | the copied config sets no `server.url`, `server.cleartext`, `android.allowMixedContent` or web-contents debugging                            |
| `no credentials in the config`    | `android`              | no keystore password is in the config; every hook script receives the whole config in `CAPACITOR_CONFIG`                                     |
| `version`                         | `ios`, `android`       | `MARKETING_VERSION` or `versionName` equals `package.json` `version`                                                                         |
| `privacy manifest`                | `ios`                  | `ios/App/App/PrivacyInfo.xcprivacy` declares `NSPrivacyAccessedAPICategoryFileTimestamp` with reason `C617.1`, and the App target carries it |
| `game category`                   | `android`              | the `<application>` element has `android:appCategory="game"`                                                                                 |
| `fuses`                           | `electron`             | each packaged app carries `RELEASE_FUSES`                                                                                                    |
| `archive`                         | `electron`             | each packaged app ships an `app.asar`                                                                                                        |
| `same app id as the last release` | all, with `--previous` | the identifier matches the previous release's record                                                                                         |

On the Capacitor side `--release` is an explicit call before a release
native build: no vendor hook covers an Xcode or Gradle build. On the
Electron side it runs on every package.

`check` never edits a file. Inside the Capacitor sync hook the target comes
from `CAPACITOR_PLATFORM_NAME`; the hook also runs for the browser platform,
which has no rules.

## `yage-pack record`

Writes a JSON record of what went into a build, by default to
`out/yage-build-<target>.json`.

```ts
import type { HashedFile } from "@yagejs-tools/pack";

type ArtifactKind =
  | "electron-app"
  | "electron-zip"
  | "ios-simulator-app"
  | "ios-app"
  | "ios-archive"
  | "ios-ipa"
  | "android-apk"
  | "android-aab";

interface BuildArtifact {
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly isDirectory: boolean;
  readonly bytes: number;
  readonly sha256: string;
  readonly signed: "signed" | "ad-hoc" | "unsigned" | "unknown";
}

interface BuildRecord {
  readonly schema: 1;
  readonly createdAt: string;
  readonly target: "electron" | "ios" | "android";
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
```

`app.build` is `CURRENT_PROJECT_VERSION` on iOS and `versionCode` on
Android, `null` for Electron. An `--out` that exists has to be a record of
the same shape, so a mistyped path cannot overwrite a file the build needs.

## `hashDirectory(dir)`

```ts
interface HashedFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface HashedDirectory {
  readonly files: readonly HashedFile[];
  readonly digest: string;
}

declare function hashDirectory(dir: string): Promise<HashedDirectory>;
```

Every file under `dir`, sorted by its path with `/` separators; the digest
is the hash of the lines `"<sha256>  <path>"` joined with newlines. A
symbolic link leaving the directory is refused.

`REQUIRED_PACKAGES` names the packages each target's build needs, by the
`package.json` section they belong in.

## Profiles

An Electron build takes its profile from `app.isPackaged`: a packaged app is
a release, `electron-forge start` is development. A mobile build takes it
from `Capacitor.DEBUG`: `capacitorSaveAdapter()` saves under `development` in
a Debug build and under `release` otherwise, unless the game passes a
`profile`. The profile names the save directory, so builds with different
profiles never share saves. A Debug build and a Release build of one mobile
app install into one app container, and the two default profiles keep their
saves apart.

## Upgrading

Update the `@yagejs/*` packages together, bring `electron` and the
`@capacitor/*` packages to the ranges the host adapters declare, then run
`npx yage-pack doctor`. YAGE's own packaging settings arrive with this
package, because the two configuration files call into it rather than
holding a copy.

## Errors

Every failure names the input:

- `readIdentity`: no `package.json`, a missing `productName`, a `yage.appId`
  that does not match the pattern, or a missing `version`.
- `electronForgeConfig`: an owned `packagerConfig` key, a `main` that names
  no file, an `include` path outside the game, a runtime dependency that is
  not installed.
- `capacitorConfig`: an owned key, an `ios.contentInset` other than
  `"never"`, `plugins.App.disableBackButtonHandler: true`.
- `yage-pack init`: no `package.json`, an unknown `--target`, a missing
  `src/boot.ts` boot function, an uninstalled host package, a missing or
  mismatched `--app-id`, a missing display name, a path that is a directory.
- `record`: an artifact the target cannot have produced, an `--out` that is
  not a record.

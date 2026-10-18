# @yagejs/host-capacitor

Depends on `@yagejs/core` and `@yagejs/save`; `@capacitor/core`,
`@capacitor/app`, `@capacitor/filesystem` and `@capacitor/screen-orientation`
are peer dependencies. Runs a YAGE game as a mobile app: the app's state
reaches the engine, the game locks the screen orientation, the Android Back
button is a key the game binds, and saves are files in the app's private
directory.

Two halves. The **app** is the Capacitor app around the game: its generated
iOS or Android project and its `capacitor.config.json`. The **page** is the
game's web page inside the app's web view. This package runs in the page and
talks to the app through Capacitor's official plugins.

## Install

```sh
npm install @yagejs/host-capacitor
npm install @capacitor/core @capacitor/app @capacitor/filesystem @capacitor/screen-orientation
```

The four `@capacitor/*` packages belong to the app's own `dependencies`:
`npx cap sync` installs the native half of the plugins the app itself names,
and a plugin that arrives only as another package's dependency has no native
half. A missing plugin stops the start with a message naming the package to
add.

## Entry points

| Entry                           | Exports                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@yagejs/host-capacitor`        | `CapacitorHostPlugin`, `capacitorSaveAdapter`, `CapacitorSaveAdapterOptions`, `isCapacitorHost` |
| `@yagejs/host-capacitor/detect` | `isCapacitorHost`                                                                               |

## One entry file per target

Write one boot function for every target and one entry file per target that
passes its host plugins to it. The Capacitor entry installs this package's
plugin and save adapter unconditionally, so a build that reaches a page
outside an app stops with an authored error rather than running as a browser
game.

```ts yage-group="targets" yage-file="boot.ts"
import { Engine } from "@yagejs/core";
import type { Plugin } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { SavePlugin, createSave } from "@yagejs/save";
import type { SaveAdapter } from "@yagejs/save";

export interface BootOptions {
  hostPlugins: readonly Plugin[];
  saveAdapter: SaveAdapter;
}

export async function boot(options: BootOptions): Promise<Engine> {
  const engine = new Engine();
  for (const plugin of options.hostPlugins) engine.use(plugin);
  engine.use(new RendererPlugin({ width: 640, height: 360 }));
  engine.use(
    new SavePlugin({ save: createSave({ adapter: options.saveAdapter }) }),
  );
  await engine.start();
  return engine;
}
```

```ts yage-group="targets" yage-file="main.capacitor.ts"
import {
  CapacitorHostPlugin,
  capacitorSaveAdapter,
} from "@yagejs/host-capacitor";
import { boot } from "./boot.js";

await boot({
  hostPlugins: [new CapacitorHostPlugin()],
  saveAdapter: capacitorSaveAdapter({ profile: "release" }),
});
```

```ts yage-group="targets" yage-file="main.web.ts"
import { localStorageAdapter } from "@yagejs/save";
import { boot } from "./boot.js";

await boot({
  hostPlugins: [],
  saveAdapter: localStorageAdapter({ namespace: "my-game" }),
});
```

One bundle for every target is the other route: `isCapacitorHost()` from
`./detect` imports nothing, so a browser build can ask before it loads the
rest of the package.

```ts yage-group="single-bundle"
import { isCapacitorHost } from "@yagejs/host-capacitor/detect";
import { localStorageAdapter } from "@yagejs/save";
import type { Plugin } from "@yagejs/core";
import type { SaveAdapter } from "@yagejs/save";

let hostPlugins: readonly Plugin[] = [];
let saveAdapter: SaveAdapter = localStorageAdapter({ namespace: "my-game" });
if (isCapacitorHost()) {
  const host = await import("@yagejs/host-capacitor");
  hostPlugins = [new host.CapacitorHostPlugin()];
  saveAdapter = host.capacitorSaveAdapter({ profile: "release" });
}
```

Its drawback: a page outside an app takes the browser branch silently, so a
build that was meant for a phone runs as a browser game and writes its saves
to the browser's storage.

## What the game reads

Evidence: the iOS statements on this page were run on the iOS simulator (an
app switch and the return, one orientation lock, the save files, 20 kills
during a stream of saves). The cases that need a phone (a call, Control
Centre, a notification banner, a system alert) and every Android statement
on this page (lifecycle, Back, the orientation lock, fullscreen, saves) follow
from Capacitor's source code; no run of them is recorded.

`engine.host.info` reports `{ runtime: "capacitor", os, appVersion,
appBuild }`. `os` is `"ios"` or `"android"`; `appVersion` and `appBuild` are
the app's version and build number from the native project, left out when the
project states none. There is no `runtimeVersion`: no runtime call reports
the native Capacitor version.

Branch on capability, never on `host.info`: `renderer.fullscreenSupport`,
`renderer.orientationLockSupport` and the other support values say what this
host can do.

### Lifecycle

| Field        | Source                                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity`   | iOS: the app losing and regaining interaction, which covers a notification banner, Control Centre and a system alert. Android: the activity pausing and resuming, which covers a permission dialog. |
| `visibility` | iOS: the window leaving and coming back. Android: the activity being stopped and started.                                                                                                           |
| `focus`      | The page's own, as in a browser.                                                                                                                                                                    |

`host.active` is `false` while any of the three says the player is away, so
scenes with `scenes.autoPause` and audio with `audio.autoPause` stop when the
player takes a call and start again on the return.

The app's activity is read once at start. Visibility comes from the page until
the first native event, and from the app after it.

### Fullscreen and orientation

`renderer.orientationLockSupport` is `"supported"` on both systems.
`renderer.lockOrientation(lock)` asks the app for the lock and resolves with
the orientation the page reads once the screen has turned, or after 2000 ms
when the system turns nothing. Compare the result with what the game asked
for: an orientation the iOS project does not list, and a large Android screen
on Android 16 with target SDK 36, settle unturned.

`renderer.fullscreenSupport` is `"unsupported"` in an Android web view, which
leaves element fullscreen in the call that enters it. On iOS it is the page's
own answer. A game offers a fullscreen button only where the support value
says it does something.

Safe areas are the page's: the app draws its web view edge to edge, and the
page's CSS pads the element the game is fitted into with
`env(safe-area-inset-*)`.

### The Android Back button

A press arrives as the key `"BrowserBack"`, so a game binds it like any other
key:

```ts yage-group="back"
import { InputPlugin } from "@yagejs/input";

const input = new InputPlugin({
  actions: { back: ["Escape", "BrowserBack"] },
});
```

With no action bound to the key, a press moves the app to the background and
leaves the game where it was, which is what Android itself does at the root
of an app. A key held by a disabled action group counts as bound: the press is
delivered and nothing happens. A screen where Back should leave the app
unbinds the key there with `input.unbindKey("back", "BrowserBack")`.

iOS has no Back button, and the app's own `disableBackButtonHandler` setting
stays unset: with it set, no press reaches the game.

### Saves

`capacitorSaveAdapter({ profile })` writes each key as a file under
`Library/yage-saves/<profile>` in the app's private directory, which iOS
includes in its backup and the Files app does not show. The directory follows
the app's bundle identifier, so renaming the app leaves the saves where they
are, and the two build profiles never mix.

The algorithm is `fileAdapter` from `@yagejs/save`: a shadow file and a
checksum, so an interrupted write leaves the previous value or the new one
readable. A write that resolved is held when the system kills the app. Neither
system's write reaches the storage hardware, so a power loss is not
guaranteed. Keys are at most 96 bytes in UTF-8.

`profile` matches `^[a-z][a-z0-9-]*$`; any other value throws at the call.

## Settings the app has to carry

| Setting                        | Value                                            |
| ------------------------------ | ------------------------------------------------ |
| `ios.contentInset`             | `"never"`, so the page owns its safe areas       |
| `App.disableBackButtonHandler` | unset, so Back reaches the game                  |
| The four plugin packages       | in the app's `dependencies`, then `npx cap sync` |

## Errors

Each is thrown at the call, before anything attaches:

- `CapacitorHostPlugin.install: this page is not running inside a Capacitor app. Leave this plugin out of a browser build.`
- `CapacitorHostPlugin.install: this adapter runs on Capacitor's ios and android platforms, got <value>.`
- `CapacitorHostPlugin.install: the <package> plugin is not in this app. Add "<package>" to the app's package.json dependencies and run npx cap sync.`
- `capacitorSaveAdapter: this page is not running inside a Capacitor app. Leave this adapter out of a browser build.`
- `capacitorSaveAdapter: profile must match ^[a-z][a-z0-9-]*$, got <value>.`

A fullscreen request on Android rejects with `CapacitorHostPlugin: an Android
web view in a Capacitor app cannot present the game fullscreen.`, which a game
that reads `renderer.fullscreenSupport` never reaches.

## Building the native projects

The Capacitor CLI generates and synchronizes them:

```sh
npx cap add ios --packagemanager SPM
npx cap add android
npx cap sync
```

Every plugin this package uses ships a `Package.swift`, so an iOS project
needs no other dependency manager.

If Xcode stops at a GitHub credential prompt while it resolves a Swift
package, add `-packageAuthorizationProvider netrc` to the `xcodebuild` call.

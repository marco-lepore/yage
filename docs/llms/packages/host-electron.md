# @yagejs/host-electron

Depends on `@yagejs/core` and `@yagejs/save`; `electron` is a peer dependency
at `^44.7.0`. Runs a YAGE game as a desktop app: the window's state reaches
the engine, fullscreen is the window's, and saves are
files in the app's data directory.

Two halves. The **shell** is the Electron app around the game: its main
script, its preload script and its window. The **page** is the game's web page
inside that window. The package holds both, plus the bridge between them.

## Install

```sh
npm install @yagejs/host-electron
npm install --save-dev electron@^44.7.0
```

## Entry points

| Entry                           | Runs in            | Exports                                                                                                                      |
| ------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `@yagejs/host-electron`         | the page           | `ElectronHostPlugin`, `electronSaveAdapter`, `isElectronHost`, `HOST_BRIDGE_PROTOCOL`                                        |
| `@yagejs/host-electron/detect`  | the page           | `isElectronHost`                                                                                                             |
| `@yagejs/host-electron/main`    | the main process   | `startGame`, `GameShellOptions`, `DEFAULT_CONTENT_SECURITY_POLICY`, `nodeFileStore`, `saveDirectory`, `SaveDirectoryOptions` |
| `@yagejs/host-electron/preload` | the preload script | nothing; it exposes the bridge                                                                                               |

## One entry file per target

Write one boot function for every target and one entry file per target that
passes its host plugins to it. The Electron entry installs this package's
plugin and save adapter unconditionally, so a build that reaches a page
without the shell stops at `engine.start()` with an authored error rather
than running as a browser game.

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

```ts yage-group="targets" yage-file="main.electron.ts"
import { ElectronHostPlugin, electronSaveAdapter } from "@yagejs/host-electron";
import { boot } from "./boot.js";

await boot({
  hostPlugins: [new ElectronHostPlugin()],
  saveAdapter: electronSaveAdapter(),
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

One bundle for every target is the other route: `isElectronHost()` from
`./detect` imports nothing, so a browser build can ask before it loads the
rest of the package.

```ts yage-group="single-bundle"
import { isElectronHost } from "@yagejs/host-electron/detect";
import { localStorageAdapter } from "@yagejs/save";
import type { Plugin } from "@yagejs/core";
import type { SaveAdapter } from "@yagejs/save";

let hostPlugins: readonly Plugin[] = [];
let saveAdapter: SaveAdapter = localStorageAdapter({ namespace: "my-game" });
if (isElectronHost()) {
  const host = await import("@yagejs/host-electron");
  hostPlugins = [new host.ElectronHostPlugin()];
  saveAdapter = host.electronSaveAdapter();
}
```

Its drawback: a shell whose preload script failed to load looks like a
browser to the predicate, so the game starts anyway and writes its saves to
the browser's storage.

## The shell's main script

```ts yage-group="shell"
import { app } from "electron";
import { join } from "node:path";
import { startGame } from "@yagejs/host-electron/main";

startGame({
  webDir: join(app.getAppPath(), "dist-electron"),
  appId: "dev.example.mygame",
  // A packaged app is a release; electron-forge start runs unpackaged.
  profile: app.isPackaged ? "release" : "development",
  devTools: !app.isPackaged,
  externalLinks: ["https://example.dev/", "mailto:support@example.dev"],
  window: { width: 1280, height: 720, title: "My Game" },
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
```

`startGame` is called once, at the top of the main script, before the app is
ready: it registers the scheme the page is served from before it returns, and
Electron accepts that registration only before the app is ready. A shell must
not call `protocol.registerSchemesAsPrivileged` itself: Electron accepts one
registration, and `startGame` makes it.

It resolves with the `BrowserWindow` once the page has loaded, so a shell can
add its own menu or listeners to it. Every failure rejects the returned
promise, an invalid option included, so the shell's `catch` handles each one.

The window loads the preload script from the directory the main entry was
loaded from, so `preload.cjs`, `main.js` and `main.cjs` stay together in the
installed package. `npx yage-pack init --target electron` writes this script
and a Forge configuration that keeps that directory in the archive; see
`/llms/tools/pack.md`.

### `GameShellOptions`

| Option                  | Default                           | Meaning                                                                                                                                           |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webDir`                | required                          | Absolute path of the built web directory, which may lie inside an archive. It must hold an `index.html`.                                          |
| `appId`                 | required                          | The app's stable identifier, matching `^[A-Za-z0-9][A-Za-z0-9.-]*$`. Names the save directory.                                                    |
| `profile`               | required                          | The build profile, matching `^[a-z][a-z0-9-]*$`. Test and release saves never mix.                                                                |
| `window`                | Electron's defaults               | Size, title and look. Web preferences, `show` and `simpleFullscreen` stay the shell's.                                                            |
| `externalLinks`         | none                              | Links `window.open` may open outside the app: an `http` or `https` site path, or a `mailto` address. See [Links](#links-closing-and-permissions). |
| `permissions`           | none                              | Permission names granted beyond fullscreen, pointer lock, keyboard lock and clipboard writes.                                                     |
| `contentSecurityPolicy` | `DEFAULT_CONTENT_SECURITY_POLICY` | Replaces the policy every response carries.                                                                                                       |
| `devTools`              | `false`                           | Developer tools and Electron's default menu.                                                                                                      |
| `query`                 | `""`                              | Appended to the page's URL; empty or starting with `?`.                                                                                           |

Each invalid option rejects the returned promise with an error naming the
option and the value, before anything is registered.

## The content security policy

`DEFAULT_CONTENT_SECURITY_POLICY` is sent with every response of the `yage`
protocol:

```text
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

It allows the engine what the engine uses: WebAssembly for physics and
layout, a worker from a blob for image decoding, a `data:` fetch for the
layout library's bundled WebAssembly, and inline style for the canvas and the
element that reports the scene to a screen reader. `script-src` has no
`'unsafe-eval'`, so no script can turn a string into code; `RendererPlugin`
loads PixiJS's prebuilt shader and uniform code by itself on such a page.

Pass `contentSecurityPolicy` to replace it when the game loads anything from
another origin, or when it asks for WebGPU and uses `motionBlur` from
`@yagejs/effects`: under a policy without `'unsafe-eval'`, PixiJS on WebGPU
writes integer uniforms as floats and that filter draws nothing. WebGL, which
the renderer asks for first, draws it.

## What the game reads

`engine.host.info` reports `{ runtime: "electron", os, appVersion,
runtimeVersion }`. `os` is `"macos"`, `"windows"` or `"linux"`, and
`"unknown"` on any other system; `appVersion`
is the version in the shell directory's `package.json`; `runtimeVersion` is
Electron's own version. There is no `appBuild`: Electron has no build number.

Branch on capability, never on `host.info`: `renderer.fullscreenSupport`,
`renderer.orientationLockSupport` and the other support values say what this
host can do.

### Lifecycle

| Field        | Source                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity`   | `powerMonitor`: `"inactive"` while the screen is locked or the machine suspended, `"active"` once neither holds. `"unknown"` until one of those events arrives, because nothing reports the lock state at launch. |
| `visibility` | `"visible"` while the window is shown and not minimised. The page's own visibility is not used: it stays `"visible"` behind a minimised window.                                                                   |
| `focus`      | The window's keyboard focus.                                                                                                                                                                                      |

`host.active` is `false` while the window is unfocused. A desktop game that
should keep running behind another window sets
`engine.host.activeWhenUnfocused = true`.

A window the player covers with another window still reads `"visible"`:
Electron reports no occlusion.

### Fullscreen

`renderer.isFullscreen` is the window's state, whatever started it: the menu,
the system button, or `renderer.requestFullscreen()`. Each request resolves
once the window reports the change, or rejects after 3000 ms with
`ElectronHostPlugin: the window did not enter fullscreen within 3000 ms.`
Electron reports no refusal, so the bound is how a request that the system
ignored ends.

Escape does not leave a window fullscreen on macOS. A game that wants it binds
Escape to `renderer.exitFullscreen()`.

`renderer.orientationLockSupport` is `"unsupported"`: a desktop window cannot
lock the screen orientation.

### Saves

`electronSaveAdapter()` writes each key as a file under
`<appData>/<appId>/saves/<profile>`. The directory follows `appId`, not the
app's display name, so renaming the app leaves the saves where they are. On
macOS each write reaches the drive before it resolves, so a save that resolved
survives a power cut.

The algorithm runs in the main process, over `fileAdapter` from
`@yagejs/save`: a shadow file and a checksum, so an interrupted write leaves
the previous value or the new one readable. Keys are at most 96 bytes in
UTF-8, and one value at most 67,108,864 UTF-16 code units.

Main-process code reaches the same files directly:

```ts yage-group="shell-saves"
import { fileAdapter } from "@yagejs/save";
import { nodeFileStore, saveDirectory } from "@yagejs/host-electron/main";

const directory = saveDirectory({
  appId: "dev.example.mygame",
  profile: "release",
});
const adapter = fileAdapter({ store: nodeFileStore(directory) });
const stored = await adapter.list("");
```

One app runs one copy: `startGame` takes Electron's single-instance lock, and
a second launch quits at once while the first window comes forward. Two main
processes would write the same save directory out of order.

### Links, closing and permissions

A game opens a link with `window.open(url)`. The shell opens no window of its
own, and the game page never leaves `yage://game`. When one of `externalLinks`
allows the URL, the shell passes it to the system browser or mail client:

| Entry                          | Allows                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `"https://example.dev"`        | every URL with the origin `https://example.dev`                         |
| `"https://example.dev/docs"`   | `/docs` and the paths under it by whole segments, never `/docs-private` |
| `"mailto:support@example.dev"` | that address exactly, with no query: no second recipient, `cc` or `bcc` |

An `http` or `https` entry matches a URL with the same scheme, host and port
whose path is the entry's path or lies under it. `/docs` and `/docs/` are the
same entry, and the URL may carry any query or hash. `startGame` parses each
entry with `URL`, so `https://Example.dev/` and `https://example.dev:443/`
name the same origin. `startGame` rejects, naming the entry, when an `http` or
`https` entry holds a user name, a password, a query or a hash, when an entry
is a bare `"mailto:"`, and when a `mailto` entry holds a query:
`startGame: externalLinks[0] must not hold a query or a hash, got "https://example.dev/?from=game".`

A game's Quit button calls `window.close()`, which closes the window and ends
the app. A browser tab ignores `window.close()`, so a game shows Quit only in
the build its Electron entry starts.

The page is granted what a browser tab grants without a prompt: `fullscreen`,
`pointerLock`, `keyboardLock` and `clipboard-sanitized-write`, plus every name
in `permissions`. Everything else is denied, including a request from any page
but the game's. A camera or microphone is `media`: declare it, and expect the
operating system's own prompt and its usage text in the packaged app.

Audio starts without a user gesture: Electron's autoplay policy asks for none.

## Development and release

The script `init` writes takes both from `app.isPackaged`: a packaged app is a
release with developer tools off, and `electron-forge start` is development
with them on.

`devTools` sets the developer tools and the menu. With `devTools: false`, the
window opens no developer tools and the application menu holds Quit, the
text-field commands and the window commands on macOS, and nothing elsewhere.
With `devTools: true`, Electron's default menu stays, which offers Reload and
Toggle Developer Tools.

`devTools: false` does not close every route into the page. Chromium's
`--remote-debugging-port` and `--remote-debugging-pipe` switches let another
program inspect and control it, and no fuse turns them off. A packaged app
(`app.isPackaged`) started with either switch does not load the game:
`startGame` rejects before it registers anything, and opens no window.

```text
startGame: a packaged app does not load the game when started with --remote-debugging-port, which lets another program control the page. Start the app without it, or debug the game unpackaged.
```

Chromium may already have opened the port by then, so the refusal stops the
game from loading, not the port from opening. An unpackaged app accepts both
switches.

The policy, the permissions, the bridge and the saves are the same in both.
Saves differ only through `profile`.

## The bridge and its protocol

`@yagejs/host-electron/preload` exposes one frozen object as
`window.__yageHost__` with a fixed table of operations and the constant
`HOST_BRIDGE_PROTOCOL` as its `protocol`. Nothing generic crosses: no channel
name, no event object, no Node module. The main process checks every request's
sender and every argument before it touches a file or the window.

The number goes up by one with any change to an operation, an argument or a
payload. Each page entry checks it first and throws one of three errors:

- `ElectronHostPlugin.install: no YAGE host bridge on this page. Load the game in a shell that runs the @yagejs/host-electron preload script, or leave this plugin out of a browser build.`
- `ElectronHostPlugin.install: the shell's host bridge reports protocol <value>, expected a positive integer.`
- `ElectronHostPlugin.install: the shell speaks host bridge protocol <shell> and this game was built with protocol <page>. Build the shell and the game with the same @yagejs/host-electron version.`

`electronSaveAdapter` throws the same three with its own name. The check runs
before anything attaches, so `engine.start()` rejects and the engine is
terminal.

An `ElectronHostPlugin` belongs to one engine: installing an instance whose
engine was destroyed throws `ElectronHostPlugin.install: this instance belongs to a destroyed engine. Construct a new ElectronHostPlugin for each engine.`

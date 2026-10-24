# @yagejs/host-capacitor

Run a [YAGE](https://yage.dev) game as a mobile app: the app's state reaches
the engine, the game locks the screen orientation, the Android Back button is
a key the game binds, and saves are files in the app's private directory.

```sh
npm install @yagejs/host-capacitor
npm install @capacitor/core @capacitor/app @capacitor/filesystem @capacitor/screen-orientation
```

The four `@capacitor/*` packages belong to the app's own dependencies:
`npx cap sync` installs the native half of the plugins the app itself names.

## The game's Capacitor entry

```ts yage-group="readme-page"
import { Engine } from "@yagejs/core";
import {
  CapacitorHostPlugin,
  capacitorSaveAdapter,
} from "@yagejs/host-capacitor";
import { RendererPlugin } from "@yagejs/renderer";
import { SavePlugin, createSave } from "@yagejs/save";

const engine = new Engine();
engine.use(new CapacitorHostPlugin());
engine.use(new RendererPlugin({ width: 640, height: 360 }));
engine.use(
  new SavePlugin({
    save: createSave({ adapter: capacitorSaveAdapter() }),
  }),
);
await engine.start();
```

This entry builds the page the app loads. A browser build has its own entry
and installs neither the plugin nor the adapter: on a page outside an app,
both throw an error that says to leave them out of a browser build.

`capacitorSaveAdapter()` keeps the saves in a directory named after the build
profile: `development` when the app is a debug build, which sets
`Capacitor.DEBUG`, and `release` otherwise. The iOS simulator sets
`Capacitor.DEBUG` in every build, so a simulator build saves under
`development`. Pass `{ profile }` to name the directory yourself.

The plugin reports the app's identity, whether it is active and whether the
player can see it to `engine.host`, and registers the orientation lock the
renderer performs through `renderer.lockOrientation`.

Every Android behaviour of this package and the default save profile on a
device follow from Capacitor's code and have not been run.

## The Android Back button

A press arrives as the key `"BrowserBack"`, so the game binds it in its action
map:

```ts yage-group="readme-back"
import { InputPlugin } from "@yagejs/input";

const input = new InputPlugin({
  actions: { back: ["Escape", "BrowserBack"] },
});
```

With no action bound to the key, a press moves the app to the background and
leaves the game where it was.

A `capacitor.config.ts` that exports `capacitorConfig()` from
`@yagejs-tools/pack/capacitor` carries the settings this package needs and the
app's identity.

Full reference: the [Mobile with Capacitor](https://yage.dev/guides/capacitor/)
guide, and [Packaging](https://yage.dev/tooling/packaging/).

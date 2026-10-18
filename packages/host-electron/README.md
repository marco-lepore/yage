# @yagejs/host-electron

Run a [YAGE](https://yage.dev) game as a desktop app: the window's state
reaches the engine, fullscreen is the window's, and saves are
files in the app's data directory.

```sh
npm install @yagejs/host-electron
npm install --save-dev electron@^44.7.0
```

## The game's Electron entry

```ts yage-group="readme-page"
import { Engine } from "@yagejs/core";
import { ElectronHostPlugin, electronSaveAdapter } from "@yagejs/host-electron";
import { RendererPlugin } from "@yagejs/renderer";
import { SavePlugin, createSave } from "@yagejs/save";

const engine = new Engine();
engine.use(new ElectronHostPlugin());
engine.use(new RendererPlugin({ width: 640, height: 360 }));
engine.use(
  new SavePlugin({ save: createSave({ adapter: electronSaveAdapter() }) }),
);
await engine.start();
```

The plugin reports the window's identity, activity, visibility and focus to
`engine.host`, and registers the window as the renderer's fullscreen, whatever
started it: the menu, the system button or the game.

## The shell's main script

```ts yage-group="readme-shell"
import { app } from "electron";
import { join } from "node:path";
import { startGame } from "@yagejs/host-electron/main";

startGame({
  webDir: join(app.getAppPath(), "web"),
  appId: "dev.example.mygame",
  profile: "release",
  window: { width: 1280, height: 720, title: "My Game" },
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
```

`startGame` serves the built web directory from `yage://game` under a content
security policy that forbids turning strings into code, grants the page what a
browser tab grants without a prompt, serves the bridge and the save channels
to the game page alone, keeps the app to one copy, and quits when the window
closes.

Full reference: the [Desktop with Electron](https://yage.dev/guides/electron/)
guide.

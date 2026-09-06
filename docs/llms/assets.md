# Assets

YAGE's asset model has three pieces:

- **Asset handles** — typed path refs (`{ type, path }`). Created via plugin factories.
- **`AssetManager`** — engine-owned cache + loader registry. Key: `AssetManagerKey`.
- **`Scene.preload`** — array of handles auto-loaded by `SceneManager` before `onEnter()`.

## Factories

| Factory                 | From               | Returns                                                        |
| ----------------------- | ------------------ | -------------------------------------------------------------- |
| `texture(path, opts?)`  | `@yagejs/renderer` | `TextureHandle`; `opts.scaleMode: "nearest" \| "linear"`       |
| `spritesheet(jsonPath)` | `@yagejs/renderer` | `AssetHandle<Spritesheet>` (atlas JSON references the texture) |
| `renderAsset<T>(path)`  | `@yagejs/renderer` | `RendererAsset<T>` for arbitrary Pixi-managed assets           |
| `sound(path)`           | `@yagejs/audio`    | `AssetHandle<Sound>`                                           |
| `tiledMap(path)`        | `@yagejs/tilemap`  | Handle for parsed `TiledMapData`                               |

A handle is `{ type, path }`. `AssetManager.get(handle)` throws if uncached.

`texture(path, { scaleMode: "nearest" })` makes that one image sample without
smoothing — for a pixel-art sheet in a project that is otherwise smooth. The
setting applies to the loaded image, so every sprite drawing from it samples
the same way. `pixelArtPreset` is the switch for a whole project.

## Per-Scene Preload

```ts yage-group="preload" yage-file="scene.ts"
import { Scene } from "@yagejs/core";
import { texture } from "@yagejs/renderer";
import { sound } from "@yagejs/audio";
import { tiledMap } from "@yagejs/tilemap";

const HeroTex = texture("assets/hero.png");
const CoinSfx = sound("assets/coin.wav");
const Level1Map = tiledMap("assets/levels/1.json");

class GameScene extends Scene {
  readonly name = "game";
  readonly preload = [HeroTex, CoinSfx, Level1Map];
  onEnter() {
    const tex = this.assets.get(HeroTex); // safe — preload finished
  }
}
```

`SceneManager` calls `assets.loadAll(this.preload)` before `onEnter()`, skips already-cached handles, and routes progress to `scene.onProgress(ratio)` if overridden. Throws with a clear message if a loader plugin for the handle's type isn't installed. The `scene:loading:progress` bus event is emitted by `LoadingScene` (which overrides `onProgress` to forward it), not by plain `Scene`.

### Preloading ahead of time

`scenes.preload(scene, onProgress?)` loads a scene's manifest before you push
it, so the push enters straight away:

```ts yage-context="engine"
import { Scene } from "@yagejs/core";

class Level2 extends Scene {
  readonly name = "level2";
}
const level2 = new Level2();
const bar = document.createElement("progress");
bar.max = 1;
await engine.scenes.preload(level2, (ratio) => {
  bar.value = ratio;
});
await engine.scenes.replace(level2);
```

The push consumes that load instead of loading again, so the manifest is
counted once. `LoadingScene` uses the same method. A scene preloaded and never
pushed holds its references until `assets.clear()`.

## Manifest Pattern

There's no manifest abstraction beyond plain arrays. Common layout: one handle module per content area, then per-scene manifest arrays compose them.

```ts yage-group="manifest" yage-file="content/heroes.ts"
// content/heroes.ts
import { texture, spritesheet } from "@yagejs/renderer";

export const HeroTex = texture("assets/hero.png");
export const HeroSheet = spritesheet("assets/hero.json");
```

```ts yage-group="manifest" yage-file="content/sfx.ts"
import { sound } from "@yagejs/audio";

export const CoinSfx = sound("assets/coin.wav");
```

```ts yage-group="manifest" yage-file="content/level1.ts"
// content/level1.ts
import { tiledMap } from "@yagejs/tilemap";
import { HeroSheet } from "./heroes.js";
import { CoinSfx } from "./sfx.js";
export const Level1Manifest = [
  tiledMap("assets/levels/1.json"),
  HeroSheet,
  CoinSfx,
] as const;
```

```ts yage-group="manifest" yage-file="scenes/Level1.ts"
// scenes/Level1.ts
import { Scene } from "@yagejs/core";
import { Level1Manifest } from "../content/level1.js";

class Level1 extends Scene {
  readonly name = "level1";
  readonly preload = Level1Manifest;
}
```

Reuse: spread shared manifests into multiple scenes' `preload`.

## Cache Lifetime

The cache is engine-wide. Scenes don't own assets.

| Action                     | Effect                                       |
| -------------------------- | -------------------------------------------- |
| `assets.loadAll([h1, h2])` | Loads handles not already cached             |
| `assets.get(handle)`       | Reads cache (throws if absent)               |
| `assets.has(handle)`       | Boolean                                      |
| `assets.unload(handle)`    | Drops one handle, calls loader's `unload?()` |
| `assets.clear()`           | Drops everything                             |

For a small game, never unload — cache hits are cheap. Use `unload`/`clear` between large levels, when streaming chapters, or when freeing audio bound to a scene.

```ts yage-group="manifest" yage-file="scenes/UnloadLevel1.ts"
import { Scene } from "@yagejs/core";
import { Level1Manifest } from "../content/level1.js";

class Level1 extends Scene {
  readonly name = "level1";
  onExit() {
    for (const h of Level1Manifest) this.assets.unload(h);
  }
}
```

Default loaders dispose appropriately: `unload(textureHandle)` calls Pixi `Assets.unload(path)` so the texture is released and GC-able; `unload(soundHandle)` calls `sound.remove(path)`.

### Reference counting

Loads are counted per handle. Every handle passed to `loadAll` adds one
reference once that call resolves; `unload(handle)` removes one and only frees
the asset when the count reaches zero. Two scenes preloading the same texture
each hold a reference, so the first scene's `onExit` unload leaves it standing
for the second. `clear()` ignores the counts and frees everything.

A `loadAll` that rejects takes no references at all: its already-loaded
siblings stay cached and uncounted, so a retry counts each of them once. An
asset whose loader loads others — a Tiled map loads its tileset images — holds
them for as long as it is cached; freeing the map entry releases them.

Never `unload` the handles of a `loadAll` call that rejected. `unload` frees an
uncounted entry outright, so cleaning up a failed manifest handle by handle can
free an asset another scene still holds: scene A holds `X` at one reference,
scene B's `loadAll([X, Y])` fails so B takes none, and B's cleanup `unload(X)`
drops A's only reference. Retry the call, or leave the entries to `clear()`.

### One file path, one declaration form

The cache is keyed by handle type and path, so two handles of one type for one
path are one entry and the first load's options win. A second declaration with
different options warns in development and is ignored.

Below the manager, Pixi's own registry is keyed by path alone and is not
counted, so reaching one file through two handle types destroys it for both.
Declare each file once:

- `texture(P)` beside `renderAsset(P)` — pick one.
- A spritesheet's atlas image beside `texture(P)` — draw the frames from the
  sheet, don't also declare the PNG.
- `installBitmapFont`'s source face beside `webFont(P)` — bake from the
  `webFont` handle instead (`webFont(P, { family, bitmap: true })`).

## Errors

`assets.loadAll` throws on a failing handle. Catch in `LoadingScene.onLoadError(err)` (recommended) or wrap explicit ad-hoc `loadAll` calls in try/catch. Error message includes the failing path. No built-in fallback-asset mechanism — preload a known-good fallback if you need one.

## Base Path / Vite

Asset paths are resolved against the page URL, not source. Files under `public/` become root-relative paths.

For sub-path deployments (`https://example.com/yage/`), set Vite's `base` and prefix handle paths:

```ts yage-group="vite" yage-file="vite.config.ts"
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({ base: "/yage/" });
```

```ts yage-group="vite" yage-file="content/hero.ts"
// content/...
/// <reference types="vite/client" />
import { texture } from "@yagejs/renderer";

const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;
const HeroTex = texture(asset("assets/hero.png"));
```

`import.meta.env.BASE_URL` is `/` in dev and the configured base at build time. The factories pass strings straight to `fetch`; no normalization.

## Custom Loaders

```ts yage-context="context"
import { AssetManagerKey, AssetHandle } from "@yagejs/core";

interface Level {
  rows: string[];
}

context.resolve(AssetManagerKey).registerLoader("levelfmt", {
  async load(path: string): Promise<Level> {
    const response = await fetch(path);
    return { rows: (await response.text()).trim().split("\n") };
  },
});

export function level(path: string): AssetHandle<Level> {
  return new AssetHandle("levelfmt", path);
}
```

Once registered, handles of that type work in `Scene.preload` and `assets.get` like any built-in asset.

## Decision Matrix

| Need                       | Use                                          |
| -------------------------- | -------------------------------------------- |
| Load before scene starts   | `Scene.preload`                              |
| Progress UI while loading  | `LoadingScene` + progress component          |
| Mid-scene additional load  | `this.assets.loadAll([...])`                 |
| Free per-level assets      | `this.assets.unload(h)` per scene `onExit`   |
| Load a scene ahead of time | `engine.scenes.preload(scene)`               |
| Discard everything         | `this.assets.clear()`                        |
| New file type              | Custom loader + handle factory               |
| Sub-path deploy            | Prefix paths with `import.meta.env.BASE_URL` |

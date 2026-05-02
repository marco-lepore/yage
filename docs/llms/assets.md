# Assets

YAGE's asset model has three pieces:

- **Asset handles** — typed serializable refs (`{ type, path }`). Created via plugin factories.
- **`AssetManager`** — engine-owned cache + loader registry. Key: `AssetManagerKey`.
- **`Scene.preload`** — array of handles auto-loaded by `SceneManager` before `onEnter()`.

## Factories

| Factory | From | Returns |
|---|---|---|
| `texture(path)` | `@yagejs/renderer` | `TextureHandle` |
| `spritesheet(jsonPath)` | `@yagejs/renderer` | `AssetHandle<Spritesheet>` (atlas JSON references the texture) |
| `renderAsset<T>(path)` | `@yagejs/renderer` | `RendererAsset<T>` for arbitrary Pixi-managed assets |
| `sound(path)` | `@yagejs/audio` | `AssetHandle<Sound>` |
| `tiledMap(path)` | `@yagejs/tilemap` | Handle for parsed `TiledMapData` |

A handle is `{ type, path }`. `AssetManager.get(handle)` throws if uncached.

## Per-Scene Preload

```ts
class GameScene extends Scene {
  readonly preload = [HeroTex, CoinSfx, Level1Map];
  onEnter() {
    const tex = this.assets.get(HeroTex); // safe — preload finished
  }
}
```

`SceneManager` calls `assets.loadAll(this.preload)` before `onEnter()`, skips already-cached handles, and routes progress to `scene.onProgress(ratio)` if overridden. Throws with a clear message if a loader plugin for the handle's type isn't installed. The `scene:loading:progress` bus event is emitted by `LoadingScene` (which overrides `onProgress` to forward it), not by plain `Scene`.

## Manifest Pattern

There's no manifest abstraction beyond plain arrays. Common layout: one handle module per content area, then per-scene manifest arrays compose them.

```ts
// content/heroes.ts
export const HeroTex   = texture("assets/hero.png");
export const HeroSheet = spritesheet("assets/hero.json");

// content/level1.ts
import { HeroSheet } from "./heroes.js";
import { CoinSfx } from "./sfx.js";
export const Level1Manifest = [tiledMap("assets/levels/1.json"), HeroSheet, CoinSfx] as const;

// scenes/Level1.ts
class Level1 extends Scene {
  readonly preload = Level1Manifest;
}
```

Reuse: spread shared manifests into multiple scenes' `preload`.

## Cache Lifetime

The cache is engine-wide. Scenes don't own assets.

| Action | Effect |
|---|---|
| `assets.loadAll([h1, h2])` | Loads handles not already cached |
| `assets.get(handle)` | Reads cache (throws if absent) |
| `assets.has(handle)` | Boolean |
| `assets.unload(handle)` | Drops one handle, calls loader's `unload?()` |
| `assets.clear()` | Drops everything |

For a small game, never unload — cache hits are cheap. Reach for `unload`/`clear` between large levels, when streaming chapters, or when freeing audio bound to a scene.

```ts
class Level1 extends Scene {
  onExit() {
    for (const h of Level1Manifest) this.assets.unload(h);
  }
}
```

Default loaders dispose appropriately: `unload(textureHandle)` calls Pixi `Assets.unload(path)` so the texture is released and GC-able; `unload(soundHandle)` calls `sound.remove(path)`.

## Errors

`assets.loadAll` throws on a failing handle. Catch in `LoadingScene.onLoadError(err)` (recommended) or wrap explicit ad-hoc `loadAll` calls in try/catch. Error message includes the failing path. No built-in fallback-asset mechanism — preload a known-good fallback if you need one.

## Base Path / Vite

Asset paths are resolved against the page URL, not source. Files under `public/` become root-relative paths.

For sub-path deployments (`https://example.com/yage/`), set Vite's `base` and prefix handle paths:

```ts
// vite.config.ts
export default defineConfig({ base: "/yage/" });

// content/...
const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;
const HeroTex = texture(asset("assets/hero.png"));
```

`import.meta.env.BASE_URL` is `/` in dev and the configured base at build time. The factories pass strings straight to `fetch`; no normalization.

## Custom Loaders

```ts
import { AssetManagerKey, AssetHandle } from "@yagejs/core";

context.resolve(AssetManagerKey).registerLoader("levelfmt", {
  async load(path: string): Promise<Level> { /* fetch + parse */ },
  unload?(path: string, asset: Level): void { /* dispose */ },
});

export function level(path: string): AssetHandle<Level> {
  return new AssetHandle("levelfmt", path);
}
```

Once registered, handles of that type work in `Scene.preload` and `assets.get` like any built-in asset.

## Decision Matrix

| Need | Use |
|---|---|
| Load before scene starts | `Scene.preload` |
| Progress UI while loading | `LoadingScene` + progress component |
| Mid-scene additional load | `this.assets.loadAll([...])` |
| Free per-level assets | `this.assets.unload(h)` per scene `onExit` |
| Discard everything | `this.assets.clear()` |
| New file type | Custom loader + handle factory |
| Sub-path deploy | Prefix paths with `import.meta.env.BASE_URL` |

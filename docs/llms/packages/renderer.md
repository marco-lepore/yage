# @yagejs/renderer

Depends on `@yagejs/core`, `pixi.js`. PixiJS v8 rendering behind the YAGE plugin interface.

## Type vocabulary

Every exported field, parameter, and return type across `@yagejs/renderer` (and its downstream consumers — `@yagejs/ui`, `@yagejs/particles`, `@yagejs/tilemap`) uses this package's own alias names instead of a direct `pixi.js` type import, so consumer code never has to import `pixi.js` for types:

| Alias | Underlying Pixi type | Where it shows up |
|---|---|---|
| `DisplayContainer` | `Container` | `renderObject` getters, `RenderLayer.container`, UI element `container`/`displayObject` fields |
| `DisplaySprite` | `Sprite` | `SpriteComponent.sprite` |
| `DisplayAnimatedSprite` | `AnimatedSprite` | `AnimatedSpriteComponent.animatedSprite` |
| `DisplayText` | `Text` | `TextComponent.text` (canvas variant) |
| `DisplayBitmapText` | `BitmapText` | `TextComponent.text` (bitmap variant) |
| `DisplaySplitText` | `SplitText` | `SplitTextComponent.splitText` (canvas variant) |
| `DisplaySplitBitmapText` | `SplitBitmapText` | `SplitTextComponent.splitText` (bitmap variant) |
| `GraphicsContext` | `Graphics` | `GraphicsComponent.graphics`, `draw((g) => ...)`, mask draw callbacks |
| `NineSliceSprite` | `NineSliceSprite` | `createNineSlice()` return, `UINineSlice.container` |
| `ParticleContainer` | `ParticleContainer` | `@yagejs/particles`' `ParticleEmitterComponent.container` |
| `Particle` | `Particle` | `@yagejs/particles`' `ParticlePool.acquire()`/`release()` |
| `Filter` | `Filter` | effects API (`Effect.filter`, `rawFilter(filter)`) |
| `Application` | `Application` | `RendererPlugin.application` |
| `ApplicationOptions` | `ApplicationOptions` | `RendererConfig.pixi` |
| `DestroyOptions` | `DestroyOptions` | visual components' `destroyOptions()` override hook |
| `ColorValue` | `ColorSource` | every `tint` option/accessor |
| `BlendMode` | `BLEND_MODES` | every visual component's `blendMode` option/accessor |
| `PointLike` | `PointData` | point-shaped callbacks/options |
| `TextStyle` | `TextStyleOptions` | every `style` option |
| `TextureRef` | none — `string \| TextureHandle`, a serializable key/handle reference | `SpriteComponent.texture`, `setTexture()` |

The aliases are transparent (`type DisplayContainer = Container`) and provide no encapsulation. Escape hatches (`RendererPlugin.application`, every `renderObject` getter, `.sprite`/`.graphics`/`.text`/`.splitText`/`.animatedSprite`) still return the real Pixi object. Only the *type* used to describe it is aliased, so calling any native Pixi method on it works exactly as it would on the raw type.

## Setup

```ts
import { RendererPlugin } from "@yagejs/renderer";

engine.use(new RendererPlugin({
  width: 800,
  height: 600,
  backgroundColor: 0x1a1a2e,
  container: document.getElementById("game")!,
  // optional:
  virtualWidth: 320,     // virtual resolution (auto-scaled)
  virtualHeight: 240,
  resolution: window.devicePixelRatio,
  fit: { mode: "cover" }, // override default letterbox (see below)
  pixelArtPreset: true,   // crisp, non-blurred pixel art (see below)
}));
```

### `pixelArtPreset`

One flag for pixel-art games. When `true`, the plugin:

- Sets `TextureStyle.defaultOptions.scaleMode = "nearest"` before `Application.init` so textures loaded by `Assets` sample without bilinear blur.
- Passes `roundPixels: true` into the Pixi `Application` so subpixel transforms don't smear sprite edges.
- Writes `image-rendering: -webkit-optimize-contrast; image-rendering: pixelated;` onto the canvas `style.cssText` so the browser scales the backing store with nearest-neighbor. The Safari fallback is the first declaration; modern browsers pick the second from the cascade.

Default: `false`. Composes with `pixi`: explicit `pixi: { roundPixels: false }` wins over the preset, so games can opt parts back out. Per-texture overrides (`source.scaleMode = "linear"` on a specific texture) keep working — the preset only sets the *default*.

```ts
new RendererPlugin({
  width: 320, height: 240,
  container: host,
  pixelArtPreset: true,
});
```

Registers `RendererKey`, `SceneRenderTreeProviderKey`, and the cross-package `RendererAdapterKey` (from `@yagejs/core`, consumed by `@yagejs/input`) in `EngineContext`, plus a `beforeEnter` scene hook that materializes a per-scene `SceneRenderTree` (accessible via the scene-scoped `SceneRenderTreeKey`).

The adapter contract (`RendererAdapter` in `@yagejs/core`) carries `canvas`, `canvasToVirtual`, `hitTestUI`, and the optional `visibleVirtualRect` — the on-screen region of virtual space CLAMPED to the declared virtual rect. Renderer-agnostic overlays (e.g. `@yagejs-addons/virtual-controls`) lay out against `visibleVirtualRect`, NOT against `canvasToVirtual`-mapped canvas corners: under letterbox the corners map into the masked bars, where drawn content is clipped but pointer input still registers.

## Responsive fit

The canvas is **responsive by default** — it tracks a host element and re-maps the virtual rectangle on every resize. Without an explicit `fit` config, the renderer defaults to `{ mode: "letterbox" }` against the configured `container` (falling back to `canvas.parentElement`, then `document.body`). Pass `fit` to override the mode or target. Fixed-size canvases are achieved via fixed CSS dimensions on the container.

```ts
new RendererPlugin({
  width: 800, height: 600,
  container: host,
  // fit: { mode: "letterbox" }  // this is the default
  // fit: { mode: "cover" },     // or override
  // fit: { mode: "stretch", target: otherElement },
});
```

| Mode | Scale | Offset | When to pick |
|---|---|---|---|
| `letterbox` | uniform `min(cw/vw, ch/vh)` | centers; bars in `backgroundColor` | default — preserves aspect, full virtual rect visible |
| `expand` | same as `letterbox` | same as `letterbox` | virtual always fully visible, but the game draws into the bars instead of leaving them blank (fog, parallax, decorative backdrop, HUD). Matches Godot `expand`, Unity `Expand`, Construct "Scale inner". |
| `cover` | uniform `max(cw/vw, ch/vh)` | centers; overflow clipped by canvas edge | fills the host; accept CSS-cover-style clipping on one axis. Rare for gameplay — aspect affects what the player sees. |
| `stretch` | non-uniform per axis | none | fills the host; virtual rect squashed. Use for menus or editor panels, not gameplay. |

`letterbox` and `expand` produce the same stage transform. They differ in convention: letterbox expects bars to be the flat `backgroundColor`; expand expects the game to fill them via `extendedVirtualRects`.

A `ResizeObserver` drives updates; it's disposed in `onDestroy`. In headless environments (no DOM target, no `document`) the plugin applies a one-shot transform against the initial `width × height` and installs no observer.

**Give the fit container a bounded height.** The fit host's size is fed back into the canvas every resize, so a container with no height of its own (only content-driven height) has no stable size and the observer can grow without bound. The renderer sets `display:block` on the canvas, which removes the ~4px inline-canvas baseline gap that otherwise causes this and makes the common case converge with zero CSS. You still want the container to have an explicit or bounded height (`height: 100%` under a sized ancestor, or `max-height`). If a true feedback loop is detected anyway (residual margin / sub-pixel growth), `FitController` freezes auto-resize and logs a one-time `console.warn` rather than hang the tab.

Runtime API on the plugin:

```ts
renderer.setFit({ mode: "expand" });            // swap modes / target
renderer.fit;                                   // current { mode, target? }
renderer.canvasSize;                            // current CSS { width, height }
renderer.canvasToVirtual(cssX, cssY);           // canvas CSS px → virtual (Vec2)
renderer.virtualToCanvas(x, y);                 // virtual → canvas CSS px (Vec2)
renderer.visibleVirtualRect;                    // on-screen sub-rect of virtual (clamped)
renderer.croppedVirtualRects;                   // parts of virtual that are off-screen
renderer.virtualCanvasRect;                     // where virtual sits on the canvas (CSS px)
renderer.visibleCanvasRect;                     // full canvas extent in virtual px
renderer.extendedVirtualRects;                  // parts of canvas OUTSIDE virtual (bars)
```

### `visibleVirtualRect`

Sub-rectangle of the declared virtual space that's actually on-screen, clamped to virtual bounds. Anchor HUD / UI that must stay inside the play area to this rect; keep gameplay queries on `virtualSize`. Critical under `cover` for competitive games where a wider viewport must not grant a gameplay advantage: the play area stays `virtualSize`, but HUDs align to the visible sub-rect.

| Mode | `visibleVirtualRect` |
|---|---|
| `letterbox` / `expand` / `stretch` | full virtual rect: `{ 0, 0, virtualWidth, virtualHeight }` |
| `cover` | cropped sub-rect on the long axis, e.g. `{ 0, 30, 400, 240 }` for 400×300 virtual in a 1000×600 host |

### `croppedVirtualRects`

Rectangles of virtual space that are currently off-screen — the complement of `visibleVirtualRect` inside `virtualSize`. Empty under `letterbox` / `expand` / `stretch`. Under `cover`, returns 1–2 strips on the cropped axis (top + bottom on a wide host, left + right on a tall host). Gameplay still runs in these regions; they're just clipped by the canvas edge.

Use when an effect needs to reason about what's beyond the visible edge under `cover` — fog-of-war overlays that fade at the crop boundary, edge-activity indicators, auto-panning cameras that keep action in view.

### `virtualCanvasRect`

Where the declared virtual rectangle sits on the canvas, in **CSS pixels**. Useful for positioning DOM overlays over the play area, cropping screenshots to gameplay, or mapping CSS-coord hit regions. Derived from the stage transform: `{ x: offsetX, y: offsetY, width: vW*scaleX, height: vH*scaleY }`. Under `cover` this rect extends past the canvas (negative coords, dimensions larger than `canvasSize`).

### `visibleCanvasRect`

Full canvas extent expressed in **virtual-space pixels**. Unlike `visibleVirtualRect`, not clamped to the declared virtual rect — under `letterbox` / `expand` on an off-aspect host this extends past `virtualSize` on the bar axis (negative `x` / `y` or `width` / `height` greater than the virtual dimension). Under `cover` it equals `visibleVirtualRect`; under `stretch` it equals the virtual rect.

Anchor HUD to this rect (not `visibleVirtualRect`) when you want cards to live in the bars under `expand`. Iterate over it for backdrops that should fill the whole visible canvas.

### `extendedVirtualRects`

Rectangles of the visible canvas that sit **outside** the declared virtual rect — the letterbox / expand "bars" expressed in virtual-space pixels. Complement of `virtualSize` inside `visibleCanvasRect`.

| Mode | `extendedVirtualRects` |
|---|---|
| `letterbox` / `expand` | 0–2 bar strips when aspect mismatches (top + bottom on tall hosts, left + right on wide hosts) |
| `cover` | `[]` (virtual covers the entire canvas) |
| `stretch` | `[]` (virtual exactly fills the canvas) |

Under `expand` these are the play-adjacent strips the game is expected to draw into. The `responsive-ui` example fills each with a solid dark rect plus a short gradient along the inner edge (touching the play area) so the bars read as "not the play area, but still part of the rendered world." Under `letterbox` the same rects tell you where the `backgroundColor` bars are — useful for adding optional bar customization to an otherwise-plain letterbox render.

Note: "screen" in the engine (UI `LayerSpace: "screen"`, `Camera.screenToWorld`) means *virtual viewport space*. The `canvasToVirtual` method is named after its inputs (DOM CSS pixels on the canvas) to avoid that collision.

Pair with `@yagejs/input` — `InputPlugin` auto-resolves the renderer via `RendererAdapterKey` (core), so pointer events target this canvas and coordinates route through `canvasToVirtual` without extra setup. `InputManager.getPointerPosition()` stays correct under fit with no config.

## Fullscreen & Orientation

`RendererPlugin` wraps the browser fullscreen API (with `webkitRequestFullscreen` fallback for iOS Safari) and emits viewport-lifecycle events on the engine bus. The fullscreen target is the configured `container` when present, falling back to the canvas.

| Member | Purpose |
|---|---|
| `requestFullscreen(): Promise<void>` | Enter fullscreen on the host. Must be called from a user gesture. Rejects if unsupported. |
| `exitFullscreen(): Promise<void>` | Exit fullscreen. No-op if not currently fullscreen. |
| `isFullscreen: boolean` | Live read of `document.fullscreenElement === host`. |
| `orientation: OrientationType \| null` | Current device orientation (`portrait-primary`, `landscape-primary`, etc.), or `null` when neither modern nor legacy API is available. |

Emits on the engine `EventBus`:

| Event | Payload | When |
|---|---|---|
| `screen:fullscreen` | `{ active: boolean }` | `fullscreenchange` / `webkitfullscreenchange` (entering, exiting, Esc, browser UI). |
| `screen:orientation` | `{ type: OrientationType }` | `screen.orientation.change` if available, else `window.orientationchange` fallback. |

```ts
import { EventBusKey } from "@yagejs/core";
const renderer = engine.use(new RendererPlugin({ width: 800, height: 600, container: host }));
const bus = engine.context.resolve(EventBusKey);
bus.on("screen:orientation", ({ type }) => layoutHud(type));
button.addEventListener("click", () => renderer.requestFullscreen());
```

Listeners are registered in `install()` (gated by `typeof document/window !== "undefined"`) and torn down in `onDestroy()`. iOS Safari requires `requestFullscreen` to run inside a user-gesture handler.

## Components

### Pick a component

| Need | Use |
|---|---|
| Render an asset / texture | `SpriteComponent` |
| Frame-based animation | `AnimatedSpriteComponent` (+ `AnimationController`) |
| Procedural shapes (debug, prototypes, gradient overlays, custom drawing) | `GraphicsComponent` |
| Text with layout, padding, backdrop, "card" widget | `UIText` + `UISurface` from `@yagejs/ui` |
| Entity-tracked text that stays axis-aligned at any zoom (nameplates, damage numbers) | `ScreenFollow` + `UISurface({ positioning: "transform" })` from `@yagejs/ui` |
| Free-positioned single string (debug HUD, diegetic world-space label) | `TextComponent` |

Default to `@yagejs/ui` for any text that lives inside a widget, has padding, or stacks with other rows. `TextComponent` is the narrow case where the text is its own world-space primitive with no layout.

For procedural shapes plus a label, use a parent entity with `GraphicsComponent` + a child entity with `TextComponent`. Pixi v8 has no `g.text(...)` method: text is always a separate display object.

### Shared options vocabulary

All five visual components below (Sprite, AnimatedSprite, Graphics, Text, SplitText) accept the same `visible` / `tint` / `alpha` / `blendMode` / `interactive` options, with runtime accessors for the first four. Pixi's `Container` carries all five natively, so the behavior is identical across every component:

```ts
{
  visible?: boolean;   // initial visibility, default true
  tint?: ColorValue;    // number (0xff0000) or CSS color string ("red", "#ff0000")
  alpha?: number;       // opacity, default 1
  blendMode?: BlendMode; // how the pixels combine with what is beneath, default "normal"
  interactive?: {
    eventMode?: "static" | "dynamic"; // default "static" when the object is set
    consumeOnInteraction?: boolean;    // claim the press for @yagejs/input's action map
  };
}
```

`comp.visible` / `comp.tint` / `comp.alpha` / `comp.blendMode` read/write the live object; `interactive` is option-only (set once at construction, persisted through save/load).

**`blendMode`.** `"normal"`, `"add"`, `"multiply"`, `"screen"`, `"erase"`, `"min"`, `"max"`, `"none"` and the `-npm` variants are GPU-native and need nothing extra. The photoshop-style rest (`"darken"`, `"lighten"`, `"overlay"`, `"color-dodge"`, `"soft-light"`, ...) are filter-backed and need one side-effect import in the game's entry file — without it Pixi logs a warning and draws normally:

```ts
import "pixi.js/advanced-blend-modes";
```

Pixi constructs every display object at `"inherit"`, not `"normal"` — inherited blending renders as normal until an ancestor sets a mode, and the two differ under a non-normal parent. `serialize()` omits `blendMode` only when it is `"inherit"`, so an explicit `"normal"` survives a round trip. `"erase"` composites against whatever framebuffer the object lands in, so it only cuts a hole out of the darkness you intend when both are drawn into their own offscreen buffer — see [Offscreen render targets](#offscreen-render-targets). `anchor` (`{x, y}`) is shared by Sprite, AnimatedSprite, Text, and SplitText. Graphics has no anchor (a raw Pixi `Container` has none). SplitText also has per-segment `charAnchor` / `wordAnchor` / `lineAnchor` values (see below).

### SpriteComponent

```ts
import { SpriteComponent } from "@yagejs/renderer";

entity.add(new SpriteComponent({
  texture: "hero.png",   // TextureRef: asset key or handle — always serializable
  layer: "world",         // render layer name
  anchor: { x: 0.5, y: 0.5 },
  tint: 0xff0000,
  interactive: { consumeOnInteraction: true },
}));
```

`texture` takes a `TextureRef` (asset key or handle) — never a raw `Texture` object, so `serialize()` always yields a full snapshot. A key that is neither preloaded nor registered throws, naming the key. Runtime-created textures: register them under a key first — see "Runtime textures" under Asset Factories.

**Escape hatch:** `.sprite` is the underlying pixi `Sprite` instance — full pixi API surface available, including `sprite.tint`. See [pixi Sprite docs](https://pixijs.com/8.x/guides/components/scene-objects/sprite).

> `sprite.tint` multiplies the source RGB by the tint colour. That's cheap on the GPU and right for "darken / desaturate / multiply with a colour" effects, but it turns saturated source colours into mud (a blue mushroom × yellow tint reads as olive). For replace-style recolour — where black stays black, white reaches the target colour, and midtones blend proportionally — use the `colorize` effect from `@yagejs/effects` instead.

### GraphicsComponent

Procedural drawing via PixiJS Graphics API:

```ts
import { GraphicsComponent } from "@yagejs/renderer";

entity.add(new GraphicsComponent({ layer: "world", tint: 0x88ccff }).draw((g) => {
  g.rect(0, 0, 50, 50).fill(0xff0000);
}));
```

Serializes `layer` / `visible` / `tint` / `alpha` / `blendMode` / `interactive` / effects / mask — the drawn geometry itself is not persisted (Pixi has no way to read commands back off a `Graphics` object), so redo the `draw()` call in `afterRestore()`.

**Escape hatch:** `.graphics` (and the `g` passed to `.draw(fn)`) is a raw pixi `Graphics` with the v8 fluent API: `rect` / `circle` / `roundRect` / `poly` / `moveTo` / `lineTo` / `arc` / `fill` / `stroke`. `arc` continues the current path like Canvas 2D: call `moveTo(x, y)` at the arc's start point first for a standalone arc, otherwise a line connects it from the previous point. See [pixi Graphics docs](https://pixijs.com/8.x/guides/components/scene-objects/graphics).

Gradient fills: use `linearGradient` / `radialGradient` (see below) instead of reaching into `pixi.js` for `FillGradient`.

### TextComponent

Renders text on a layer, Transform-synced like sprites. For free-positioned strings only — for laid-out text widgets, use `UISurface` + `UIText` from `@yagejs/ui` (see "Pick a component" above).

```ts
import { TextComponent } from "@yagejs/renderer";

entity.add(new TextComponent({
  text: "DEBUG",
  layer: "debug",
  anchor: { x: 0.5, y: 0 },
  style: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 14,
    fill: 0xf8fafc,
    fontWeight: "bold",
  },
  interactive: { consumeOnInteraction: true }, // marks a raw-Text pointer-consume surface
}));
```

Serializable. **Thin wrapper:** `style` forwards as-is to pixi `TextStyleOptions` (CSS-style font properties — `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fill`, `letterSpacing`, `lineHeight`, etc.). `.text` is the underlying pixi `Text` (or `BitmapText` when `bitmap` is set). See [pixi Text docs](https://pixijs.com/8.x/guides/components/scene-objects/text/) and [pixi TextStyle reference](https://pixijs.com/8.x/guides/components/scene-objects/text/style).

**Pixel-art text — `bitmap`.** Canvas-rasterised `Text` is bilinear-sampled by the GPU, so it goes blurry at non-integer scale (camera zoom, pixel-art upscaling) on non-Retina displays. Set `bitmap` to draw pre-baked glyph quads instead:

```ts
// `bitmap: true` bakes (or looks up) the atlas from `style.fontFamily`
// at `style.fontSize` — the font is a normal style property.
new TextComponent({ text: "SCORE", bitmap: true, style: { fontFamily: "monospace", fontSize: 12 } });

// An installed / loaded bitmap font: name it via fontFamily.
new TextComponent({ text: "READY", bitmap: true, style: { fontFamily: "PressStart", fontSize: 16 } });
```

`bitmap` (boolean) and `resolution` round-trip through serialization. Yoga/layout behaviour is unchanged.

**`setStyle` replaces, `mergeStyle` patches.** `setStyle(style)` assigns a fresh style — properties you omit fall back to the defaults. `mergeStyle(style)` merges over the properties already set, so an imperative recolour (`mergeStyle({ fill })`) keeps the current font, size, weight, etc. The React reconciler uses `setStyle` (declarative: the full style is passed every render).

**`resolution` gotcha (Pixi v8).** `resolution` is a `Text` *constructor* option, NOT a `TextStyle` property. Setting `TextStyle.defaultTextStyle.resolution` does nothing. Pass it explicitly to get crisp canvas text without a prototype patch — or use `bitmap` for pixel-perfect rendering:

```ts
new TextComponent({ text: "HUD", resolution: window.devicePixelRatio });
```

`resolution` is ignored when `bitmap` is set — bitmap resolution is fixed when the font is baked (see `installBitmapFont({ resolution })`).

**Engine default text style.** `new RendererPlugin({ defaultTextStyle: { fontFamily, fill } })` sets an app-wide base under every `TextComponent` / `UIText` `style` (per-text values win) — no need to import pixi to touch `TextStyle.defaultTextStyle`. `@yagejs/ui`'s `UIPlugin({ defaultTextStyle })` layers a UI-only override on top (precedence: per-text style > UIPlugin default > RendererPlugin default > pixi default). The default also re-applies on `setStyle`, so a recolour keeps it.

**`bitmap` is a sibling of `style`, not a style key.** Merging it into `style` (`style: { …, bitmap: true }`) is ignored and emits a dev warning — keep it top-level: `{ style: { … }, bitmap: true }`.

### SplitTextComponent

Per-glyph / animated text — typewriter reveals, per-letter colour/wave, staggered line entrances. Wraps Pixi v8's **experimental** `SplitText` / `SplitBitmapText`; exposes the text as arrays of individually transformable display objects. Transform-synced and layer-attached like `TextComponent`.

```ts
import { SplitTextComponent } from "@yagejs/renderer";
import { Tween, ProcessComponent } from "@yagejs/core";

const title = entity.add(new SplitTextComponent({
  text: "GAME OVER",
  style: { fontSize: 48, fill: 0xffffff },
  bitmap: true,                     // optional — SplitBitmapText (font via style.fontFamily)
  anchor: { x: 0.5, y: 0.5 },       // pivot for the whole text block
  charAnchor: 0.5,                  // segment pivots (0–1): char / word / lineAnchor
  // autoSplit: false,              // batch text/style edits, then resplit()
}));

title.chars;   // (Text | BitmapText)[] — one per glyph
title.words;   // Container[] — word groups
title.lines;   // Container[] — line groups

// Typewriter: stagger each glyph's fade-in (0.05s apart) via a ProcessComponent.
title.chars.forEach((c) => (c.alpha = 0));
const pc = entity.add(new ProcessComponent());
Tween.stagger(title.chars, (c) => Tween.custom((v) => (c.alpha = v), 0, 1, 0.3), 0.05).forEach((p) => pc.run(p));
```

`anchor` positions the whole block around its entity Transform. It uses the current split text bounds and is recomputed after text, style, or manual split updates. `charAnchor`, `wordAnchor`, and `lineAnchor` only affect their individual segments.

API: `chars` / `words` / `lines` (getters), `setText(v)`, `setStyle(s)`, `charAnchor` / `wordAnchor` / `lineAnchor` (get/set), `resplit()` (manual split when `autoSplit: false`), `visible` / `tint` / `alpha`, `fx` / `setMask` / `clearMask` (same effects/mask surface as the other four components), `splitText` (underlying Pixi object), `isBitmap`. Serializable (text/style/bitmap/anchor/segment anchors/layer/visible/tint/alpha/interactive/effects/mask; re-splits on restore). Caveats: `SplitText` is experimental, re-lays-out on every `text`/`style` change (prefer `TextComponent` for static/simple text), and char spacing can differ slightly from `Text` (kerning lost when glyphs split).

### AnimatedSpriteComponent

`source` is required — there's no raw-`Texture[]` construction path, so every `AnimatedSpriteComponent` serializes fully. A `FrameSource` is either a sheet (`SheetFrameSource`: `{ sheet, frameWidth, frameHeight?, count?, columns?, startX?, startY?, gapX?, gapY? }` — top row by default; `count` wraps rows every `columns` frames for multi-row grid sheets) or an atlas animation (`{ atlas, animation }`). `sliceGrid(texture, options)` is the underlying slicer for use when you already have a `Texture` object.

```ts
import { AnimatedSpriteComponent } from "@yagejs/renderer";

const player = entity.add(new AnimatedSpriteComponent({
  source: { sheet: "player_idle.png", frameWidth: 48 },          // single-row strip
  layer: "world",
  anchor: { x: 0.5, y: 1 },
  tint: 0xffffff,
}));

// multi-row grid sheet: 48 frames wrapped across width-derived columns
new AnimatedSpriteComponent({
  source: { sheet: "boxer_idle.png", frameWidth: 126, frameHeight: 132, count: 48 },
});

player.play({ speed: 0.15, loop: true });
player.gotoFrame(3); // stop and hold a pose
player.play({ speed: 0.2, loop: false, fromStart: true }); // one-shot from frame 0
```

Use `gotoFrame(index)` to stop playback and hold one frame; read the selected
index through `frame`. A bare `play()` resumes from the current frame. Pass
`fromStart: true` to restart at frame 0, including replaying a completed
non-looping animation.

Playback runs in engine-scaled component time. `scene.timeScale` and
`entity.timeScale` compose with Pixi's `animationSpeed`; a paused scene,
`scene.timeScale = 0`, or a disabled component freezes the animation. Host an
animation in a separate active overlay scene when it must keep playing while
gameplay is frozen.

**Escape hatch:** `.animatedSprite` is the underlying pixi `AnimatedSprite`.

### AnimationController

Named animation state machine with one-shot locking:

```ts
import { AnimationController } from "@yagejs/renderer";

entity.add(new AnimationController<"idle" | "walk" | "attack">({
  idle: { source: { sheet: "player_idle.png", frameWidth: 48 }, speed: 0.15 },
  walk: { source: { sheet: "player_walk.png", frameWidth: 48 }, speed: 0.2 },
  attack: { source: { sheet: "player_attack.png", frameWidth: 48 }, speed: 0.25, loop: false },
}));

// In component:
const anim = entity.get(AnimationController);
anim.play("walk");
anim.playOneShot("attack"); // locks until complete, then reverts
```

### Typing the controller

`AnimationController<T extends string = string>` is generic on the animation-name union — `play("walk")` autocompletes, and a typo like `play("wal")` is a compile error. But the runtime class isn't generic: there's no `AnimationController<HeroAnim>` expression to pass to `entity.get()` or `Component.sibling()`, and a default `AnimationController<string>` isn't sound-assignable to `AnimationController<HeroAnim>` (the `current: T | ""` getter is covariant on `T`, so a string-returning instance can't substitute for one promising the narrow union). Annotate the field with an `as` cast — the cast is required because the type parameter is type-only, and the field annotation makes every downstream call site narrow automatically:

```ts
type HeroAnim = "idle" | "walk" | "attack";

class HeroController extends Component {
  private readonly _anim = this.sibling(AnimationController) as
    AnimationController<HeroAnim>;

  update(): void {
    this._anim.play("walk");   // typed — typo here is a compile error
  }
}
```

`playOneShot(name, options?)` — `options.duration` (engine-scaled seconds) overrides the auto-computed lock duration; the fallback uses `(frames * (1 / 60)) / speed`. The lock timer and sprite playback receive the same scene and entity time scaling. Pass an explicit `duration` when synchronising lock release across multiple controllers (see `LayeredAnimationController` below).

### LayeredAnimationController

Fans `play()` / `playOneShot()` across N sibling `AnimationController` instances with a single shared lock timer. Use this when a character is composed of multiple sprite layers (head + body + outfit) that must animate in lockstep:

```ts
import {
  AnimatedSpriteComponent,
  AnimationController,
  LayeredAnimationController,
} from "@yagejs/renderer";

class Hero extends Entity {
  setup() {
    this.add(new Transform());
    const body = this.spawnChild("body", HeroLayer, { sheet: "body.png" });
    const head = this.spawnChild("head", HeroLayer, { sheet: "head.png" });
    this.add(new LayeredAnimationController<"idle" | "attack">({
      controllers: [
        body.get(AnimationController) as AnimationController<"idle" | "attack">,
        head.get(AnimationController) as AnimationController<"idle" | "attack">,
      ],
    }));
  }
}

const layered = hero.get(LayeredAnimationController);
layered.play("idle");
layered.playOneShot("attack", { onComplete: () => layered.play("idle") });
```

- `play(name)` forwards to every child.
- `playOneShot(name, opts)` computes one shared duration (from the first controller, or `opts.duration` if given) and passes `Number.POSITIVE_INFINITY` to each child so child timers can never expire independently — the wrapper owns the master timer and cascades `unlock()` when it fires. `onComplete` runs exactly once.
- Not save/load-aware (`serialize()` returns `null`) — rebuild via the same `setup()` path on restore.

### Layered characters: one-shot lock drift (the underlying problem)

`LayeredAnimationController` is the recommended fix. If you'd rather not introduce a wrapper component — for prototypes, or when each layer already has a custom controller — the same fix can be written as a short helper function. The underlying issue: `AnimationController.playOneShot` computes its lock duration from `frames.length / speed` (in whole-frame increments). When layers have different frame counts or speeds (a 12-frame outfit at `speed: 0.2` and a 10-frame body at `speed: 0.18` round differently), the locks expire on different frames and one sprite snaps back to idle while the others are still mid-swing — a single layer flickering at the end of every attack animation.

Precompute the duration on the first controller and broadcast it via `options.duration`:

```ts
function playOneShotLayered(
  controllers: AnimationController<string>[],
  name: string,
  onComplete?: () => void,
): void {
  const duration = controllers[0]!.calcDuration(name);
  controllers[0]!.playOneShot(name, { duration, onComplete });
  for (let i = 1; i < controllers.length; i++) {
    controllers[i]!.playOneShot(name, { duration });
  }
}

playOneShotLayered([bodyAnim, headAnim, outfitAnim], "attack");
```

`calcDuration(name)` is public on `AnimationController` — `LayeredAnimationController` calls it internally for exactly this reason.

## Gradient fills

`linearGradient` and `radialGradient` return a `GradientFill` (pixi `FillGradient` internally) usable anywhere a graphics fill style is accepted. Stops use yage-style numeric color + alpha pairs — no CSS color strings needed.

```ts
import { linearGradient, radialGradient, GraphicsComponent } from "@yagejs/renderer";

const fade = linearGradient({
  axis: "vertical", // or "horizontal", or explicit start/end points
  stops: [
    { offset: 0, color: 0x000000, alpha: 0.8 },
    { offset: 1, color: 0x000000, alpha: 0 },
  ],
  // space: "local" (default) scales stops across the filled shape.
  // "global" treats them as world/screen pixels.
});

entity.add(new GraphicsComponent({ layer: "fog" }).draw((g) => {
  g.rect(0, 0, 200, 40).fill(fade);
}));

const spotlight = radialGradient({
  center: { x: 0.5, y: 0.5 },
  innerRadius: 0,
  outerRadius: 0.5,
  stops: [
    { offset: 0, color: 0xffffff, alpha: 1 },
    { offset: 1, color: 0xffffff, alpha: 0 },
  ],
});
```

`GradientFill` owns a GPU texture; call `.destroy()` in `onRemove()` when the owning component tears down. Components can safely build gradients in field initializers — just destroy them in `onRemove()`.

**Re-export:** `GradientFill` IS pixi `FillGradient`. The factories convert yage's numeric stops to pixi color stops and forward the rest as-is. See [pixi FillGradient docs](https://pixijs.download/release/docs/scene.FillGradient.html).

## Camera

The camera is an entity, not a service. Spawn a `CameraEntity` in your scene
and use it directly for follow, shake, zoom, and bounds — all convenience methods are on the entity.

```ts
import { CameraEntity } from "@yagejs/renderer";

// In a scene's onEnter():
const cam = this.spawn(CameraEntity, {
  follow: player.get(Transform),
  smoothing: 0.1,
  offset: { x: 0, y: -50 },
  deadzone: { halfWidth: 20, halfHeight: 20 },
  snap: true, // start on the target; without it the camera eases in from (0, 0)
});

cam.snapToTarget(); // cut to the target after a teleport (room change, respawn)
cam.unfollow();

cam.shake(10, 0.5, { decay: 1 }); // duration in seconds; decay 1 fades to zero by the end, 0 (default) holds full strength
cam.zoomTo(2.0, 1, easeOutQuad); // duration in seconds

cam.bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };

const world = cam.screenToWorld(mouseX, mouseY);
const screen = cam.worldToScreen(entity.x, entity.y);
```

### Follow smoothing and `snap`

`smoothing` is `1` by default (the camera reaches its target position every frame). Any value below `1` eases toward that position from the camera's current one, so a camera spawned at the default `(0, 0)` glides in from the world origin over the first frames of the scene.

`snap: true` — on `CameraEntity` params and on `CameraFollowOptions` — places the camera on the target as following starts, offset included. `snapToTarget()` (on `CameraEntity`, `CameraComponent`, and `CameraFollow`) performs the same cut on demand. Both skip the deadzone once; it applies again from the next frame. `snapToTarget()` does nothing when no target is set.

### Coordinate Convention

Camera position `(0, 0)` places the **world origin at the center of the viewport**, not the top-left. Entities rendered at `(0, 0)` appear centered. This is the standard convention for camera-driven 2D games (scrolling shooters, platformers).

For top-left-origin games (tilemap editors, classic arcade layouts), offset the camera by half the viewport so that world `(0, 0)` aligns with the screen's top-left corner — or use `fitTo` (below) to frame the whole level in one call.

```ts
class GameScene extends Scene {
  readonly name = "game";

  onEnter() {
    // Top-left-origin: world (0,0) maps to screen (0,0)
    this.spawn(CameraEntity, { position: new Vec2(400, 300) }); // viewport is 800×600
  }
}
```

### `fitTo` — frame a world rectangle

`fitTo: { x, y, width, height }` is the fixed-camera primitive: it positions the camera at the rect's centre AND sets `zoom` so the entire rect fits inside the viewport (`contain` semantics, `zoom = min(viewportW / rect.w, viewportH / rect.h)`). Overrides explicit `position` and `zoom` when supplied. Applied once at setup against the renderer's current `virtualSize`.

Use for puzzle boards, arcade-style single-screen layouts, dialog-scene insets — anywhere the framed area is known up front. Pair with no `follow` and the camera never moves; pair with `follow` and the camera starts framing the rect, then tracks the target from there.

```ts
this.spawn(CameraEntity, {
  fitTo: { x: 0, y: 0, width: 800, height: 600 },
});
```

For runtime re-framing, set `position` and `zoomTo()` directly on the camera — `fitTo` is a one-shot, not a responsive binding.

## Render Layers

Layers are declared per scene and materialized by the renderer's
`beforeEnter` hook into a `SceneRenderTree` registered on scene scope.

```ts
import type { LayerDef } from "@yagejs/renderer";
import { Scene } from "@yagejs/core";

class GameScene extends Scene {
  readonly name = "game";
  readonly layers: readonly LayerDef[] = [
    { name: "background", order: -10 },
    { name: "world", order: 0 },
  ];
}
```

**The `"default"` layer.** Every scene's tree auto-creates a layer named `"default"` at order 0; any sprite/text/graphics with no explicit `layer` renders there. Declaring `{ name: "default", ... }` *configures* that pre-created layer (its `sort` / `space` / `isRenderGroup`) rather than adding a second one — `{ name: "default", sort: ySort }` is the canonical "depth-sort the layer my entities already use" setup, without setting `layer` on each component. The declared `order` is ignored (default is order 0 by definition). To change a live layer's sort after the scene is running, call `layer.setSort(fn)` — `tree.defaultLayer.setSort(ySort)`. Passing `undefined` stops the per-frame re-sort but does **not** restore the original insertion order (Pixi reorders `children` in place; clearing `sortableChildren` just halts further sorting), so children keep their last-sorted order.

**Undeclared `layer` name.** A visual component (`SpriteComponent`, `GraphicsComponent`, etc.) whose `layer` names a layer the scene never declared emits a dev-mode `[yage]` warning (naming the entity, the missing layer, and the scene) and falls back to the `"default"` layer — the visual still renders, just on the wrong layer. The fix is to add `{ name: "<layer>", order: N }` to the scene's `layers`.

### Camera binding rule

A `CameraEntity` spawned without explicit `bindings` auto-binds every
world-space layer in the scene tree (`LayerDef.space === "world"`, the
default). Declare a layer with `space: "screen"` to keep it fixed to the
viewport — cameras skip it on auto-bind.

```ts
readonly layers: readonly LayerDef[] = [
  { name: "background", order: -10 },                  // world-space (default)
  { name: "world",      order: 0 },                    // world-space
  { name: "hud",        order: 100, space: "screen" }, // screen-space HUD
];
```

Plugins auto-provision screen-space layers via
`tree.ensureLayer(def, { space: "screen" })`. The UI packages
(`@yagejs/ui`, `@yagejs/ui-react`) do this for their `"ui"` layer, so a
bare `new UISurface()` stays pinned to the viewport under the default
camera.

Diegetic UI (entity-anchored prompts, health bars, damage numbers) is a
legitimate use case: declare a world-space layer and parent a
`UISurface({ layer: "..." })` into it — the panel's container scrolls and
zooms with the camera.

To override: pass explicit `bindings` on the camera. Explicit bindings
ignore `space` and target exactly the layers named, which is how you
bind a screen-space layer to a second camera or build parallax.

### `LayerDef.sort` — per-frame paint order

Default paint order within a layer is **insertion order** — sprites render in the order their containers were added. Set `LayerDef.sort` to a **depth-key function** `(container) => number` and `DisplaySystem` writes the result to `container.zIndex` for every child each frame; Pixi's render pipeline then orders the layer by zIndex. The hook also flips `container.sortableChildren = true` so Pixi knows to honour the zIndex.

Two built-in helpers cover the common cases:

| Helper | Returns |
|---|---|
| `ySort` | `c.position.y` — classic top-down depth, characters with higher y paint on top. |
| `ySortBy(offsetOf)` | `c.position.y + offsetOf(c)` — each container can provide a per-sprite Y offset (Godot's `y_sort_origin`) so the depth key tracks the visual "footprint" instead of the top-left. `offsetOf` returns `undefined` to fall through to plain `position.y`. |

```ts
import { ySort, ySortBy, type LayerDef } from "@yagejs/renderer";

readonly layers: readonly LayerDef[] = [
  { name: "ground", order: -10 },
  { name: "characters", order: 0, sort: ySort },
];

// Per-sprite offset variant — read off a custom field on the display object:
const sort = ySortBy((c) => (c as { depthOffset?: number }).depthOffset);
```

Game code that manually writes `child.zIndex` on individual sprites doesn't need `sort` — once `sortableChildren` is on, Pixi sorts them. `sort` is for the common case where the depth key is a function of the sprite's current state (position, depth offset) and needs to be recomputed each frame. The two paths compose: a `sort` fn handles the bulk of a layer, and individual sprites can still write their own `zIndex` between updates to bias themselves above or below the depth key.

### `SortGroupComponent` — keep a multi-part entity from splitting

Under a layer `sort`, every visual is a flat child of the layer with its own independent depth key. So a multi-part entity — a body plus an offset child sprite (held item, mount, floating crystal) — can be **split**: an unrelated entity whose key falls between the parts renders *between* them. (Unity's `SortingGroup`, Godot's nested y-sort scopes.)

`SortGroupComponent` gives an entity its own Pixi sub-container. Its members sort *within* the group; the group sorts as **one unit** against the rest of the layer.

```ts
import { SortGroupComponent, SpriteComponent } from "@yagejs/renderer";

class Knight extends Entity {
  setup() {
    this.add(new Transform({ position: { x: 200, y: 200 } }));
    this.add(new SortGroupComponent({ layer: "world" })); // add BEFORE the visuals
    this.add(new SpriteComponent({ texture: "knight-body", layer: "world" }));
    this.spawnChild("weapon", Weapon); // a "world" sprite offset toward the camera
    this.spawnChild("plume", Plume);
  }
}
```

`new SortGroupComponent(options?)`:

| Option | Meaning |
|---|---|
| `layer` | Layer the group renders into (default `"default"`). Subtree visuals targeting **this same layer** are gathered in; visuals on other layers are left alone (a child's shadow can stay on a separate `"ground"` layer). |
| `innerSort` | Depth key for ordering the group's own members. Default (unset): members keep **insertion order**, and a member's manually-set `zIndex` is honoured (a real stacking context — like Unity's `SortingGroup`). Pass `ySort` to order members by position among themselves while the group still sorts as one unit. |

Semantics:

- **Sort key** — the group sorts in the layer by the owning entity's *own* sprite (so `ySort`/`ySortBy` read a real sprite's position/offset). A group-owning entity with no sprite of its own falls back to a proxy at its `Transform` world position — fine for a purely-logical parent that just groups children.
- **Transforms are untouched.** The group container stays at identity/origin; members keep their normal world transforms. Adding a group changes paint **order** only — never position, rotation, or scale (those stay composed by the ECS `Transform`). Rotating the parent rotates the children exactly as before.
- **Add the group before the visuals it should capture.** It also re-homes any already-present subtree visuals when added late, and re-homes after save/load (`@serializable`; `innerSort` is code-only and not serialized).
- A `SortGroupComponent` on a *descendant* entity starts its own independent unit rather than nesting inside the ancestor's. Sort grouping and transform parenting are independent axes.

Tradeoff: a grouped entity's parts no longer individually interleave with the world — the whole entity sorts at one key. That's the point (parts stay welded), but it means a tall entity can't have its base pass behind a tree while its top passes in front. Group only the entities that need to stay coherent.

### `LayerDef.isRenderGroup` — Pixi render-group opt-in

`isRenderGroup: true` promotes the layer's container to a Pixi v8 render
group. Render groups render as a separate pass with their own instruction
set and have their transforms handled on the GPU, which can be useful for
isolating large, slow-changing subtrees from per-frame transform updates.

Default: `false`. Render groups carry a small fixed cost (their own
render pass + instruction set) — only flip on layers where you've
measured a benefit.

```ts
readonly layers: readonly LayerDef[] = [
  { name: "ground",  order: -10 },
  { name: "actors",  order: 0,   isRenderGroup: true },
  { name: "hud",     order: 100, space: "screen" },
];
```

**Not** required for filter isolation around tilemaps. `@yagejs/tilemap`'s
`TilemapPlugin` already patches `@pixi/tilemap`'s `TilemapPipe` so a
filtered sibling layer no longer causes the canopy to drift, regardless
of render-group configuration. See `packages/tilemap/src/patch-tilemap-pipe.ts`.

### CameraBinding — per-axis ratios

Each binding has three independent ratios, all defaulting to `1` (full
camera effect). `0` ignores that axis of the camera; values in between
blend linearly.

```ts
interface CameraBinding {
  layer: string;
  translateRatio?: number; // 1 = follow camera position, 0 = stay at world origin
  rotateRatio?: number;    // 1 = rotate with camera,      0 = stay upright
  scaleRatio?: number;     // 1 = zoom with camera,        0 = constant size
}
```

These are **layer-level decoupling primitives** — useful for parallax,
minimaps, and decoupled HUDs. They are **not** the right answer for
entity-anchored UI like nameplates or health bars: partially ignoring
the camera transform on one layer while the main scene takes the full
transform separates the UI from its target under zoom. For that, see
`ScreenFollow` below.

Recipes:

```ts
// Parallax (translate-dampened)
{ layer: "background", translateRatio: 0.5 }

// Camera-agnostic minimap (ignores every camera axis)
{ layer: "minimap", translateRatio: 0, rotateRatio: 0, scaleRatio: 0 }
```

## ScreenFollow

Component. Each frame projects a world source through a camera and writes the resulting screen coord to this entity's `Transform.worldPosition`. The canonical billboard primitive — pair with `UISurface`/`UIRoot` on a screen-space layer using `positioning: "transform"` and the UI tracks the target while staying axis-aligned and constant-size under any camera zoom or rotation.

```ts
import { ScreenFollow } from "@yagejs/renderer";
import { UISurface, Anchor } from "@yagejs/ui";

class Nameplate extends Entity {
  constructor(private readonly target: Entity, private readonly camera: CameraEntity) {
    super();
  }
  setup() {
    this.add(new Transform());
    this.add(new ScreenFollow({
      target: this.target,            // Entity | Vec2Like | () => Vec2Like
      camera: this.camera,             // required — no global "main" camera
      offset: new Vec2(0, -40),        // screen-pixel offset (applied after projection)
      trackRotation: false,            // default: don't copy target's rotation
    }));
    const panel = this.add(new UISurface({
      positioning: "transform",        // reads Transform.worldPosition each frame
      anchor: Anchor.BottomCenter,     // pivot on the panel
    }));
    panel.text("Grunt-42", { fontSize: 11, fill: 0xffffff });
  }
}
```

`target` accepts:
- `Entity` — reads its current `worldPosition` each frame.
- `Vec2Like` — a fixed world coord.
- `() => Vec2Like` — computed each frame (useful for midpoints of two entities, paths, etc.).

`offset` is in **screen pixels**, applied *after* projection: `cam.worldToScreen(target) + offset`. The visual gap between UI and target stays fixed under any camera zoom or rotation. Rotation is optional: set `trackRotation: true` when `target` is an `Entity` to copy its `worldRotation` (useful for UI that should rotate with the target itself, like a vehicle HUD).

```ts
import { SceneRenderTreeKey } from "@yagejs/renderer";

// Inside a Component:
const tree = this.use(SceneRenderTreeKey);
const layer = tree.get("world");
layer.container.addChild(myDisplayObject);

// Also resolvable from a Scene subclass (onEnter onward) — Scene.use is
// scope-aware, so a scene-scoped effect/mask can be attached at setup:
class MyScene extends Scene {
  onEnter() {
    this.use(SceneRenderTreeKey).fx.addEffect(crt());
  }
}
```

Don't use `SceneRenderTreeProviderKey` from game code — it's tooling-only
(inspector/debug/save enumerate trees across scenes). Resolve the tree for
the current scene with `this.use(SceneRenderTreeKey)`.

`SpriteComponent`/`GraphicsComponent`/etc. take a `layer` option and handle
this internally. DisplaySystem syncs `Transform` to PixiJS display objects
each Render phase and applies camera + virtual-resolution scaling to the
world root.

## DisplaySystem

Runs in `Phase.Render`. Syncs entity `Transform` to PixiJS display object positions, applying camera offset and zoom.

## Scene Transitions

Built-in visual transitions. Use with `SceneManager.push/pop/replace({ transition })`.

```ts
import { crossFade, fade, flash } from "@yagejs/renderer";

await engine.scenes.push(nextScene, { transition: fade({ duration: 0.4 }) });
await engine.scenes.push(nextScene, { transition: crossFade({ duration: 0.5 }) });
await engine.scenes.pop({ transition: flash({ duration: 0.2, color: 0xff0000 }) });
await engine.scenes.replace(newScene, { transition: crossFade({ duration: 0.5 }) });
```

| Export | Signature | Description |
|---|---|---|
| `fade` | `(opts?: { duration?: number; color?: number }) => SceneTransition` | Fade to color and back (triangle alpha ramp). Incoming scene hidden until mid-point. Default: 0.3s, black. |
| `flash` | `(opts?: { duration?: number; color?: number }) => SceneTransition` | Flash overlay decaying from full to zero alpha. Incoming scene revealed under the bright part of the flash. Default: 0.2s, white. |
| `crossFade` | `(opts?: { duration?: number }) => SceneTransition` | Cross-dissolve between scenes (outgoing alpha 1→0 while incoming alpha 0→1). Default: 0.4s. |
| `getSceneContainer` | `(ctx: SceneTransitionContext, scene: Scene \| undefined) => Container \| undefined` | Helper for custom transitions — resolves a scene's PIXI root container. |

`fade` and `flash` add a stage-level `Graphics` overlay during the transition and clean up on `end()`. `crossFade` manipulates per-scene containers directly via `getSceneContainer`.

## Effects

Handle-based filter API. Same shape at four scopes — component, layer, scene, screen — exposed uniformly as `.fx` at every scope. The renderer ships only the primitives; pre-built presets live in `@yagejs/effects`.

```ts
import { rawFilter } from "@yagejs/renderer";
import { hitFlash, bloom, crt, vignette } from "@yagejs/effects";

// Component scope (Sprite / Graphics / Text / AnimatedSprite)
const flash = sprite.fx.addEffect(hitFlash({ color: 0xffffff }));
flash.trigger();
flash.fadeOut(200);                   // returns a Process

// Layer scope
this.use(SceneRenderTreeKey).get("world").fx.addEffect(bloom({ threshold: 0.8 }));

// Scene scope (the per-scene root)
this.use(SceneRenderTreeKey).fx.addEffect(crt({ scanlines: true }));

// Screen scope (cross-scene; on app.stage)
this.use(RendererKey).fx.addEffect(vignette({ alpha: 0.4 }));

// Recover a handle by registered definition after save/load
const restored = sprite.fx.findEffect(hitFlash);  // EffectHandle | null
```

| Export | Signature | Description |
|---|---|---|
| `.fx` (on every scope) | `EffectsHost` | Per-scope holder. `addEffect(factory)`, `findEffect(definition)`, `serialize()`, `restore(snap)`, `destroy()`, `size`. The underlying `EffectStack` is built lazily on first attach. |
| `EffectsHost` | class | Constructor: `(getContainer: () => Container, scope: EffectScope, makeQueue: (() => ScopedProcessQueue) \| undefined)`. Auto-built on each scope's host object — components, layers, scenes, the renderer. |
| `EffectHandle` | interface | `remove()` / `setEnabled(on)` / `enabled` / `setIntensity(value)` / `fadeIn(duration): Process` / `fadeOut(duration): Process` / `run(p: Process): Process`. `setIntensity` clamps to 0–1 and controls the effect's primary intensity. `run` schedules a `Process` scoped to the effect's lifetime — pauses with the owning scene, time-scales with it, auto-cancels when the effect is removed. |
| `Effect.onActivate?(base)` | optional factory hook | Runs once after `buildExtras` has merged its keys onto the handle. Use to self-schedule per-effect tickers via `base.run(...)` so callers don't have to call `step(dt)` themselves (e.g. CRT noise animator). `buildExtras` itself stays pure — no side effects there. |
| `defineEffect` | `<H, O>({ name, factory: (opts: O) => Effect<H> }) => (opts: O) => EffectFactory<H>` | Register a preset under a stable string name. The returned callable produces save-aware factories — built effects are tagged with `{ name, options }` for snapshot round-trip. |
| `rawFilter` | `(filter: Filter, opts?: { intensity?: { get, set } }) => EffectFactory` | Escape hatch for any pixi `Filter`. Without `intensity`, fade calls no-op + warn once. NOT serializable. |
| `EffectStack` | class | Internal — `EffectsHost` owns one. `serialize() / restoreFrom(snap)` for save/load. |
| `EffectStackSnapshot` | type | `{ entries: { name, options, intensity, enabled }[] }`. Emitted by `serialize`. |

**Filter ordering:** pixi processes filters bottom-up the display tree — component → layer → scene → screen. Each outer scope sees the previous scope's rasterized output, so screen-scope `pixelate` will pixelate already-bloomed gameplay.

**Layer-scope coordinate space:** layer / scene / screen filters operate on screen-space pixels post-camera-transform. A bloom radius is in screen pixels, not world units.

**Lifecycle:**
- Component effects: torn down in the visual component's `onDestroy`. Fades pause + time-scale with the entity's scene.
- Layer / scene effects: torn down on scene exit. Fades pause + time-scale with that scene.
- Screen effects: torn down on `RendererPlugin.onDestroy` (engine teardown). Fades run in engine time, do NOT pause across scenes.

## Masks

```ts
import { rectMask, spriteMask, graphicsMask } from "@yagejs/renderer";

// Component scope (4 visual components)
const handle = sprite.setMask(rectMask({ x: 0, y: 0, width: 200, height: 200 }));
handle.setInverse(true);
sprite.clearMask();

// Layer + scene scope share the same setMask / clearMask shape.
tree.get("hud").setMask(rectMask({ ... }));
tree.setMask(graphicsMask((g) => { g.circle(0, 0, 100).fill(0xffffff); }));
```

| Export | Signature | Description |
|---|---|---|
| `setMask` (component / layer / scene) | `(factory: MaskFactory) => MaskHandle` | Replace any existing mask. Handle owns the new mask's lifecycle. |
| `clearMask` (component / layer / scene) | `() => void` | Detach + destroy the current mask. |
| `MaskHandle` | interface | `remove()` / `setInverse(on)` / `inverse` / `redraw()` / `serialize(): MaskSnapshot \| null`. |
| `rectMask` | `(opts: RectMaskOptions) => MaskFactory` | Static rectangle, optional `rounded` corners. Serializable. |
| `spriteMask` | `(sprite: Sprite) => MaskFactory` | User-owned sprite as mask. NOT serializable (no string identity for the sprite). |
| `graphicsMask` | `(draw: (g: Graphics) => void) => MaskFactory` | Custom drawn mask; call `handle.redraw()` after dependencies change. NOT serializable (closure can't be saved). The closure must `g.clear()` first (pixi commands accumulate) and read live state from a captured object/getter — `const` snapshots stay stale across `redraw()`. |
| `defineMask` | `<O>({ name, factory: (opts: O) => Mask }) => (opts: O) => MaskFactory` | Register a savable mask preset. Only `rectMask` uses this today. |
| `attachMask` / `restoreMask` | low-level helpers | `attachMask(target, factory)` returns a `MaskHandle`; `restoreMask(target, snap)` reattaches from a snapshot. |

## Offscreen render targets

`renderer.createRenderTarget(source, options)` draws a container into a texture the game owns and redraws on its own schedule. Use it when several objects must composite against each other before reaching the screen (a light buffer, a trail buffer, a downscaled blur source), or to cache expensive static content as one texture.

```ts
import { Container, Graphics } from "pixi.js";
import { RendererKey, SpriteComponent, registerTexture } from "@yagejs/renderer";

const renderer = this.context.resolve(RendererKey); // in a Scene

// Build the offscreen content. Keep it out of the scene render tree.
const buffer = new Container();
const darkness = new Graphics().rect(0, 0, 1280, 720).fill({ color: 0x05060a, alpha: 0.85 });
const hole = new Graphics().circle(400, 300, 120).fill({ color: 0xffffff });
hole.blendMode = "erase";                 // cuts the darkness INSIDE the buffer
buffer.addChild(darkness, hole);

const target = renderer.createRenderTarget(buffer, {
  width: 1280,
  height: 720,
  resolutionScale: 0.5,                   // quarter the texels; invisible on soft gradients
});

// Show the result like any other texture.
registerTexture("lighting", target.texture);
overlay.add(new SpriteComponent({ texture: "lighting", layer: "overlay" }));

// In a component's update: redraw only when the content changed.
hole.position.set(player.x, player.y);
target.invalidate();
target.renderIfNeeded();
```

| Member | Signature | Description |
|---|---|---|
| `RendererPlugin.createRenderTarget` | `(source: DisplayContainer, options: RenderTargetOptions) => RenderTargetHandle` | Allocate the buffer. The repeatable counterpart of `createTexture`, which bakes once and never changes. |
| `RenderTargetOptions` | `{ width, height, resolutionScale?, antialias?, clearColor?, label? }` | `width` / `height` are in source coordinates. `resolutionScale` (default `1`) multiplies the renderer's own resolution. `clearColor` defaults to transparent. |
| `handle.texture` | `TextureResource` | What the buffer draws into. Feed it to `SpriteComponent` (via `registerTexture`), `spriteMask`, or a filter uniform. |
| `handle.render()` | `() => void` | Draw now and clear the pending flag. |
| `handle.renderIfNeeded()` | `() => boolean` | Draw only when pending; returns whether it drew. |
| `handle.invalidate()` | `() => void` | Mark the buffer stale. |
| `handle.needsRender` | `boolean` | Whether a render is pending. |
| `handle.resize(w, h, scale?)` | `(number, number, number?) => void` | Resize and mark stale. Anything showing the texture picks up the new size on its next draw. Omitting `scale` keeps the configured `resolutionScale`, re-derived against the renderer's current resolution; passing one replaces it. |
| `handle.width` / `height` / `resolution` | `number` | Measured size in source coordinates, and the texels-per-pixel actually allocated. |
| `handle.destroy()` | `() => void` | Free the texture's GPU memory. Repeatable. |

Semantics:

- **Coordinate space.** The buffer is drawn in the source container's OWN space: a child at local `(100, 50)` lands at texture pixel `(100, 50)`. Ancestor transforms never reach it, so neither the camera nor the responsive `fit` scale moves or resizes the content. To follow the camera, move the source's children yourself. `camera.position` alone is not enough once zoom, rotation, or shake are in play — run the world point through `camera.worldToScreen(x, y)` and place the child at the result, or size the buffer to `renderer.visibleVirtualRect`.
- **The source's own transform DOES apply.** Setting `source.position` or `source.scale` shifts everything inside the texture. Leave the source untransformed unless that is what you want.
- **Keep the source out of the scene render tree.** Pixi promotes a rendered container to a render group, which changes how it batches wherever it is parented, and content drawn into a buffer is normally shown through the buffer's texture rather than twice.
- **A hidden source draws nothing.** Pixi skips a container with `visible === false`; the pending flag is kept — and set, if the draw was forced — so the buffer catches up when it is shown again.
- **A destroyed source throws.** Once the source container is destroyed the buffer can never draw again, so `render()` and `renderIfNeeded()` throw a named error rather than leaving a permanently stale texture. Destroy the target alongside its source.
- **`resolutionScale` costs sharpness, not layout.** Only the texel count drops. The one exception is rounding: Pixi stores whole texels, so a `width × resolution` that lands between them is rounded up and the measured size grows to match — at `resolutionScale: 0.25` on a resolution-2 renderer, `resize(1279, 719)` measures `1280 × 720`. Use sizes that divide evenly by the effective resolution if the exact measurement matters. Worth it for gradients and glows, not for text or pixel art.
- **A registered key outlives the target.** `registerTexture(key, handle.texture)` keeps handing out that texture after `destroy()` — pair the teardown with `unregisterTexture(key)` or the next lookup resolves a destroyed texture.
- **Cost.** Every `render()` is a full draw of the source plus a render-target switch. A buffer that only changes when the game state does should be invalidated on that change, not every frame. A buffer that tracks moving content pays that cost per frame — `resolutionScale` is the lever there.
- **Backends.** Pixi's default backend order is WebGL first, so a game that doesn't pass `pixi: { preference: "webgpu" }` runs on WebGL. Blend behaviour inside a render target, `"erase"` included, is verified on WebGL and unmeasured on WebGPU.

## Save/load (effects + masks)

Effects and masks survive `SaveService.saveSnapshot` / `loadSnapshot` round-trips when built from `defineEffect` / `defineMask` registered factories.

- **Component scope** — each visual component's `serialize()` includes `effects` + `mask` fields and restores them in `afterRestore` (after `onAdd`).
- **Layer / Scene / Screen scope** — the renderer registers a `SnapshotContributor` with `SaveService` (key `"renderer"`) on plugin install. The contributor walks every live `SceneRenderTree`, captures its scene-scope + per-layer effects + masks, plus the screen-scope stack on `app.stage`. Restored after every scene + entity is hydrated.
- **Unsavable entries** — `rawFilter`, `spriteMask`, and `graphicsMask` skip the snapshot with a one-shot warning. Use `defineEffect` / `defineMask` for anything you want to round-trip.
- **In-flight fades** are NOT preserved — only steady-state intensity + enabled.

`@yagejs/save` is an *optional* peer dep of `@yagejs/renderer`; without it, component-scope effects still serialize (through the visual components' own snapshot path), but the layer/scene/screen-scope contributor is skipped.

## Asset Factories

```ts
import { texture, spritesheet, renderAsset, bitmapFont, webFont } from "@yagejs/renderer";

// Returns AssetHandle<Texture> for preloading
const heroTex = texture("hero.png");
const sheet = spritesheet("characters.json");
const asset = renderAsset("ui-atlas.json");
// AssetHandle<BitmapFont> — a BMFont .fnt/.xml + atlas. The loaded font
// registers under the fontFamily in the descriptor; pass that name as
// `style.fontFamily` (with `bitmap: true`) on TextComponent / UIText.
const pixelFont = bitmapFont("fonts/press-start.fnt");
// AssetHandle<FontFace[]> — a plain .ttf/.woff/.woff2 for canvas Text. The
// face registers under `family` (pass that as `style.fontFamily`); omit to let
// Pixi derive it from the file name. Preload it so the face is ready before the
// first draw — Pixi caches fallback metrics on first paint otherwise.
const uiFont = webFont("fonts/Inter.woff2", { family: "Inter" });
// Pass `bitmap` to ALSO bake a BitmapText atlas under the same family, so the
// one declared font works as canvas Text (no `bitmap`) and as a bitmap atlas
// (`bitmap: true`) — see `webFont({ bitmap })` below.
const dualFont = webFont("fonts/Inter.woff2", { family: "Inter", bitmap: true });

// Use in Scene.preload:
class MyScene extends Scene {
  readonly preload = [heroTex, sheet, pixelFont, uiFont];
}
```

### Runtime textures

**`registerTexture(key, texture)` / `unregisterTexture(key)`** — register a runtime-created texture under an asset key so every key-based surface resolves it exactly like a preloaded asset: `texture: key` on `SpriteComponent`, `{ sheet: key, frameWidth }` on any `FrameSource`, `textureKey: key` on particle emitters.

```ts
import { registerTexture, RendererKey, SpriteComponent, AnimatedSpriteComponent } from "@yagejs/renderer";

// One-frame case: draw → register → reference by key.
const renderer = this.context.resolve(RendererKey);  // in a Scene
registerTexture("marker", renderer.createTexture((g) => g.circle(8, 8, 8).fill(0xff0000)));
entity.add(new SpriteComponent({ texture: "marker" }));

// Runtime animation: bake the frames as ONE horizontal strip (x = i * frameWidth),
// register it, and reference it as a strip FrameSource.
const strip = renderer.createTexture((g) => {
  for (let i = 0; i < 4; i++) g.circle(i * 32 + 16, 16, 6 + i * 2).fill(0xffcc00);
});
registerTexture("boss-idle", strip);
boss.add(new AnimatedSpriteComponent({ source: { sheet: "boss-idle", frameWidth: 32 } }));
```

Semantics:

- **Save contract.** Snapshots store only the key. Re-register the texture under the same key before restoring (the same boot code that registered it on first run); on the sprite and animation surfaces, resolving a missing key throws, naming the key — no component is silently dropped. Particles' `textureKey` lookup has no such guard: a missing key resolves `undefined` with only Pixi's generic cache warning.
- Registered keys are engine-global, outside the asset manager's ref counts, and live until `unregisterTexture(key)`.
- `unregisterTexture` never destroys the texture — the creator owns the GPU resource; call `texture.destroy()` once nothing draws it. No-op for keys it never registered.
- Re-registering a key replaces the entry; components constructed before the replacement keep the old texture instance (resolution happens at construction).
- Registering a key already used by a loaded asset (or any cache entry the API didn't create) throws — shadowing a loaded asset would let that asset's unload destroy the registered texture.

**`installBitmapFont(source, opts)`** — bake a bitmap glyph atlas from a `.ttf`/`.woff` at runtime via Pixi v8's `BitmapFont.install`. Returns the registered font name, ready to pass as `style.fontFamily` (with `bitmap: true`):

```ts
import { installBitmapFont, TextComponent } from "@yagejs/renderer";

const font = await installBitmapFont("fonts/PressStart2P.ttf", {
  name: "PressStart",
  size: 16,            // glyph bake size (default 32)
  resolution: 2,       // crisp when upscaled (default 2)
  // chars: [["a","z"],["A","Z"],"0123456789 .,!?"],  // default: alphanumeric
  // style: { fill: 0x00ff00 },                        // bake a fixed colour
});
entity.add(new TextComponent({ text: "READY", bitmap: true, style: { fontFamily: font, fill: 0xffcc00 } }));
```

Glyphs bake **white** by default so a per-text `fill` / `tint` (multiplied over the atlas) can recolour them — a black atlas would yield `black × tint = black`. Set `style.fill` only to bake a fixed colour. To recolour at runtime use `mergeStyle({ fill })` so `fontFamily` survives — `setStyle({ fill })` replaces the style and drops the font.

**Teardown — `uninstallBitmapFont(name)`.** Frees the baked atlas (and every variant) plus the source face when a font is no longer rendered; the symmetric counterpart of `installBitmapFont` (without it an install-once atlas lives until the page unloads). Baked bitmap fonts are **reference-counted by family name**, so a family shared by an `installBitmapFont` *and* a `webFont({ bitmap })` (or two web-font loads) is only destroyed once the **last** owner releases it — `uninstallBitmapFont` and `webFont` unload are safe to interleave on a shared family. (The same family name pointing at two *different* source fonts still collides in Pixi's global registry — last bake wins — so keep family names unique.)

**Synthetic bold / italic — `variants`.** Plain `BitmapText` ignores `style.fontWeight` / `fontStyle` (only canvas `Text` honours them). Pass `variants` to bake emphasis atlases from the same `.ttf` alongside the base; a `BitmapText` whose style asks for bold/italic then renders from the matching atlas automatically. Variants register under derived names internally — you never name or select them by hand:

```ts
await installBitmapFont("fonts/Body.ttf", {
  name: "Body",
  variants: [
    { fontWeight: "bold" },                    // → "Body bold"
    { fontStyle: "italic" },                   // → "Body italic"
    { fontWeight: "bold", fontStyle: "italic" }, // → "Body bold italic"
  ],
});

// Resolves the bold atlas — no manual font name needed:
new TextComponent({ text: "HP", bitmap: true, style: { fontFamily: "Body", fontWeight: "bold" } });
```

`BitmapFontVariant` is `{ fontWeight?, fontStyle?, style? }`; the optional per-variant `style` layers extra `TextStyle` props onto that atlas only. `fontWeight` is matched on the bold axis (`"bold"`/`"bolder"` or numeric `>= 600`), `fontStyle` on the slant axis (`"italic"`/`"oblique"`); a request with no matching variant falls back to the base atlas.

All variants are **baseline-aligned** to the base atlas at bake time: each variant's `baseLineOffset` and `lineHeight` are normalized to the base font's, so a bold span and regular text sit on one shared baseline with no vertical drift (synthetic faux-bold/italic otherwise measure to a different baseline even from one source font).

**Declarative bitmap bake — `webFont({ bitmap })`.** A `webFont` can bake a bitmap atlas from the same loaded face during the scene's `preload`, so one declared font is usable as both canvas `Text` and `BitmapText` under a single family — no separate `installBitmapFont` call, no second name. The canvas face and the baked atlas live in separate Pixi registries, so there's no collision.

```ts
import { webFont, TextComponent } from "@yagejs/renderer";

class HudScene extends Scene {
  readonly preload = [
    // `bitmap: true` bakes with defaults; pass an object to tune it.
    webFont("fonts/Inter.woff2", {
      family: "Inter",
      bitmap: { size: 24, variants: [{ fontWeight: "bold" }] },
    }),
  ];
}

// Same family, both paths:
new TextComponent({ text: "menu", style: { fontFamily: "Inter" } });                 // canvas Text
new TextComponent({ text: "SCORE", bitmap: true, style: { fontFamily: "Inter" } });  // bitmap atlas
```

`WebFontBakeOptions` is `{ size?, chars?, resolution?, padding?, style?, variants? }` — the same options as `installBitmapFont` minus `name`/`family` (the atlas always registers under the web font's `family`). `bitmap` **requires** `family`; without it the bake is skipped with a warning (the atlas needs a stable name to register under and uninstall on scene teardown). When the web font is unloaded, its canvas face is dropped and its hold on the baked atlas is released — the atlas (base + variants) is `BitmapFont.uninstall`ed only once every owner sharing the family (another web-font load, or an `installBitmapFont`) has released it. Two scenes preloading the same `webFont` are reference-counted by the `AssetManager`, so the atlas survives until the last scene unloads it.

# @yagejs/renderer

Depends on `@yagejs/core`, `pixi.js`. PixiJS v8 rendering behind the YAGE plugin interface.

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
- Writes `image-rendering: -webkit-optimize-contrast; image-rendering: pixelated;` onto the canvas `style.cssText` so the browser scales the backing store with nearest-neighbor (the Safari fallback is the first declaration; modern browsers pick the second from the cascade).

Default: `false`. Composes with `pixi`: explicit `pixi: { roundPixels: false }` wins over the preset, so games can opt parts back out. Per-texture overrides (`source.scaleMode = "linear"` on a specific texture) keep working — the preset only sets the *default*.

```ts
new RendererPlugin({
  width: 320, height: 240,
  container: host,
  pixelArtPreset: true,
});
```

Registers `RendererKey`, `SceneRenderTreeProviderKey`, and the cross-package `RendererAdapterKey` (from `@yagejs/core`, consumed by `@yagejs/input`) in `EngineContext`, plus a `beforeEnter` scene hook that materializes a per-scene `SceneRenderTree` (accessible via the scene-scoped `SceneRenderTreeKey`).

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

**Give the fit container a bounded height.** The fit host's size is fed back into the canvas every resize, so a container with no height of its own (only content-driven height) has no stable size and the observer can grow without bound. The renderer sets `display:block` on the canvas (kills the ~4px inline-canvas baseline gap that otherwise drives this), which makes the common case converge with zero CSS — but you still want the container to have an explicit or bounded height (`height: 100%` under a sized ancestor, or `max-height`). If a true feedback loop is detected anyway (residual margin / sub-pixel growth), `FitController` freezes auto-resize and logs a one-time `console.warn` rather than hang the tab.

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

Under `expand` these are the play-adjacent strips the game is expected to draw into. The `responsive-ui` example fills each with a solid dark rect plus a short gradient along the inner edge (touching the play area) so the bars read as "not the play area, but still part of the rendered world." Under `letterbox` the same rects tell you where the `backgroundColor` bars are — handy for layering optional bar customization on top of an otherwise-plain letterbox render.

Note: "screen" in the engine (UI `LayerSpace: "screen"`, `Camera.screenToWorld`) means *virtual viewport space*. The `canvasToVirtual` method is named after its inputs (DOM CSS pixels on the canvas) to avoid that collision.

Pair with `@yagejs/input` — `InputPlugin` auto-resolves the renderer via `RendererAdapterKey` (core), so pointer events target this canvas and coordinates route through `canvasToVirtual` out of the box. `InputManager.getPointerPosition()` stays correct under fit with no config.

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

Listeners are wired in `install()` (gated by `typeof document/window !== "undefined"`) and torn down in `onDestroy()`. iOS Safari requires `requestFullscreen` to run inside a user-gesture handler.

## Components

### Pick a component

| Need | Use |
|---|---|
| Render an asset / texture | `SpriteComponent` |
| Frame-based animation | `AnimatedSpriteComponent` (+ `AnimationController`) |
| Procedural shapes (debug, prototypes, gradient overlays, custom drawing) | `GraphicsComponent` |
| Text with layout, padding, backdrop, "card" widget | `UIText` + `UIPanel` from `@yagejs/ui` |
| Entity-tracked text that stays axis-aligned at any zoom (nameplates, damage numbers) | `ScreenFollow` + `UIPanel({ positioning: "transform" })` from `@yagejs/ui` |
| Free-positioned single string (debug HUD, diegetic world-space label) | `TextComponent` |

Default to `@yagejs/ui` for any text that lives inside a widget, has padding, or stacks with other rows. `TextComponent` is the narrow case where the text is its own world-space primitive with no layout.

For procedural shapes plus a label, use a parent entity with `GraphicsComponent` + a child entity with `TextComponent` — pixi v8 has no `g.text(...)` method; text is always a separate display object.

### SpriteComponent

```ts
import { SpriteComponent } from "@yagejs/renderer";

entity.add(new SpriteComponent({
  texture: "hero.png",   // string key (serializable) or Texture object
  layer: "world",         // render layer name
  anchor: { x: 0.5, y: 0.5 },
}));
```

**Escape hatch:** `.sprite` is the underlying pixi `Sprite` instance — full pixi API surface available, including `sprite.tint`. See [pixi Sprite docs](https://pixijs.com/8.x/guides/components/scene-objects/sprite).

> `sprite.tint` multiplies the source RGB by the tint colour. That's free on the GPU and right for "darken / desaturate / multiply with a colour" effects, but it turns saturated source colours into mud (a blue mushroom × yellow tint reads as olive). For replace-style recolour — where black stays black, white reaches the target colour, and midtones blend proportionally — use the `colorize` effect from `@yagejs/effects` instead.

### GraphicsComponent

Procedural drawing via PixiJS Graphics API:

```ts
import { GraphicsComponent } from "@yagejs/renderer";

entity.add(new GraphicsComponent({ layer: "world" }).draw((g) => {
  g.rect(0, 0, 50, 50).fill(0xff0000);
}));
```

Not fully serializable -- only layer is saved. Redo drawing in `afterRestore()`.

**Escape hatch:** `.graphics` (and the `g` passed to `.draw(fn)`) is a raw pixi `Graphics` with the v8 fluent API: `rect` / `circle` / `roundRect` / `poly` / `moveTo` / `lineTo` / `fill` / `stroke`. See [pixi Graphics docs](https://pixijs.com/8.x/guides/components/scene-objects/graphics).

Gradient fills: use `linearGradient` / `radialGradient` (see below) instead of reaching into `pixi.js` for `FillGradient`.

### TextComponent

Renders text on a layer, Transform-synced like sprites. For free-positioned strings only — for laid-out text widgets, use `UIPanel` + `UIText` from `@yagejs/ui` (see decision tree above).

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

**Engine default text style.** `new RendererPlugin({ defaultTextStyle: { fontFamily, fill, resolution } })` sets an app-wide base under every `TextComponent` / `UIText` `style` (per-text values win) — no need to import pixi to touch `TextStyle.defaultTextStyle`. `@yagejs/ui`'s `UIPlugin({ defaultTextStyle })` layers a UI-only override on top (precedence: per-text style > UIPlugin default > RendererPlugin default > pixi default). The default also re-applies on `setStyle`, so a recolour keeps it.

**`bitmap` is a sibling of `style`, not a style key.** Folding it into `style` (`style: { …, bitmap: true }`) is ignored and emits a dev warning — keep it top-level: `{ style: { … }, bitmap: true }`.

### AnimatedSpriteComponent

```ts
import { AnimatedSpriteComponent } from "@yagejs/renderer";

entity.add(new AnimatedSpriteComponent({
  source: { sheet: "player_idle.png", frameWidth: 48 }, // serializable
  layer: "world",
  speed: 0.15,
  autoPlay: true,
}));
```

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

`AnimationController<T extends string = string>` is generic on the animation-name union — `play("walk")` autocompletes, and a typo like `play("wal")` is a compile error. But the runtime class isn't generic: there's no `AnimationController<HeroAnim>` expression to pass to `entity.get()` or `Component.sibling()`, and a default `AnimationController<string>` isn't sound-assignable to `AnimationController<HeroAnim>` (the `current: T | ""` getter is covariant on `T`, so a string-returning instance can't substitute for one promising the narrow union). Annotate the field with an `as` cast — the cast is required because the type parameter is type-only, and the field annotation makes every downstream call site narrow for free:

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

`playOneShot(name, options?)` — `options.duration` overrides the auto-computed lock duration; the wall-clock fallback uses `(frames * 1000 / 60) / speed`. Pass an explicit `duration` when synchronising lock release across multiple controllers (see `LayeredAnimationController` below).

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

`LayeredAnimationController` is the recommended fix. If you'd rather not introduce a wrapper component — for prototypes, or when each layer already has a custom controller — the same insight can live as a one-line helper. The underlying issue: `AnimationController.playOneShot` computes its lock duration from `frames.length / speed` (rounded to whole frame-ms). When layers have different frame counts or speeds (a 12-frame outfit at `speed: 0.2` and a 10-frame body at `speed: 0.18` round differently), the locks expire on different frames and one sprite snaps back to idle while the others are still mid-swing — a single layer flickering at the tail of every attack animation.

Precompute the duration on a designated "lead" controller and broadcast it via `options.duration`:

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

`linearGradient` and `radialGradient` return a `GradientFill` (pixi `FillGradient` under the hood) usable anywhere a graphics fill style is accepted. Stops use yage-style numeric color + alpha pairs — no CSS color strings needed.

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
});

cam.unfollow();

cam.shake(10, 500, { decay: 0.02 });
cam.zoomTo(2.0, 1000, easeOutQuad);

cam.bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };

const world = cam.screenToWorld(mouseX, mouseY);
const screen = cam.worldToScreen(entity.x, entity.y);
```

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
bare `new UIPanel()` stays pinned to the viewport under the default
camera.

Diegetic UI (entity-anchored prompts, health bars, damage numbers) is a
legitimate use case: declare a world-space layer and parent a
`UIPanel({ layer: "..." })` into it — the panel's container scrolls and
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
| `ySortBy(offsetOf)` | `c.position.y + offsetOf(c)` — each container can advertise a per-sprite Y offset (Godot's `y_sort_origin`) so the depth key tracks the visual "footprint" instead of the top-left. `offsetOf` returns `undefined` to fall through to plain `position.y`. |

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
`TilemapPlugin` already runtime-patches `@pixi/tilemap`'s `TilemapPipe`
to read the currently-bound uniform group (not the stale push log) and
to use `tilemap.groupTransform` (not `worldTransform`), so a filtered
sibling layer no longer drifts the canopy regardless of render-group
configuration. See `packages/tilemap/src/patch-tilemap-pipe.ts`.

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

Component. Each frame projects a world source through a camera and writes the resulting screen coord to this entity's `Transform.worldPosition`. The canonical billboard primitive — pair with `UIPanel`/`UIRoot` on a screen-space layer using `positioning: "transform"` and the UI tracks the target while staying axis-aligned and constant-size under any camera zoom or rotation.

```ts
import { ScreenFollow } from "@yagejs/renderer";
import { UIPanel, Anchor } from "@yagejs/ui";

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
    const panel = this.add(new UIPanel({
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

await engine.scenes.push(nextScene, { transition: fade({ duration: 400 }) });
await engine.scenes.push(nextScene, { transition: crossFade({ duration: 500 }) });
await engine.scenes.pop({ transition: flash({ duration: 200, color: 0xff0000 }) });
await engine.scenes.replace(newScene, { transition: crossFade({ duration: 500 }) });
```

| Export | Signature | Description |
|---|---|---|
| `fade` | `(opts?: { duration?: number; color?: number }) => SceneTransition` | Fade to color and back (triangle alpha ramp). Incoming scene hidden until mid-point. Default: 300ms, black. |
| `flash` | `(opts?: { duration?: number; color?: number }) => SceneTransition` | Flash overlay decaying from full to zero alpha. Incoming scene revealed under the bright part of the flash. Default: 200ms, white. |
| `crossFade` | `(opts?: { duration?: number }) => SceneTransition` | Cross-dissolve between scenes (outgoing alpha 1→0 while incoming alpha 0→1). Default: 400ms. |
| `getSceneContainer` | `(ctx: SceneTransitionContext, scene: Scene \| undefined) => Container \| undefined` | Helper for custom transitions — resolves a scene's PIXI root container. |

`fade` and `flash` add a stage-level `Graphics` overlay during the transition and clean up on `end()`. `crossFade` manipulates per-scene containers directly via `getSceneContainer`.

## Effects

Handle-based filter API. Same shape at four scopes — component, layer, scene, screen — exposed uniformly as `.fx` on every attach site. The renderer ships only the primitives; pre-built presets live in `@yagejs/effects`.

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
| `.fx` (on every scope) | `EffectsHost` | Per-attach-site holder. `addEffect(factory)`, `findEffect(definition)`, `serialize()`, `restore(snap)`, `destroy()`, `size`. The underlying `EffectStack` is built lazily on first attach. |
| `EffectsHost` | class | Constructor: `(getContainer: () => Container, scope: EffectScope, makeQueue: (() => ScopedProcessQueue) \| undefined)`. Auto-built on each scope's host object — components, layers, scenes, the renderer. |
| `EffectHandle` | interface | `remove()` / `setEnabled(on)` / `enabled` / `fadeIn(duration): Process` / `fadeOut(duration): Process` / `run(p: Process): Process`. The `run` schedules a `Process` scoped to the effect's lifetime — pauses with the owning scene, time-scales with it, auto-cancels when the effect is removed. |
| `Effect.onActivate?(base)` | optional factory hook | Runs once after `buildExtras` has merged its keys onto the handle. Use to self-schedule per-effect tickers via `base.run(...)` so callers don't have to wire `step(dt)` (e.g. CRT noise animator). `buildExtras` itself stays pure — no side effects there. |
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

// Use in Scene.preload:
class MyScene extends Scene {
  readonly preload = [heroTex, sheet, pixelFont, uiFont];
}
```

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

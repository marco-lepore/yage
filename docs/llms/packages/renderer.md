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
}));
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

## Components

### SpriteComponent

```ts
import { SpriteComponent } from "@yagejs/renderer";

entity.add(new SpriteComponent({
  texture: "hero.png",   // string key (serializable) or Texture object
  layer: "world",         // render layer name
  anchor: { x: 0.5, y: 0.5 },
}));
```

### GraphicsComponent

Procedural drawing via PixiJS Graphics API:

```ts
import { GraphicsComponent } from "@yagejs/renderer";

entity.add(new GraphicsComponent({ layer: "world" }).draw((g) => {
  g.rect(0, 0, 50, 50).fill(0xff0000);
}));
```

Not fully serializable -- only layer is saved. Redo drawing in `afterRestore()`.

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

For top-left-origin games (tilemap editors, classic arcade layouts), offset the camera by half the viewport so that world `(0, 0)` aligns with the screen's top-left corner:

```ts
class GameScene extends Scene {
  readonly name = "game";

  onEnter() {
    // Top-left-origin: world (0,0) maps to screen (0,0)
    this.spawn(CameraEntity, { position: new Vec2(400, 300) }); // viewport is 800×600
  }
}
```

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
```

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

## Asset Factories

```ts
import { texture, spritesheet, renderAsset } from "@yagejs/renderer";

// Returns AssetHandle<Texture> for preloading
const heroTex = texture("hero.png");
const sheet = spritesheet("characters.json");
const asset = renderAsset("ui-atlas.json");

// Use in Scene.preload:
class MyScene extends Scene {
  readonly preload = [heroTex, sheet];
}
```

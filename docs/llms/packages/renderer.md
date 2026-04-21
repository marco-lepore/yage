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
}));
```

Registers `RendererKey` and `SceneRenderTreeProviderKey` in `EngineContext`, plus a `beforeEnter` scene hook that materializes a per-scene `SceneRenderTree` (accessible via the scene-scoped `SceneRenderTreeKey`).

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

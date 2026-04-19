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
layer in the scene tree with `autoBindable === true`. All layers
declared via `Scene.layers` are auto-bindable by default — if you
declared it, the camera follows it.

Plugins can auto-provision layers that opt *out* of auto-binding by
passing `{ autoBindable: false }` to `tree.ensureLayer(def, opts)`. The
UI packages (`@yagejs/ui`, `@yagejs/ui-react`) do this for their `"ui"`
layer, so a default camera never moves the HUD.

To override: pass explicit `bindings` on the camera. Explicit bindings
ignore `autoBindable` and target exactly the layers named.

```ts
// All custom world layers follow the camera; UI plugin layer stays put.
this.spawn(CameraEntity, { follow: player.get(Transform) });

// Parallax: named explicitly, background scrolls at half speed.
this.spawn(CameraEntity, {
  follow: player.get(Transform),
  bindings: [
    { layer: "background", translateRatio: 0.5 },
    { layer: "world" },
  ],
});
```

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

## Screen Containers

For HUD/UI layers unaffected by the camera:

```ts
const renderer = context.resolve(RendererKey);
const hudLayers = renderer.createScreenContainer("hud");
```

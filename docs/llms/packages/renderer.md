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

Registers `CameraKey`, `RenderLayerManagerKey`, `RendererKey`, `StageKey` in `EngineContext`.

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

Resolved via `CameraKey`. Pure math, no PixiJS dependency.

```ts
import { CameraKey } from "@yagejs/renderer";

const camera = context.resolve(CameraKey);

camera.follow(transform, {
  smoothing: 0.1,
  offset: { x: 0, y: -50 },
  deadzone: { halfWidth: 20, halfHeight: 20 },
});
camera.unfollow();

camera.shake(10, 500, { decay: 0.02 });
camera.zoomTo(2.0, 1000, easeOutQuad);

camera.bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };

const world = camera.screenToWorld(mouseX, mouseY);
const screen = camera.worldToScreen(entity.x, entity.y);
```

### Coordinate Convention

Camera position `(0, 0)` places the **world origin at the center of the viewport**, not the top-left. Entities rendered at `(0, 0)` appear centered. This is the standard convention for camera-driven 2D games (scrolling shooters, platformers).

For top-left-origin games (tilemap editors, classic arcade layouts), offset the camera by half the viewport so that world `(0, 0)` aligns with the screen's top-left corner:

```ts
class GameScene extends Scene {
  readonly name = "game";
  private camera = this.service(CameraKey);

  onEnter() {
    // Top-left-origin: world (0,0) maps to screen (0,0)
    this.camera.position = new Vec2(400, 300); // viewport is 800×600
  }
}
```

## Render Layers

Named draw-order layers managed by `RenderLayerManager`:

```ts
import { RenderLayerManagerKey } from "@yagejs/renderer";

const layers = context.resolve(RenderLayerManagerKey);
// Components specify layer by name: { layer: "background" }
// DisplaySystem syncs Transform -> PixiJS display objects each Render phase
```

## DisplaySystem

Runs in `Phase.Render`. Syncs entity `Transform` to PixiJS display object positions, applying camera offset and zoom.

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

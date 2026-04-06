# YAGE Quick Start

## Installation

```bash
# Meta-package (includes all plugins)
npm install yage

# Or individual packages
npm install @yage/core @yage/renderer @yage/input
```

## Minimal Example

```ts
import { createGame, defineInlineScene } from "yage";
import { Transform, Vec2 } from "@yage/core";
import { SpriteComponent } from "@yage/renderer";

const game = await createGame({
  width: 800,
  height: 600,
  backgroundColor: 0x1a1a2e,
  input: true,
  scene: defineInlineScene("main", (scene, { camera }) => {
    const player = scene.spawn("player");
    player.add(new Transform({ position: new Vec2(400, 300) }));
    player.add(new SpriteComponent({ texture: "hero.png" }));
    camera.follow(player.get(Transform));
  }),
});
```

## createGame Options

```ts
interface CreateGameOptions {
  // Renderer (always registered)
  width?: number;              // default: 800
  height?: number;             // default: 600
  virtualWidth?: number;       // virtual resolution width
  virtualHeight?: number;      // virtual resolution height
  backgroundColor?: number;    // default: 0x000000
  container?: HTMLElement | string; // CSS selector or element
  canvas?: HTMLCanvasElement;

  // Plugins (true for defaults, or pass config object)
  physics?: boolean | PhysicsConfig;
  input?: boolean | InputConfig;
  audio?: boolean | AudioConfig;
  particles?: boolean;
  tilemap?: boolean;
  ui?: boolean;
  debug?: boolean | DebugConfig;
  save?: boolean | SavePluginOptions;

  // Escape hatches
  plugins?: Plugin[];          // additional custom plugins
  engine?: EngineConfig;       // engine-level config

  // Initial scene
  scene?: Scene | InlineSceneSetup;
}
```

Returns `Promise<GameHandle>` with `engine`, `pushScene(scene)`, and `destroy()`.

## defineInlineScene

Quick prototyping without a class. Receives the scene and pre-resolved services:

```ts
defineInlineScene("level-1", (scene, { camera, input, physics, audio }) => {
  // input, physics, audio are undefined if those plugins aren't registered
  const wall = scene.spawn("wall");
  wall.add(new Transform({ position: new Vec2(0, 500) }));
  // ...
});
```

## Scene Class (Production)

For real games, subclass `Scene`:

```ts
import { Scene, Transform, Vec2 } from "@yage/core";
import { SpriteComponent } from "@yage/renderer";
import { CameraKey } from "@yage/renderer";
import { texture } from "@yage/renderer";

class GameScene extends Scene {
  readonly name = "game";
  readonly preload = [texture("hero.png"), texture("tileset.png")];

  private camera = this.service(CameraKey);

  onEnter() {
    const player = this.spawn(Player, { x: 100, y: 200 });
    this.camera.follow(player.get(Transform));
  }

  onExit() {
    // cleanup
  }
}

// Push it:
engine.scenes.push(new GameScene());
```

## Manual Engine Setup

When you need full control:

```ts
import { Engine } from "@yage/core";
import { RendererPlugin } from "@yage/renderer";
import { InputPlugin } from "@yage/input";
import { PhysicsPlugin } from "@yage/physics";

const engine = new Engine({ debug: true, fixedTimestep: 1000 / 60 });
engine.use(new RendererPlugin({ width: 800, height: 600, container: "#game" }));
engine.use(new InputPlugin({ actions: { jump: ["Space", "KeyW"] } }));
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));

await engine.start();
engine.scenes.push(new GameScene());
```

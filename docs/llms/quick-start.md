# YAGE Quick Start

## Installation

```bash
npm install @yage/core @yage/renderer
```

Add more packages as needed:

```bash
npm install @yage/physics @yage/input @yage/debug
```

## Minimal Example

```ts
import { Engine } from "@yage/core";
import { RendererPlugin } from "@yage/renderer";

const engine = new Engine();
engine.use(new RendererPlugin({ width: 800, height: 600, backgroundColor: 0x1a1a2e }));
await engine.start();
```

## Engine Setup

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

## Scene Class

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

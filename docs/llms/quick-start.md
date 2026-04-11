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

## Testing & Debugging

### Inspector (runtime queries)

When the engine is constructed with `debug: true`, it installs an introspection API on `window.__yage__`. Useful in the browser console while iterating, and for AI agents that want to verify scene state without reading the canvas:

```ts
const engine = new Engine({ debug: true });
await engine.start();

// In the browser console:
window.__yage__.inspector.snapshot();                       // full engine state
window.__yage__.inspector.getEntities();                    // all entities in active scene
window.__yage__.inspector.getEntityByName("player");        // single entity
window.__yage__.inspector.getComponentData("player", "SpriteComponent");
window.__yage__.inspector.getSceneStack();                  // scenes + pause state
window.__yage__.inspector.getErrors();                      // anything disabled by ErrorBoundary
```

`getEntities()` returns an array of `EntitySnapshot` objects with `id`, `name`, `tags`, `components` (class-name strings), and `position`, so filtering by tag or component name is a one-liner:

```ts
const enemies = window.__yage__.inspector
  .getEntities()
  .filter((e) => e.tags.includes("enemy"));
```

### Unit tests (deterministic frame stepping)

`@yage/core` ships headless test utilities. `createTestEngine()` spins up a fully-wired engine with no renderer/physics/input plugins by default — add whatever you need with `engine.use(...)`. `advanceFrames()` ticks the game loop N times so assertions run against deterministic state:

```ts
import { createTestEngine, advanceFrames, Transform, Vec2 } from "@yage/core";

const engine = await createTestEngine();
const scene = new GameScene();
engine.scenes.push(scene);
const player = scene.spawn(Player, { x: 0, y: 0 });

advanceFrames(engine, 10);
expect(player.get(Transform).position.x).toBeGreaterThan(0);
```

For component-in-isolation tests, reach for `createMockScene()` / `createMockEntity()`. See `patterns.md` → Testing Patterns for the full cookbook (component unit tests, system tests, process tests, integration tests).

# YAGE Quick Start

## Scaffolding a New Game (recommended)

```bash
npm create yage@latest my-game
cd my-game
npm run dev
```

Pick `recommended` for a playable platformer seed (physics, input, animations, enemies, collectibles) or `minimal` for an empty scene with just core + renderer.

## Manual Installation

```bash
npm install @yagejs/core @yagejs/renderer
```

Add more packages as needed:

```bash
npm install @yagejs/physics @yagejs/input @yagejs/audio @yagejs/debug
```

## Minimal Example

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";

const engine = new Engine();
engine.use(new RendererPlugin({ width: 800, height: 600, backgroundColor: 0x1a1a2e }));
await engine.start();
```

## Engine Setup

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { PhysicsPlugin } from "@yagejs/physics";

const engine = new Engine({ debug: true, fixedTimestep: 1000 / 60 });
engine.use(new RendererPlugin({ width: 800, height: 600, container: document.getElementById("game")! }));
engine.use(new InputPlugin({ actions: { jump: ["Space", "KeyW"] } }));
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));

await engine.start();
engine.scenes.push(new GameScene());
```

## Scene Class

For real games, subclass `Scene`:

```ts
import { Scene, Transform, Vec2 } from "@yagejs/core";
import { SpriteComponent, CameraEntity } from "@yagejs/renderer";
import { texture } from "@yagejs/renderer";

class GameScene extends Scene {
  readonly name = "game";
  readonly preload = [texture("hero.png"), texture("tileset.png")];

  onEnter() {
    const player = this.spawn(Player, { x: 100, y: 200 });
    const cam = this.spawn(CameraEntity, { follow: player.get(Transform) });
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
window.__yage__.inspector.time.freeze();                    // stop auto-advance
window.__yage__.inspector.time.step(1);                     // advance one frame (sync)
window.__yage__.inspector.input.keyDown("ArrowRight");      // synthetic input
window.__yage__.inspector.input.hold("ArrowRight", 30);     // press, run N frames, release
window.__yage__.inspector.snapshotJSON();                   // stable JSON snapshot
window.__yage__.inspector.setSeed(42);                      // pin every scene RNG (for replays)
window.__yage__.inspector.events.getLog();                  // recorded engine + entity events
await window.__yage__.inspector.events.waitFor("scene:pushed", { withinFrames: 30 });
```

Diagnostics that need optional plugins live under inspector extension
namespaces. For example, `DebugPlugin` registers `debug` while installed.
Pass the extension's interface as the type parameter so calls type-check:

```ts
import type { DebugDiagnostics } from "@yagejs/debug";

const debug = window.__yage__.inspector.getExtension<DebugDiagnostics>("debug");
debug?.getCameraStack();
debug?.getLayerTransform("game", "world");
```

`getEntities()` returns an array of `EntitySnapshot` objects with `id`, `name`, `tags`, `components` (class-name strings), and `position`, so filtering by tag or component name is a one-liner:

```ts
const enemies = window.__yage__.inspector
  .getEntities()
  .filter((e) => e.tags.includes("enemy"));
```

For agent-driven debugging — write a throwaway Playwright spec, boot the game, freeze the clock, drive scripted input, snapshot — see `packages/debug.md` → *Agent-driven debugging: throwaway Inspector specs*.

### Unit tests (deterministic frame stepping)

`@yagejs/core` ships headless test utilities. `createTestEngine()` spins up a fully-wired engine with no renderer/physics/input plugins by default — add whatever you need with `engine.use(...)`. `advanceFrames()` ticks the game loop N times so assertions run against deterministic state:

```ts
import { createTestEngine, advanceFrames, Transform, Vec2 } from "@yagejs/core";

const engine = await createTestEngine();
const scene = new GameScene();
engine.scenes.push(scene);
const player = scene.spawn(Player, { x: 0, y: 0 });

advanceFrames(engine, 10);
expect(player.get(Transform).position.x).toBeGreaterThan(0);
```

For component-in-isolation tests, reach for `createMockScene()` / `createMockEntity()`. See `patterns.md` → Testing Patterns for the full cookbook (component unit tests, system tests, process tests, integration tests).

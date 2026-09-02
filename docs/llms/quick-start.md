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

Gameplay addons (dialogue, inventory, quests, and more) ship under the separate `@yagejs-addons/*` scope. Their docs are co-located at `packages/addons/<name>/docs/llms/`; the full list is in `llms.txt`.

## Versioning

The `@yagejs/*` packages are released as a set: one version across all of them, each requiring the others at that same minor. Upgrade them together, naming every `@yagejs/*` package in your `package.json` — the command below is an example, not the full set, and a package left out is a package not upgraded.

```bash
npm install @yagejs/core@latest @yagejs/renderer@latest @yagejs/input@latest
```

Upgrading one package to a new minor alone can install two copies of a shared package — e.g. a newer `@yagejs/save` beside an older `@yagejs/renderer` yields two `@yagejs/core` instances with separate service containers and class identities. npm reports some of these as a version conflict and nests others silently, so a completed install is not proof the versions match. Fix a reported conflict by upgrading the set, not with `--force` or `--legacy-peer-deps`.

`@yagejs-addons/*` packages version independently and each declares the engine minor it supports.

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

const engine = new Engine({ debug: true, fixedTimestep: 1 / 60 });
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

An engine constructed with `debug: true` installs an introspection API on `window.__yage__` during `engine.start()`. Useful in the browser console while iterating, and for AI agents that want to verify scene state without reading the canvas:

```ts
const engine = new Engine({ debug: true });
engine.use(new DebugPlugin()); // inspector.time (freeze/step) needs DebugPlugin
engine.use(new InputPlugin({ actions: {} })); // inspector.input needs InputPlugin
await engine.start();

// In the browser console:
window.__yage__.inspector.snapshot();                       // full engine state
window.__yage__.inspector.getEntities();                    // all entities in active scene
window.__yage__.inspector.getEntityByName("player");        // single entity
window.__yage__.inspector.getComponentData("player", "SpriteComponent");
window.__yage__.inspector.getSceneStack();                  // scenes + pause state
window.__yage__.inspector.getErrors();                      // failures recorded by ErrorBoundary
window.__yage__.inspector.time.freeze();                    // stop auto-advance
window.__yage__.inspector.time.step(1);                     // advance one frame (sync)
window.__yage__.inspector.input.keyDown("ArrowRight");      // synthetic input
window.__yage__.inspector.input.hold("ArrowRight", 30);     // press, run N frames, release
window.__yage__.inspector.snapshotJSON();                   // stable JSON snapshot
window.__yage__.inspector.setSeed(42);                      // pin every scene RNG (for replays)
window.__yage__.inspector.events.getLog();                  // recorded bus, entity and scene events
await window.__yage__.inspector.events.waitFor("scene:pushed", { withinFrames: 30 });
```

Snapshot and query calls work with `debug: true` alone. Frame stepping (`inspector.time.*`) needs `DebugPlugin`; synthetic input (`inspector.input.*`) needs `InputPlugin`. Without those plugins, the gated calls throw.

`time.step(N)` is synchronous and never gives async work (a scene transition, a dialogue runner) a chance to resolve. When a step needs to cross one, use the async variants instead — they yield a real macrotask between frames so pending microtasks can drain:

```ts
// Advance until a condition holds (throws after `maxFrames`, default 600):
await window.__yage__.inspector.time.stepUntil(() =>
  window.__yage__.inspector.getSceneStack().some((s) => s.name === "level2"),
);

// Advance a known frame count, still draining async work between frames:
await window.__yage__.inspector.time.stepAsync(45);
```

See `packages/debug.md` for `stepUntil`/`stepAsync` options, `snapshotScene(nameOrId)`, `events.setEnabled`/`isEnabled`, and `time.isAdvancing()`.

Diagnostics that need optional plugins live under inspector extension
namespaces. For example, `DebugPlugin` registers `debug` while installed.
Pass the extension's interface as the type parameter so calls type-check:

```ts
import type { DebugDiagnostics } from "@yagejs/debug";

const debug = window.__yage__.inspector.getExtension<DebugDiagnostics>("debug");
debug?.getCameraStack();
debug?.getLayerTransform("game", "world");
```

`getEntities()` returns an array of `EntitySnapshot` objects with `id`, `name`, `tags`, `components` (class-name strings), and `position`, so filtering by tag or component name is one line:

```ts
const enemies = window.__yage__.inspector
  .getEntities()
  .filter((e) => e.tags.includes("enemy"));
```

For agent-driven debugging: write a throwaway Playwright spec, boot the game, freeze the clock, drive scripted input, and snapshot. See `packages/debug.md` → *Agent-driven debugging: throwaway Inspector specs*.

### Unit tests (deterministic frame stepping)

`@yagejs/core` ships headless test utilities. `createTestEngine()` returns a started engine with no renderer/physics/input plugins; plugins must be registered before start, so a test that needs one builds the engine itself (`new Engine()` → `engine.use(...)` → `await engine.start()`). `advanceFrames()` ticks the game loop N times so assertions run against deterministic state:

```ts
import { createTestEngine, advanceFrames, Transform, Vec2 } from "@yagejs/core";

const engine = await createTestEngine();
const scene = new GameScene();
await engine.scenes.push(scene); // async: preload, then onEnter
const player = scene.spawn(Player, { x: 0, y: 0 });

advanceFrames(engine, 10);
expect(player.get(Transform).position.x).toBeGreaterThan(0);
```

For component-in-isolation tests, use `createMockScene()` / `createMockEntity()`. See `patterns.md` → Testing Patterns for the full cookbook (component unit tests, system tests, process tests, integration tests).

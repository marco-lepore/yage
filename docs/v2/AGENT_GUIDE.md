# YAGE v2 -- AI Agent Development Guide

## Overview

This guide is for AI coding agents working on the YAGE v2 codebase. It covers quick-start commands, package structure, key files, testing workflow, common modification patterns, and pitfalls to avoid.

---

## 1. Quick-Start Commands

```bash
# Install dependencies (from repo root)
npm install

# Build all packages (required before running examples or e2e tests)
npx turbo build

# Run all unit tests
npx turbo test

# Run unit tests for a specific package
npx turbo test --filter=@yage/core

# Run unit tests with coverage
npx turbo test -- --coverage

# Run a specific test file
npx vitest run packages/core/src/Vec2.test.ts

# Lint all packages
npx turbo lint

# Type-check all packages
npx turbo typecheck

# Start dev server (serves examples)
npm run dev

# Run Playwright E2E tests (requires build first)
npx playwright test

# Run a specific E2E test
npx playwright test e2e/bouncing-ball.spec.ts

# Run Playwright with headed browser (for debugging)
npx playwright test --headed
```

---

## 2. Package Dependency Graph

When modifying packages, changes flow downstream. Build and test in dependency order.

```
@yage/core (zero deps)
  ↓
  ├── @yage/renderer (→ core, pixi.js)
  │     ↓
  │     ├── @yage/particles (→ core, renderer)
  │     ├── @yage/tilemap (→ core, renderer; optional: physics)
  │     ├── @yage/ui (→ core, renderer)
  │     │     ↓
  │     │     └── @yage/ui-react (→ core, renderer, ui, react, react-dom)
  │     └── @yage/debug (→ core, renderer; optional: physics)
  │
  ├── @yage/physics (→ core, @dimforge/rapier2d)
  │
  ├── @yage/input (→ core)
  │
  └── @yage/audio (→ core, @pixi/sound)

yage (meta-package, re-exports all + createGame factory)
```

### Modification Order

If you change `@yage/core`:

1. Build core: `npx turbo build --filter=@yage/core`
2. Run core tests: `npx turbo test --filter=@yage/core`
3. Build and test downstream packages that might be affected
4. Run E2E tests if the change affects runtime behavior

If you change a leaf package (e.g., `@yage/particles`):

1. Build and test just that package
2. Run relevant E2E tests

---

## 3. Key Files Per Package

### `@yage/core`

| File                     | Purpose                                       |
| ------------------------ | --------------------------------------------- |
| `src/index.ts`           | Barrel export -- all public API               |
| `src/Engine.ts`          | Entry point, plugin orchestration             |
| `src/EngineContext.ts`   | DI container (ServiceKey, register, resolve)  |
| `src/Entity.ts`          | Entity class (component CRUD)                 |
| `src/Component.ts`       | Base component class                          |
| `src/System.ts`          | Base system class, Phase enum                 |
| `src/SystemScheduler.ts` | Ordered system execution                      |
| `src/GameLoop.ts`        | Fixed timestep loop                           |
| `src/QueryCache.ts`      | Incremental entity query cache                |
| `src/EventBus.ts`        | Typed pub/sub                                 |
| `src/SceneManager.ts`    | Scene stack (push/pop/replace)                |
| `src/Scene.ts`           | Scene base class (entity factory)             |
| `src/Process.ts`         | Coroutine / tween / sequence                  |
| `src/Blueprint.ts`       | Reusable entity templates (`defineBlueprint`) |
| `src/ErrorBoundary.ts`   | System/component error wrapping               |
| `src/Inspector.ts`       | Programmatic state queries                    |
| `src/Logger.ts`          | Structured logging                            |
| `src/Vec2.ts`            | Immutable 2D vector                           |
| `src/Transform.ts`       | Position/rotation/scale component             |
| `src/MathUtils.ts`       | Math utilities                                |
| `src/types.ts`           | Shared type definitions                       |
| `src/test-utils.ts`      | Mock factories for testing                    |
| `package.json`           | Zero runtime dependencies                     |
| `tsconfig.json`          | Extends root tsconfig.base.json               |
| `tsup.config.ts`         | Build config (ESM + CJS + .d.ts)              |
| `vitest.config.ts`       | Test config (100% coverage threshold)         |

### `@yage/renderer`

| File                             | Purpose                            |
| -------------------------------- | ---------------------------------- |
| `src/RendererPlugin.ts`          | Plugin entry, PixiJS v8 setup      |
| `src/SpriteComponent.ts`         | Sprite wrapper                     |
| `src/GraphicsComponent.ts`       | Graphics wrapper with `draw()`     |
| `src/AnimatedSpriteComponent.ts` | Animated sprite                    |
| `src/Camera.ts`                  | Follow, zoom, shake, bounds        |
| `src/DisplaySystem.ts`           | Render-phase Transform→PixiJS sync |
| `src/RenderLayer.ts`             | Named draw-order layers            |

### `@yage/physics`

| File                                | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| `src/PhysicsPlugin.ts`              | Plugin entry, Rapier2D setup          |
| `src/PhysicsWorld.ts`               | Rapier wrapper, coordinate conversion |
| `src/RigidBodyComponent.ts`         | Body types, forces, velocities        |
| `src/ColliderComponent.ts`          | Shapes, collision/trigger events      |
| `src/PhysicsSystem.ts`              | FixedUpdate: step + sync + events     |
| `src/PhysicsInterpolationSystem.ts` | LateUpdate: smooth rendering          |
| `src/CollisionLayers.ts`            | Named layer bitmask management        |

### `@yage/input`

| File                  | Purpose                                |
| --------------------- | -------------------------------------- |
| `src/InputPlugin.ts`  | Plugin entry                           |
| `src/InputManager.ts` | State queries (pressed, axis, pointer) |
| `src/InputSystem.ts`  | EarlyUpdate: poll + update state       |
| `src/ActionMap.ts`    | Action map resolution                  |

### `@yage/audio`

| File                    | Purpose                        |
| ----------------------- | ------------------------------ |
| `src/AudioPlugin.ts`    | Plugin entry                   |
| `src/AudioManager.ts`   | Channel-based playback control |
| `src/SoundComponent.ts` | Entity-bound audio             |

### `@yage/particles`

| File                              | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `src/ParticlesPlugin.ts`          | Plugin entry                                |
| `src/ParticleEmitterComponent.ts` | Emitter component with config               |
| `src/ParticleSystem.ts`           | Update phase: tick emitters                 |
| `src/ParticlePool.ts`             | Allocation-free particle recycling          |
| `src/ParticlePresets.ts`          | Built-in presets: fire, smoke, sparks, rain |

### `@yage/tilemap`

| File                         | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `src/TilemapPlugin.ts`       | Plugin entry                                                                           |
| `src/TilemapComponent.ts`    | Map rendering component                                                                |
| `src/TilemapRenderSystem.ts` | Render phase: draw tile layers                                                         |
| `src/loaders/`               | Asset loaders for Tiled JSON                                                           |
| `src/colliders.ts`           | `extractCollisionShapes()`                                                             |
| `src/tiled/parseTiledMap.ts` | `extractObjects()`                                                                     |
| `src/properties.ts`          | `getProperty()`, `getPropertyArray()`, `resolveObjectRef()`, `resolveObjectRefArray()` |

### `@yage/ui`

| File                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `src/UIPlugin.ts`           | Plugin entry, registers `UIContainerKey`              |
| `src/UIPanel.ts`            | Layout container with Yoga flexbox                    |
| `src/UIText.ts`             | Text rendering                                        |
| `src/UIButton.ts`           | Interactive button                                    |
| `src/UIImage.ts`            | Texture display                                       |
| `src/UINineSlice.ts`        | 9-slice scaled sprite                                 |
| `src/UIProgressBar.ts`      | Progress indicator                                    |
| `src/UICheckbox.ts`         | Toggle checkbox                                       |
| `src/BackgroundRenderer.ts` | Color/texture backgrounds for panels                  |
| `src/pixi-ui/`              | @pixi/ui wrappers (PixiFancyButton, PixiSlider, etc.) |

### `@yage/ui-react`

| File                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `src/UIRoot.ts`     | Component that hosts React tree in UI layer                                   |
| `src/hooks.ts`      | `useEngine()`, `useScene()`, `useQuery()`, `useStore()`, `useSceneSelector()` |
| `src/store.ts`      | `createStore()`, `Store<T>` reactive state                                    |
| `src/reconciler.ts` | Custom React reconciler over Yoga + PixiJS                                    |
| `src/components/`   | JSX wrappers: Panel, Text, Button, Image, etc.                                |

### `@yage/debug`

| File                       | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `src/DebugPlugin.ts`       | Plugin entry, registers `DebugRegistryKey`            |
| `src/DebugRegistryImpl.ts` | Contributor registry, flag management                 |
| `src/WorldDebugApiImpl.ts` | World-space debug drawing                             |
| `src/HudDebugApiImpl.ts`   | Screen-space debug text                               |
| `src/StatsStore.ts`        | Rolling-window statistics (Float64Array ring buffers) |
| `src/GraphicsPool.ts`      | Allocation-free PixiJS Graphics pool                  |
| `src/TextPool.ts`          | Allocation-free PixiJS Text pool                      |

### `yage` (meta-package)

| File                | Purpose                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`      | Re-exports all packages                                                                                               |
| `src/createGame.ts` | `createGame()` factory, `defineInlineScene()`, `CreateGameOptions`, `GameHandle`, `SceneServices`, `InlineSceneSetup` |

### Project Root

| File                       | Purpose                           |
| -------------------------- | --------------------------------- |
| `package.json`             | Workspace root, scripts           |
| `turbo.json`               | Turborepo task pipeline           |
| `tsconfig.base.json`       | Shared TypeScript config          |
| `vitest.workspace.ts`      | Vitest workspace for all packages |
| `playwright.config.ts`     | E2E test config                   |
| `.github/workflows/ci.yml` | CI pipeline                       |

---

## 4. Testing Workflow

### Order of Operations

1. **Unit tests first** -- fast feedback, no browser needed
2. **Type-check** -- catch type errors before runtime
3. **Build** -- ensure packages compile
4. **E2E tests** -- verify real browser behavior

```bash
# Full validation sequence
npx turbo test && npx turbo typecheck && npx turbo build && npx playwright test
```

### When to Run What

| Change                                     | Run                                                            |
| ------------------------------------------ | -------------------------------------------------------------- |
| Modified core logic (Entity, System, etc.) | `npx turbo test --filter=@yage/core`                           |
| Modified a plugin                          | `npx turbo test --filter=@yage/<plugin>`                       |
| Modified an example                        | `npx turbo build && npx playwright test e2e/<example>.spec.ts` |
| Before committing                          | `npx turbo lint && npx turbo test`                             |
| Before PR                                  | Full sequence above                                            |

### Writing Tests

- **Unit tests**: Co-locate with source files (`Foo.ts` → `Foo.test.ts`)
- **E2E tests**: Place in `e2e/` directory at repo root
- **Use test utilities**: Import `createMockScene`, `createMockEntity`, `advanceFrames` from `@yage/core/test-utils`
- **E2E assertions**: Use Inspector API (`window.__yage__.inspector`) for state assertions, not screenshots

---

## 5. Using the Inspector API

The Inspector is your primary debugging tool. Available when the engine is created with `debug: true`.

### In Browser Console

```javascript
// Full state snapshot
window.__yage__.inspector.snapshot();

// Find entity
window.__yage__.inspector.getEntityByName("player");

// Check position
window.__yage__.inspector.getEntityPosition("ball");
// → { x: 200, y: 350 }

// Check components
window.__yage__.inspector.hasComponent("player", "RigidBodyComponent");
// → true

// Scene stack
window.__yage__.inspector.getSceneStack();
// → [{ name: 'game', entityCount: 12, paused: false }]

// Error state
window.__yage__.inspector.getErrors();
// → { disabledSystems: [], disabledComponents: [] }
```

### In Playwright Tests

```typescript
const pos = await page.evaluate(() =>
  window.__yage__.inspector.getEntityPosition("ball"),
);
expect(pos!.y).toBeGreaterThan(100);
```

---

## 6. Reading Structured Logs

### In Browser Console

```javascript
// Recent logs as formatted text
window.__yage__.logger.formatRecentLogs(20);

// Recent logs as structured objects
window.__yage__.logger.getRecent(20);
```

### Log Format

```
[LEVEL][category] fNNN message {data}
```

- `LEVEL`: DEBUG, INFO, WARN, ERROR
- `category`: physics, input, core, render, ai, etc.
- `fNNN`: frame number
- `{data}`: optional key:value pairs

### Filtering in Agent Workflow

When debugging, filter logs by category or level:

```javascript
const logs = window.__yage__.logger.getRecent(100);
const errors = logs.filter((e) => e.level >= 3); // LogLevel.Error = 3
const physics = logs.filter((e) => e.category === "physics");
```

---

## 7. Common Modification Patterns

### Add a New Component

1. Create `packages/<plugin>/src/MyComponent.ts`:

```typescript
import { Component } from "@yage/core";

export class MyComponent extends Component {
  myData: number;

  constructor(data: number) {
    super();
    this.myData = data;
  }

  onAdd() {
    // Called when added to an entity
  }

  onRemove() {
    // Called when removed from an entity
  }
}
```

2. Export from `packages/<plugin>/src/index.ts`
3. Write unit test `packages/<plugin>/src/MyComponent.test.ts`

### Add a New System

1. Create `packages/<plugin>/src/MySystem.ts`:

```typescript
import { System, Phase, EngineContext, QueryResult } from "@yage/core";
import { QueryCacheKey } from "@yage/core";
import { MyComponent } from "./MyComponent";
import { Transform } from "@yage/core";

export class MySystem extends System {
  readonly phase = Phase.Update;
  readonly priority = 0;

  private query!: QueryResult;

  onRegister(context: EngineContext) {
    const cache = context.resolve(QueryCacheKey);
    this.query = cache.register([Transform, MyComponent]);
  }

  update(dt: number) {
    for (const entity of this.query) {
      const transform = entity.get(Transform);
      const myComp = entity.get(MyComponent);
      // Update logic here
    }
  }
}
```

2. Register in the plugin's `registerSystems()` method
3. Write unit test (mock the context and entities)

### Add a New Plugin

Follow the step-by-step guide in [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md#8-creating-a-custom-plugin-step-by-step).

Summary:

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `tsup.config.ts`
2. Define `ServiceKey` and types
3. Implement the service class
4. Implement the `Plugin` class
5. Export from `index.ts`
6. Add to `turbo.json` if needed
7. Write tests

### Add a New Example

1. Create `examples/<name>/` directory
2. Create `main.ts` entry point:

```typescript
import { Engine, Scene, Transform, Vec2 } from "@yage/core";
import { RendererPlugin } from "@yage/renderer";
// ... other imports

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 800, height: 600 }));
// ... other plugins

class MyScene extends Scene {
  readonly name = "my-scene";
  onEnter() {
    // Spawn entities
  }
}

await engine.start();
engine.scenes.push(new MyScene());
```

3. Create `index.html` that loads `main.ts`
4. Add to the example index page
5. Write an E2E test in `e2e/<name>.spec.ts`

### Add a New AssetHandle Factory

1. In your plugin package, create a factory function:

```typescript
import { AssetHandle } from "@yage/core";

export function myAsset(path: string): AssetHandle<MyAssetType> {
  return new AssetHandle<MyAssetType>("myType", path);
}
```

2. Register the loader in your plugin's `install()`:

```typescript
install(context: EngineContext) {
  const assets = context.resolve(AssetManagerKey);
  assets.registerLoader('myType', {
    load: async (path) => { /* load and return asset */ },
    unload: (path, asset) => { /* cleanup */ },
  });
}
```

3. Export the factory from `index.ts`

### Define a Blueprint

```typescript
import { defineBlueprint, Transform } from "@yage/core";
import { SpriteComponent } from "@yage/renderer";

export const MyBlueprint = defineBlueprint<{ x: number; y: number }>(
  "my-entity",
  (entity, { x, y }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(new SpriteComponent({ texture: "my-sprite.png" }));
    // Post-construction logic here
  },
);

// Usage: MyBlueprint.build(scene.spawn('instance'), { x: 100, y: 200 });
```

### Scene Class (Recommended for Real Games)

Use a Scene subclass when you need full lifecycle hooks, asset preloading, or reusable/testable scenes. Services are accessed via `this.service(Key)` which returns a lazy proxy safe to assign as a field.

```typescript
import { Scene, Transform, Vec2 } from "@yage/core";
import { CameraKey } from "@yage/renderer";
import { InputManagerKey } from "@yage/input";
import { PhysicsWorldKey } from "@yage/physics";

class GameScene extends Scene {
  readonly name = "game";

  // Lazy proxies — safe to declare as fields, resolved on first use
  private camera = this.service(CameraKey);
  private input = this.service(InputManagerKey);
  private physics = this.service(PhysicsWorldKey);

  onEnter() {
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(100, 200) }));
    this.camera.follow(player);
  }

  onExit() {
    // Cleanup logic
  }
}

// Push onto engine
engine.scenes.push(new GameScene());
```

### Use createGame() + defineInlineScene() for Quick Setup

`defineInlineScene` is a lightweight alternative — great for prototypes, examples, and simple scenes. Common services are pre-resolved and passed as the second argument.

```typescript
import { createGame, defineInlineScene } from "yage";

const game = await createGame({
  width: 800,
  height: 600,
  physics: true,
  input: { actions: { jump: ["Space"] } },
  debug: true,
  scene: defineInlineScene("game", (scene, { camera, input, physics }) => {
    camera.follow(scene.spawn("player"));
    // For custom/uncommon services, fall back to scene.context.resolve(key)
  }),
});
```

### Modify Entity/Component Lifecycle

The lifecycle is controlled by:

- `Entity.ts` -- add/remove/destroy component calls
- `Scene.ts` -- spawn/destroy entity calls
- `SystemScheduler.ts` -- phase execution
- `GameLoop.ts` -- frame timing

If you modify lifecycle ordering, update tests in all of these files and run E2E tests to verify.

---

## 8. Conventions and Pitfalls

### Conventions

| Convention                       | Details                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Immutable Vec2**               | `Vec2` is immutable. All operations return new instances. Never mutate `v.x`/`v.y` directly.                                                                                                        |
| **Transform is mutable**         | `Transform` is the one mutable component. Use `setPosition()`, `translate()`, etc.                                                                                                                  |
| **Components own game logic**    | Components can have `update(dt)` and `fixedUpdate(dt)` methods — the built-in `ComponentUpdateSystem` calls them. Systems are for engine internals and cross-cutting concerns (physics, rendering). |
| **Phase assignment**             | Physics in `FixedUpdate`. Input polling in `EarlyUpdate`. Rendering in `Render`. Cleanup in `EndOfFrame`.                                                                                           |
| **ServiceKey for DI**            | Always use `ServiceKey<T>` for type-safe service resolution. Never use string keys directly.                                                                                                        |
| **Plain objects for config**     | Plugin configs, action maps, collider shapes -- all plain objects. No `Map`, no classes for config.                                                                                                 |
| **Pixels everywhere**            | All user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`.                                                                                                   |
| **co-located unit tests**        | `Foo.ts` test goes in `Foo.test.ts` in the same directory.                                                                                                                                          |
| **E2E tests in `e2e/`**          | Integration tests at repo root, not inside packages.                                                                                                                                                |
| **AssetHandle factories**        | Each plugin exports a factory (e.g., `texture()`, `sound()`, `tiledMap()`) that returns `AssetHandle<T>`. Define handles at module scope, load in scene lifecycle.                                  |
| **Blueprint over Prefab**        | Use `defineBlueprint()` for parametric entity factories. Use `Prefab` only for truly static templates.                                                                                              |
| **Entity events for game logic** | Use `defineEvent()` / `entity.on()` / `entity.emit()` for entity-scoped events. Use `EventBus` for global engine events.                                                                            |

### Pitfalls to Avoid

| Pitfall                                                       | Why                                                                                                                                                                                               | Instead                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Putting engine-level cross-cutting concerns in Components** | Physics stepping, render sync, and collision dispatch need efficient cross-entity queries and strict phase ordering. Putting these in Components means duplicate work and no centralized control. | Use Systems for engine-level concerns (physics, rendering, audio). Components are for game logic.                 |
| **Importing PixiJS types into `@yage/core`**                  | Creates a dependency from core to pixi.js, breaking the zero-dependency guarantee.                                                                                                                | Keep PixiJS types inside `@yage/renderer`. Use abstract interfaces in core if needed.                             |
| **Using `context.resolve()` in a constructor**                | Context may not be fully populated during plugin installation.                                                                                                                                    | Use `onRegister()` for systems or `onEnter()` for scenes to resolve services.                                     |
| **Mutating Vec2**                                             | Vec2 is immutable by design. Mutations would break assumptions in caching and comparison.                                                                                                         | Use `vec.add()`, `vec.scale()`, etc. which return new instances.                                                  |
| **Running async code in system `update()`**                   | The game loop is synchronous. Async operations skip frames and cause non-determinism.                                                                                                             | Start async work outside the loop, use events to communicate completion, or use Process for frame-aligned delays. |
| **Forgetting to export from `index.ts`**                      | Unexported types won't be available to consumers.                                                                                                                                                 | Always add new public types to the package's barrel export.                                                       |
| **Registering duplicate ServiceKeys**                         | `EngineContext.register()` throws on duplicates.                                                                                                                                                  | Check with `context.has()` first, or ensure only one plugin registers each key.                                   |
| **Putting unit tests in `e2e/`**                              | Unit tests should be fast and not require a browser.                                                                                                                                              | Co-locate with source. Only put browser-dependent tests in `e2e/`.                                                |
| **Using `setTimeout` or `setInterval` in game logic**         | Breaks deterministic frame execution. Timers drift and don't respect pause.                                                                                                                       | Use `Process`, `Tween`, or `Sequence` for time-based logic.                                                       |
| **Assuming render order = spawn order**                       | Render order is controlled by `RenderLayer` and draw priority, not entity creation order.                                                                                                         | Use layers for explicit draw ordering.                                                                            |

### Type Safety Checklist

Before submitting code:

- [ ] No `any` in public API signatures
- [ ] All exported functions and classes have TSDoc comments
- [ ] `ComponentClass<C>` generic is used correctly (not raw `new (...args) => Component`)
- [ ] `ServiceKey<T>` matches the service type it resolves to
- [ ] Enums use string values (not numeric) for debuggability

---

## 9. Architecture Decision Quick Reference

For the rationale behind key decisions, see [TDD.md](./TDD.md). Quick summary:

| Decision                                                | Rationale                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| No global state (`EngineContext` instead of `Executor`) | Prevents stale refs in async, supports multiple engines in tests                                                                               |
| Components own game logic; Systems power engine plugins | ComponentUpdateSystem calls component update/fixedUpdate (enabled check built in); Systems use QueryCache for efficient cross-entity iteration |
| Cached queries (`QueryCache`)                           | O(1) registration, O(matched) iteration, only updates on archetype changes                                                                     |
| Deterministic frame phases                              | Predictable execution order; no setTimeout, no async in game loop                                                                              |
| Physics is optional                                     | Core has zero knowledge of physics; no WASM download for non-physics games                                                                     |
| Internal coordinate conversion                          | `PhysicsWorld` handles pixels ↔ meters; users never see Rapier units                                                                           |
| Error resilience (`ErrorBoundary`)                      | One bad component/system never crashes the loop; errors are logged and inspectable                                                             |
| Inspector + Logger as core features                     | Testing and debugging are first-class; `window.__yage__` enables Playwright assertions                                                         |

---

## References

- [TDD.md](./TDD.md) -- Complete architecture and API specifications
- [PRD.md](./PRD.md) -- Product requirements and success criteria
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) -- Build phases and dependencies
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing patterns and CI pipeline
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system specification
- [RECIPES_PLAN.md](./RECIPES_PLAN.md) -- Recipe roadmap for reusable gameplay modules

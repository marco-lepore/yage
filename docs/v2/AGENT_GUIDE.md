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
  │     └── @yage/debug (→ core, renderer; optional: physics)
  │
  ├── @yage/physics (→ core, @dimforge/rapier2d)
  │
  ├── @yage/input (→ core)
  │
  └── @yage/audio (→ core, @pixi/sound)

yage (meta-package, re-exports all)
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

| File | Purpose |
|---|---|
| `src/index.ts` | Barrel export -- all public API |
| `src/Engine.ts` | Entry point, plugin orchestration |
| `src/EngineContext.ts` | DI container (ServiceKey, register, resolve) |
| `src/Entity.ts` | Entity class (component CRUD) |
| `src/Component.ts` | Base component class |
| `src/System.ts` | Base system class, Phase enum |
| `src/SystemScheduler.ts` | Ordered system execution |
| `src/GameLoop.ts` | Fixed timestep loop |
| `src/QueryCache.ts` | Incremental entity query cache |
| `src/EventBus.ts` | Typed pub/sub |
| `src/SceneManager.ts` | Scene stack (push/pop/replace) |
| `src/Scene.ts` | Scene base class (entity factory) |
| `src/Process.ts` | Coroutine / tween / sequence |
| `src/Prefab.ts` | Declarative entity templates |
| `src/ErrorBoundary.ts` | System/component error wrapping |
| `src/Inspector.ts` | Programmatic state queries |
| `src/Logger.ts` | Structured logging |
| `src/Vec2.ts` | Immutable 2D vector |
| `src/Transform.ts` | Position/rotation/scale component |
| `src/MathUtils.ts` | Math utilities |
| `src/types.ts` | Shared type definitions |
| `src/test-utils.ts` | Mock factories for testing |
| `package.json` | Zero runtime dependencies |
| `tsconfig.json` | Extends root tsconfig.base.json |
| `tsup.config.ts` | Build config (ESM + CJS + .d.ts) |
| `vitest.config.ts` | Test config (100% coverage threshold) |

### `@yage/renderer`

| File | Purpose |
|---|---|
| `src/RendererPlugin.ts` | Plugin entry, PixiJS v8 setup |
| `src/SpriteComponent.ts` | Sprite wrapper |
| `src/GraphicsComponent.ts` | Graphics wrapper with `draw()` |
| `src/AnimatedSpriteComponent.ts` | Animated sprite |
| `src/Camera.ts` | Follow, zoom, shake, bounds |
| `src/DisplaySystem.ts` | Render-phase Transform→PixiJS sync |
| `src/RenderLayer.ts` | Named draw-order layers |

### `@yage/physics`

| File | Purpose |
|---|---|
| `src/PhysicsPlugin.ts` | Plugin entry, Rapier2D setup |
| `src/PhysicsWorld.ts` | Rapier wrapper, coordinate conversion |
| `src/RigidBodyComponent.ts` | Body types, forces, velocities |
| `src/ColliderComponent.ts` | Shapes, collision/trigger events |
| `src/PhysicsSystem.ts` | FixedUpdate: step + sync + events |
| `src/PhysicsInterpolationSystem.ts` | LateUpdate: smooth rendering |
| `src/CollisionLayers.ts` | Named layer bitmask management |

### `@yage/input`

| File | Purpose |
|---|---|
| `src/InputPlugin.ts` | Plugin entry |
| `src/InputManager.ts` | State queries (pressed, axis, pointer) |
| `src/InputSystem.ts` | EarlyUpdate: poll + update state |
| `src/ActionMap.ts` | Action map resolution |

### `@yage/audio`

| File | Purpose |
|---|---|
| `src/AudioPlugin.ts` | Plugin entry |
| `src/AudioManager.ts` | Channel-based playback control |
| `src/SoundComponent.ts` | Entity-bound audio |

### Project Root

| File | Purpose |
|---|---|
| `package.json` | Workspace root, scripts |
| `turbo.json` | Turborepo task pipeline |
| `tsconfig.base.json` | Shared TypeScript config |
| `vitest.workspace.ts` | Vitest workspace for all packages |
| `playwright.config.ts` | E2E test config |
| `.github/workflows/ci.yml` | CI pipeline |

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

| Change | Run |
|---|---|
| Modified core logic (Entity, System, etc.) | `npx turbo test --filter=@yage/core` |
| Modified a plugin | `npx turbo test --filter=@yage/<plugin>` |
| Modified an example | `npx turbo build && npx playwright test e2e/<example>.spec.ts` |
| Before committing | `npx turbo lint && npx turbo test` |
| Before PR | Full sequence above |

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
window.__yage__.inspector.snapshot()

// Find entity
window.__yage__.inspector.getEntityByName('player')

// Check position
window.__yage__.inspector.getEntityPosition('ball')
// → { x: 200, y: 350 }

// Check components
window.__yage__.inspector.hasComponent('player', 'RigidBodyComponent')
// → true

// Scene stack
window.__yage__.inspector.getSceneStack()
// → [{ name: 'game', entityCount: 12, paused: false }]

// Error state
window.__yage__.inspector.getErrors()
// → { disabledSystems: [], disabledComponents: [] }
```

### In Playwright Tests

```typescript
const pos = await page.evaluate(() =>
  window.__yage__.inspector.getEntityPosition('ball')
);
expect(pos!.y).toBeGreaterThan(100);
```

---

## 6. Reading Structured Logs

### In Browser Console

```javascript
// Recent logs as formatted text
window.__yage__.logger.formatRecentLogs(20)

// Recent logs as structured objects
window.__yage__.logger.getRecent(20)
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
const errors = logs.filter(e => e.level >= 3); // LogLevel.Error = 3
const physics = logs.filter(e => e.category === 'physics');
```

---

## 7. Common Modification Patterns

### Add a New Component

1. Create `packages/<plugin>/src/MyComponent.ts`:

```typescript
import { Component } from '@yage/core';

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
import { System, Phase, EngineContext, QueryResult } from '@yage/core';
import { QueryCacheKey } from '@yage/core';
import { MyComponent } from './MyComponent';
import { Transform } from '@yage/core';

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
import { Engine, Scene, Transform, Vec2 } from '@yage/core';
import { RendererPlugin } from '@yage/renderer';
// ... other imports

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 800, height: 600 }));
// ... other plugins

class MyScene extends Scene {
  readonly name = 'my-scene';
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

| Convention | Details |
|---|---|
| **Immutable Vec2** | `Vec2` is immutable. All operations return new instances. Never mutate `v.x`/`v.y` directly. |
| **Transform is mutable** | `Transform` is the one mutable component. Use `setPosition()`, `translate()`, etc. |
| **Systems drive updates** | Components store data. Systems contain logic. Don't put update loops in components. |
| **Phase assignment** | Physics in `FixedUpdate`. Input polling in `EarlyUpdate`. Rendering in `Render`. Cleanup in `EndOfFrame`. |
| **ServiceKey for DI** | Always use `ServiceKey<T>` for type-safe service resolution. Never use string keys directly. |
| **Plain objects for config** | Plugin configs, action maps, collider shapes -- all plain objects. No `Map`, no classes for config. |
| **Pixels everywhere** | All user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`. |
| **co-located unit tests** | `Foo.ts` test goes in `Foo.test.ts` in the same directory. |
| **E2E tests in `e2e/`** | Integration tests at repo root, not inside packages. |

### Pitfalls to Avoid

| Pitfall | Why | Instead |
|---|---|---|
| **Adding lifecycle methods to Component base** | Breaks the system-driven architecture. Components become self-updating, disabled state becomes hard to enforce. | Put update logic in a System that queries for the component. |
| **Importing PixiJS types into `@yage/core`** | Creates a dependency from core to pixi.js, breaking the zero-dependency guarantee. | Keep PixiJS types inside `@yage/renderer`. Use abstract interfaces in core if needed. |
| **Using `context.resolve()` in a constructor** | Context may not be fully populated during plugin installation. | Use `onRegister()` for systems or `onEnter()` for scenes to resolve services. |
| **Mutating Vec2** | Vec2 is immutable by design. Mutations would break assumptions in caching and comparison. | Use `vec.add()`, `vec.scale()`, etc. which return new instances. |
| **Running async code in system `update()`** | The game loop is synchronous. Async operations skip frames and cause non-determinism. | Start async work outside the loop, use events to communicate completion, or use Process for frame-aligned delays. |
| **Forgetting to export from `index.ts`** | Unexported types won't be available to consumers. | Always add new public types to the package's barrel export. |
| **Registering duplicate ServiceKeys** | `EngineContext.register()` throws on duplicates. | Check with `context.has()` first, or ensure only one plugin registers each key. |
| **Putting unit tests in `e2e/`** | Unit tests should be fast and not require a browser. | Co-locate with source. Only put browser-dependent tests in `e2e/`. |
| **Using `setTimeout` or `setInterval` in game logic** | Breaks deterministic frame execution. Timers drift and don't respect pause. | Use `Process`, `Tween`, or `Sequence` for time-based logic. |
| **Assuming render order = spawn order** | Render order is controlled by `RenderLayer` and draw priority, not entity creation order. | Use layers for explicit draw ordering. |

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

| Decision | Rationale |
|---|---|
| No global state (`EngineContext` instead of `Executor`) | Prevents stale refs in async, supports multiple engines in tests |
| Systems drive updates, not components | Disabled components are never called; query cache enables O(matched) iteration |
| Cached queries (`QueryCache`) | O(1) registration, O(matched) iteration, only updates on archetype changes |
| Deterministic frame phases | Predictable execution order; no setTimeout, no async in game loop |
| Physics is optional | Core has zero knowledge of physics; no WASM download for non-physics games |
| Internal coordinate conversion | `PhysicsWorld` handles pixels ↔ meters; users never see Rapier units |
| Error resilience (`ErrorBoundary`) | One bad component/system never crashes the loop; errors are logged and inspectable |
| Inspector + Logger as core features | Testing and debugging are first-class; `window.__yage__` enables Playwright assertions |

---

## References

- [TDD.md](./TDD.md) -- Complete architecture and API specifications
- [PRD.md](./PRD.md) -- Product requirements and success criteria
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) -- Build phases and dependencies
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing patterns and CI pipeline
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system specification

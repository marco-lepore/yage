# YAGE -- AI Agent Development Guide

## Overview

This guide is for AI coding agents working on the YAGE codebase. It covers quick-start commands, package structure, key files, testing workflow, common modification patterns, and pitfalls to avoid.

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
npx turbo test --filter=@yagejs/core

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
npx playwright test e2e/specs/physics-bounce.spec.ts

# Run Playwright with headed browser (for debugging)
npx playwright test --headed
```

---

## 2. Package Dependency Graph

When modifying packages, changes flow downstream. Build and test in dependency order.

```
@yagejs/core (zero deps)
  ↓
  ├── @yagejs/renderer (→ core, pixi.js)
  │     ↓
  │     ├── @yagejs/particles (→ core, renderer)
  │     ├── @yagejs/tilemap (→ core, renderer; optional: physics)
  │     ├── @yagejs/ui (→ core, renderer)
  │     │     ↓
  │     │     └── @yagejs/ui-react (→ core, renderer, ui, react, react-dom)
  │     └── @yagejs/debug (→ core, renderer; optional: physics)
  │
  ├── @yagejs/physics (→ core, @dimforge/rapier2d)
  │
  ├── @yagejs/input (→ core)
  │
  ├── @yagejs/audio (→ core, @pixi/sound)
  │
  └── @yagejs/save (→ core)
```

### Modification Order

If you change `@yagejs/core`:

1. Build core: `npx turbo build --filter=@yagejs/core`
2. Run core tests: `npx turbo test --filter=@yagejs/core`
3. Build and test downstream packages that might be affected
4. Run E2E tests if the change affects runtime behavior

If you change a leaf package (e.g., `@yagejs/particles`):

1. Build and test just that package
2. Run relevant E2E tests

---

## 3. Key Files Per Package

### `@yagejs/core`

| File                      | Purpose                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `src/index.ts`            | Barrel export -- all public API                                       |
| `src/Engine.ts`           | Entry point, plugin orchestration                                     |
| `src/EngineContext.ts`    | DI container (ServiceKey, register, resolve)                          |
| `src/Entity.ts`           | Entity class (component CRUD)                                         |
| `src/Component.ts`        | Base component class                                                  |
| `src/System.ts`           | Base system class, Phase enum                                         |
| `src/SystemScheduler.ts`  | Ordered system execution                                              |
| `src/GameLoop.ts`         | Fixed timestep loop                                                   |
| `src/QueryCache.ts`       | Incremental entity query cache                                        |
| `src/EventBus.ts`         | Typed pub/sub                                                         |
| `src/SceneManager.ts`     | Scene stack (push/pop/replace)                                        |
| `src/Scene.ts`            | Scene base class (entity factory)                                     |
| `src/Process.ts`          | Coroutine / tween / sequence                                          |
| `src/ProcessSlot.ts`      | Reusable restartable process handle (cooldowns, effects)              |
| `src/ProcessComponent.ts` | Entity component for slots + one-off processes                        |
| `src/TimerEntity.ts`      | Pre-built entity exposing ProcessComponent API                        |
| `src/Serializable.ts`     | `@serializable` decorator, `SerializableRegistry`, `SnapshotResolver` |
| `src/Trait.ts`            | Trait system (`defineTrait`, `@trait`)                                |
| `src/Blueprint.ts`        | Reusable entity templates (deprecated)                                |
| `src/ErrorBoundary.ts`    | System/component error wrapping                                       |
| `src/Inspector.ts`        | Programmatic state queries                                            |
| `src/Logger.ts`           | Structured logging                                                    |
| `src/Vec2.ts`             | Immutable 2D vector                                                   |
| `src/Transform.ts`        | Position/rotation/scale component                                     |
| `src/MathUtils.ts`        | Math utilities                                                        |
| `src/types.ts`            | Shared type definitions                                               |
| `src/test-utils.ts`       | Mock factories for testing                                            |
| `package.json`            | Zero runtime dependencies                                             |
| `tsconfig.json`           | Extends root tsconfig.base.json                                       |
| `tsup.config.ts`          | Build config (ESM + CJS + .d.ts)                                      |
| `vitest.config.ts`        | Test config (100% coverage threshold)                                 |

### `@yagejs/renderer`

| File                             | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `src/RendererPlugin.ts`          | Plugin entry, PixiJS v8 setup                |
| `src/SpriteComponent.ts`         | Sprite wrapper                               |
| `src/GraphicsComponent.ts`       | Graphics wrapper with `draw()`               |
| `src/AnimatedSpriteComponent.ts` | Animated sprite (FrameSource serializable)   |
| `src/AnimationController.ts`     | Named animations, one-shot locking           |
| `src/spritesheet.ts`             | `sliceSheet`, `FrameSource`, `resolveFrames` |
| `src/assets.ts`                  | `texture()`, `spritesheet()` factories       |
| `src/CameraEntity.ts`            | Entity for camera instances                  |
| `src/CameraComponent.ts`         | Core camera component                        |
| `src/CameraFollow.ts`            | Follow behavior component                    |
| `src/CameraShake.ts`             | Shake behavior component                     |
| `src/CameraZoom.ts`              | Zoom behavior component                      |
| `src/CameraBoundsComponent.ts`   | Bounds constraint component                  |
| `src/DisplaySystem.ts`           | Render-phase Transform→PixiJS sync           |
| `src/RenderLayer.ts`             | Named draw-order layers                      |

### `@yagejs/physics`

| File                                | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| `src/PhysicsPlugin.ts`              | Plugin entry, Rapier2D setup          |
| `src/PhysicsWorld.ts`               | Rapier wrapper, coordinate conversion |
| `src/RigidBodyComponent.ts`         | Body types, forces, velocities        |
| `src/ColliderComponent.ts`          | Shapes, collision/trigger events      |
| `src/PhysicsSystem.ts`              | FixedUpdate: step + sync + events     |
| `src/PhysicsInterpolationSystem.ts` | LateUpdate: smooth rendering          |
| `src/CollisionLayers.ts`            | Named layer bitmask management        |

### `@yagejs/input`

| File                  | Purpose                                |
| --------------------- | -------------------------------------- |
| `src/InputPlugin.ts`  | Plugin entry                           |
| `src/InputManager.ts` | State queries (pressed, axis, pointer) |
| `src/InputSystem.ts`  | EarlyUpdate: poll + update state       |
| `src/ActionMap.ts`    | Action map resolution                  |

### `@yagejs/audio`

| File                    | Purpose                        |
| ----------------------- | ------------------------------ |
| `src/AudioPlugin.ts`    | Plugin entry                   |
| `src/AudioManager.ts`   | Channel-based playback control |
| `src/SoundComponent.ts` | Entity-bound audio             |

### `@yagejs/particles`

| File                              | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `src/ParticlesPlugin.ts`          | Plugin entry                                |
| `src/ParticleEmitterComponent.ts` | Emitter component with config               |
| `src/ParticleSystem.ts`           | Update phase: tick emitters                 |
| `src/ParticlePool.ts`             | Allocation-free particle recycling          |
| `src/ParticlePresets.ts`          | Built-in presets: fire, smoke, sparks, rain |

### `@yagejs/tilemap`

| File                         | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `src/TilemapPlugin.ts`       | Plugin entry                                                                           |
| `src/TilemapComponent.ts`    | Map rendering component                                                                |
| `src/TilemapRenderSystem.ts` | Render phase: draw tile layers                                                         |
| `src/loaders/`               | Asset loaders for Tiled JSON                                                           |
| `src/colliders.ts`           | `extractCollisionShapes()`                                                             |
| `src/tiled/parseTiledMap.ts` | `extractObjects()`                                                                     |
| `src/properties.ts`          | `getProperty()`, `getPropertyArray()`, `resolveObjectRef()`, `resolveObjectRefArray()` |

### `@yagejs/ui`

| File                        | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `src/UIPlugin.ts`           | Plugin entry, loads Yoga + wires AssetManager         |
| `src/UIPanel.ts`            | Layout container with Yoga flexbox                    |
| `src/UIText.ts`             | Text rendering                                        |
| `src/UIButton.ts`           | Interactive button                                    |
| `src/UIImage.ts`            | Texture display                                       |
| `src/UINineSlice.ts`        | 9-slice scaled sprite                                 |
| `src/UIProgressBar.ts`      | Progress indicator                                    |
| `src/UICheckbox.ts`         | Toggle checkbox                                       |
| `src/BackgroundRenderer.ts` | Color/texture backgrounds for panels                  |
| `src/pixi-ui/`              | @pixi/ui wrappers (PixiFancyButton, PixiSlider, etc.) |

### `@yagejs/ui-react`

| File                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `src/UIRoot.ts`     | Component that hosts React tree in UI layer                                   |
| `src/hooks.ts`      | `useEngine()`, `useScene()`, `useQuery()`, `useStore()`, `useSceneSelector()` |
| `src/store.ts`      | `createStore()`, `Store<T>` reactive state                                    |
| `src/reconciler.ts` | Custom React reconciler over Yoga + PixiJS                                    |
| `src/components/`   | JSX wrappers: Panel, Text, Button, Image, etc.                                |

### `@yagejs/debug`

| File                       | Purpose                                               |
| -------------------------- | ----------------------------------------------------- |
| `src/DebugPlugin.ts`       | Plugin entry, registers `DebugRegistryKey`            |
| `src/DebugRegistryImpl.ts` | Contributor registry, flag management                 |
| `src/WorldDebugApiImpl.ts` | World-space debug drawing                             |
| `src/HudDebugApiImpl.ts`   | Screen-space debug text                               |
| `src/StatsStore.ts`        | Rolling-window statistics (Float64Array ring buffers) |
| `src/GraphicsPool.ts`      | Allocation-free PixiJS Graphics pool                  |
| `src/TextPool.ts`          | Allocation-free PixiJS Text pool                      |

### `@yagejs/save`

| File                         | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `src/SavePlugin.ts`          | Plugin entry, registers `SaveServiceKey`     |
| `src/SaveService.ts`         | Snapshot + user data save/load orchestration |
| `src/LocalStorageAdapter.ts` | `SaveStorage` impl for browser localStorage  |
| `src/types.ts`               | `SaveStorage`, snapshot types                |
| `src/keys.ts`                | `SaveServiceKey`                             |

### Project Root

| File                       | Purpose                  |
| -------------------------- | ------------------------ |
| `package.json`             | Workspace root, scripts  |
| `turbo.json`               | Turborepo task pipeline  |
| `tsconfig.base.json`       | Shared TypeScript config |
| `playwright.config.ts`     | E2E test config          |
| `.github/workflows/ci.yml` | CI pipeline              |

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

| Change                                     | Run                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Modified core logic (Entity, System, etc.) | `npx turbo test --filter=@yagejs/core`                               |
| Modified a plugin                          | `npx turbo test --filter=@yagejs/<plugin>`                           |
| Modified an example                        | `npx turbo build && npx playwright test e2e/specs/<example>.spec.ts` |
| Before committing                          | `npx turbo lint && npx turbo test`                                   |
| Before PR                                  | Full sequence above                                                  |

### Writing Tests

- **Unit tests**: Co-locate with source files (`Foo.ts` → `Foo.test.ts`)
- **E2E tests**: Place specs in `e2e/specs/` and fixture apps in `e2e/fixtures/`
- **Use test utilities**: Import `createMockScene`, `createMockEntity`, `advanceFrames` from `@yagejs/core/test-utils`
- **E2E assertions**: Use Inspector API (`window.__yage__.inspector`) for state assertions, not screenshots
- **Deterministic browser timing**: Prefer `window.__yage__.clock.step()` / `stepFrames()` over `waitForTimeout()` when a fixture enables manual clock mode

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
import { Component } from "@yagejs/core";

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
import { System, Phase, EngineContext, QueryResult } from "@yagejs/core";
import { QueryCacheKey } from "@yagejs/core";
import { MyComponent } from "./MyComponent";
import { Transform } from "@yagejs/core";

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

Follow the step-by-step guide in [ARCHITECTURE.md](./ARCHITECTURE.md#8-creating-a-custom-plugin-step-by-step).

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
import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
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
import { AssetHandle } from "@yagejs/core";

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

### Define an Entity Subclass (recommended)

Entities support two usage styles (mixable in the same project):

- **Data containers (ECS-style)**: Plain ID + component bags. Systems query and manipulate components directly. Good for bulk processing (physics bodies, particles, tiles).
- **Game object API layer**: Entity subclasses with methods that internally interact with components. Add `@trait()` for shared behaviors discoverable at runtime. Good for gameplay objects with rich interactions (NPCs, items, doors).

Use `setup()` instead of the constructor — it runs after the entity is wired to the scene, so `onAdd` hooks and service resolution work.

```typescript
import { Entity, Transform, Vec2 } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";

class MyEntity extends Entity {
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new SpriteComponent({ texture: "my-sprite.png" }));
  }
}

// Usage: scene.spawn(MyEntity, { x: 100, y: 200 });
```

### Define Traits (discoverable capabilities)

Traits declare capabilities that are enforced at compile time (via the `@trait()` decorator) and queryable at runtime via `hasTrait()`.

```typescript
import { Entity, defineTrait, trait } from "@yagejs/core";

const Interactable = defineTrait<{ interact(): void; priority: number }>(
  "Interactable",
);

@trait(Interactable)
class LightEntity extends Entity {
  priority = 4;

  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
  }

  interact() {
    // toggle light
  }
}

// Runtime trait check (type guard)
for (const entity of scene.getEntities()) {
  if (entity.hasTrait(Interactable)) {
    entity.interact(); // correctly typed
  }
}
```

### Make a Component Serializable

Components that participate in save/load need three things: `@serializable`, `serialize()`, and `static fromSnapshot()`. The save system auto-discovers registered classes and restores them during load.

**Full serialization** (all state is primitives/string keys):

```typescript
import { Component, serializable } from "@yagejs/core";

interface MyData {
  value: number;
  label: string;
}

@serializable
class MyComponent extends Component {
  private _value: number;
  private _label: string;

  constructor(opts: { value: number; label: string }) {
    super();
    this._value = opts.value;
    this._label = opts.label;
  }

  serialize(): MyData {
    return { value: this._value, label: this._label };
  }

  static fromSnapshot(data: MyData): MyComponent {
    return new MyComponent(data);
  }
}
```

**Partial serialization** (contains Textures or other non-serializable objects):

Use string-based alternatives (`source: FrameSource`, `textureKey: string`) when available. When only raw objects are provided, `serialize()` returns `null` and the entity must reconstruct in `afterRestore()`.

```typescript
import { AnimatedSpriteComponent, AnimationController } from "@yagejs/renderer";

// Serializable — uses FrameSource (string key + frame dimensions)
new AnimatedSpriteComponent({
  source: { sheet: "player_idle.png", frameWidth: 48 },
  layer: "player",
});
new AnimationController<PlayerAnim>({
  idle: { source: { sheet: "player_idle.png", frameWidth: 48 }, speed: 0.15 },
  walk: { source: { sheet: "player_walk.png", frameWidth: 48 }, speed: 0.2 },
});

// NOT serializable — raw Texture[] (backward compat, entity handles afterRestore)
new AnimatedSpriteComponent({ textures: myTextureArray });
```

**Serialization status by component:**

| Component                  | Pattern                                    | String key                                                |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `Transform`                | Full                                       | N/A (all primitives)                                      |
| `SpriteComponent`          | Full when using string texture key         | `texture: "sprite.png"`                                   |
| `GraphicsComponent`        | Partial (layer only, draw in afterRestore) | N/A                                                       |
| `RigidBodyComponent`       | Full                                       | N/A (all primitives)                                      |
| `ColliderComponent`        | Full                                       | N/A (all primitives)                                      |
| `AnimatedSpriteComponent`  | Full when using `source`                   | `source: { sheet, frameWidth }` or `{ atlas, animation }` |
| `AnimationController`      | Full when ALL defs use `source`            | Same as above                                             |
| `SoundComponent`           | Full                                       | `alias` is already a string                               |
| `ParticleEmitterComponent` | Full when using `textureKey`               | `textureKey: "particle.png"`                              |
| `TilemapComponent`         | Full when using `mapKey`                   | `mapKey: "dungeon.json"`                                  |
| `UIPanel` / `UIRoot`       | Not serializable                           | State belongs in owning component/entity                  |

### Make an Entity Serializable

Entities need `@serializable` and optionally `serialize()` / `afterRestore()`:

```typescript
import { Entity, Transform, Vec2, serializable } from "@yagejs/core";
import type { SnapshotResolver } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";

@serializable
class PlayerEntity extends Entity {
  private health = 100;

  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new SpriteComponent({ texture: "player.png", layer: "world" }));
  }

  // Save custom state (components with fromSnapshot() are saved automatically)
  serialize() {
    return { health: this.health };
  }

  // Restore non-serializable state after all components are restored
  afterRestore(data: { health: number }, resolve: SnapshotResolver) {
    this.health = data.health;
    // resolve.entity(savedId) maps old IDs → restored entity instances
  }
}
```

### Use the Save System

```typescript
import { SavePlugin, SaveServiceKey } from "@yagejs/save";

// Register the plugin:
engine.use(new SavePlugin());

// In game code:
const save = this.service(SaveServiceKey);
save.saveSnapshot("slot1"); // save full game state
await save.loadSnapshot("slot1"); // restore from snapshot
save.saveData("settings", { volume: 0.8 }); // save user data
const settings = save.loadData("settings"); // load user data
```

### Serializing Drawables (GraphicsComponent)

`GraphicsComponent` only serializes its layer name — draw commands are procedural and can't be captured. The entity or a sibling component must redo the drawing in `afterRestore()`:

```typescript
@serializable
class HealthBar extends Entity {
  private health = 100;

  setup() {
    this.add(new Transform());
    this.add(new GraphicsComponent({ layer: "hud" }));
    this.drawBar();
  }

  serialize() {
    return { health: this.health };
  }

  afterRestore(data: { health: number }) {
    this.health = data.health;
    this.drawBar(); // GraphicsComponent is auto-restored (layer), but empty — redraw
  }

  private drawBar() {
    const gfx = this.get(GraphicsComponent).graphics;
    gfx.clear();
    gfx.rect(0, 0, this.health, 10).fill(0x00ff00);
  }
}
```

### Serializing UI State (vanilla `@yagejs/ui`)

UI panels are view-layer — they don't hold game state. The component that owns the panel stores the state and builds/updates the UI from it. On restore, `fromSnapshot` sets the state before `onAdd` builds the panel:

```typescript
@serializable
class InventoryUI extends Component {
  private selectedTab = 0;
  private tabButtons: UIButton[] = [];

  onAdd() {
    const panel = this.entity.add(new UIPanel({ width: 300, height: 400 }));
    const tabs = ["Weapons", "Armor", "Items"];
    for (let i = 0; i < tabs.length; i++) {
      const btn = new UIButton({
        text: tabs[i]!,
        onClick: () => this.switchTab(i),
      });
      this.tabButtons.push(btn);
      panel.addChild(btn);
    }
    this.updateView();
  }

  switchTab(index: number) {
    this.selectedTab = index;
    this.updateView(); // mutate existing elements, don't rebuild
  }

  private updateView() {
    for (let i = 0; i < this.tabButtons.length; i++) {
      this.tabButtons[i]!.tint = i === this.selectedTab ? 0xffd700 : 0x888888;
    }
  }

  serialize() {
    return { selectedTab: this.selectedTab };
  }

  static fromSnapshot(data: { selectedTab: number }): InventoryUI {
    const comp = new InventoryUI();
    comp.selectedTab = data.selectedTab; // set before onAdd() builds the UI
    return comp;
  }
}
```

### Serializing UI State (React `@yagejs/ui-react`)

React components re-render from state — the entity bridges the store to the save system:

```typescript
const inventoryStore = createStore({ selectedTab: 0, scrollY: 0 });

@serializable
class InventoryEntity extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new UIRoot({ element: createElement(InventoryPanel) }));
  }

  serialize() {
    return { ui: inventoryStore.get() };
  }

  afterRestore(data: { ui: { selectedTab: number; scrollY: number } }) {
    inventoryStore.set(data.ui); // React re-renders via useStore()
  }
}

// React component — pure view, reads from store
function InventoryPanel() {
  const { selectedTab } = useStore(inventoryStore);
  return <Tabs selected={selectedTab} />;
}
```

### Define a Blueprint (deprecated)

Blueprints still work but entity subclasses are preferred for new code.

```typescript
import { defineBlueprint, Transform } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";

export const MyBlueprint = defineBlueprint<{ x: number; y: number }>(
  "my-entity",
  (entity, { x, y }) => {
    entity.add(new Transform({ position: new Vec2(x, y) }));
    entity.add(new SpriteComponent({ texture: "my-sprite.png" }));
  },
);

// Usage: scene.spawn(MyBlueprint, { x: 100, y: 200 });
```

### Scene Class (Recommended for Real Games)

Use a Scene subclass when you need full lifecycle hooks, asset preloading, or reusable/testable scenes. Services are accessed via `this.service(Key)` which returns a lazy proxy safe to assign as a field.

```typescript
import { Scene, Transform, Vec2 } from "@yagejs/core";
import { CameraEntity } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";

class GameScene extends Scene {
  readonly name = "game";

  // Lazy proxies — safe to declare as fields, resolved on first use
  private input = this.service(InputManagerKey);

  onEnter() {
    const player = this.spawn(PlayerEntity, { x: 100, y: 200 });
    const cam = this.spawn(CameraEntity, { follow: player.get(Transform) });
  }

  onExit() {
    // Cleanup logic
  }
}

// Push onto engine
engine.scenes.push(new GameScene());
```

> **Physics world access:** Physics worlds are per-scene. Components that need
> direct world access (raycasts, gravity) resolve once in `onAdd()`:
>
> ```typescript
> import { PhysicsWorldKey } from "@yagejs/physics";
> import type { PhysicsWorld } from "@yagejs/physics";
>
> class MyComponent extends Component {
>   private world!: PhysicsWorld;
>   onAdd() {
>     this.world = this.use(PhysicsWorldKey);
>   }
> }
> ```

### Engine Setup

Create an `Engine`, register plugins with `engine.use()`, then start and push a scene:

```typescript
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { InputPlugin } from "@yagejs/input";
import { DebugPlugin } from "@yagejs/debug";

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 800, height: 600 }));
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
engine.use(new DebugPlugin());

await engine.start();
engine.scenes.push(new GameScene());
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

| Convention                         | Details                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Immutable Vec2**                 | `Vec2` is immutable. All operations return new instances. Never mutate `v.x`/`v.y` directly.                                                                                                        |
| **Transform is mutable**           | `Transform` is the one mutable component. Use `setPosition()`, `translate()`, etc.                                                                                                                  |
| **Components own game logic**      | Components can have `update(dt)` and `fixedUpdate(dt)` methods — the built-in `ComponentUpdateSystem` calls them. Systems are for engine internals and cross-cutting concerns (physics, rendering). |
| **Phase assignment**               | Physics in `FixedUpdate`. Input polling in `EarlyUpdate`. Rendering in `Render`. Cleanup in `EndOfFrame`.                                                                                           |
| **ServiceKey for DI**              | Always use `ServiceKey<T>` for type-safe service resolution. Never use string keys directly.                                                                                                        |
| **Plain objects for config**       | Plugin configs, action maps, collider shapes -- all plain objects. No `Map`, no classes for config.                                                                                                 |
| **Pixels everywhere**              | All user-facing APIs work in pixels. Physics coordinate conversion is internal to `PhysicsWorld`.                                                                                                   |
| **co-located unit tests**          | `Foo.ts` test goes in `Foo.test.ts` in the same directory.                                                                                                                                          |
| **E2E tests in `e2e/`**            | Integration tests at repo root, not inside packages.                                                                                                                                                |
| **AssetHandle factories**          | Each plugin exports a factory (e.g., `texture()`, `spritesheet()`, `sound()`) that returns `AssetHandle<T>`. Define handles at module scope, load in scene lifecycle.                               |
| **Entity subclass over Blueprint** | Prefer `class Foo extends Entity` with `setup()` for entity types. Use `@trait()` decorator for discoverable capabilities. Blueprints are deprecated but still work.                                |
| **Entity events for game logic**   | Use `defineEvent()` / `entity.on()` / `entity.emit()` for entity-scoped events. Use `EventBus` for global engine events.                                                                            |
| **`@serializable` for save/load**  | Decorate Component/Entity/Scene subclasses. Implement `serialize()` + `static fromSnapshot()`. Use string keys (`FrameSource`, `textureKey`) instead of raw PixiJS objects for full serialization.  |

### Pitfalls to Avoid

| Pitfall                                                       | Why                                                                                                                                                                                               | Instead                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Putting engine-level cross-cutting concerns in Components** | Physics stepping, render sync, and collision dispatch need efficient cross-entity queries and strict phase ordering. Putting these in Components means duplicate work and no centralized control. | Use Systems for engine-level concerns (physics, rendering, audio). Components are for game logic.                           |
| **Importing PixiJS types into `@yagejs/core`**                | Creates a dependency from core to pixi.js, breaking the zero-dependency guarantee.                                                                                                                | Keep PixiJS types inside `@yagejs/renderer`. Use abstract interfaces in core if needed.                                     |
| **Using `context.resolve()` in a constructor**                | Context may not be fully populated during plugin installation.                                                                                                                                    | Use `onRegister()` for systems or `onEnter()` for scenes to resolve services.                                               |
| **Mutating Vec2**                                             | Vec2 is immutable by design. Mutations would break assumptions in caching and comparison.                                                                                                         | Use `vec.add()`, `vec.scale()`, etc. which return new instances.                                                            |
| **Running async code in system `update()`**                   | The game loop is synchronous. Async operations skip frames and cause non-determinism.                                                                                                             | Start async work outside the loop, use events to communicate completion, or use Process for frame-aligned delays.           |
| **Forgetting to export from `index.ts`**                      | Unexported types won't be available to consumers.                                                                                                                                                 | Always add new public types to the package's barrel export.                                                                 |
| **Registering duplicate ServiceKeys**                         | `EngineContext.register()` throws on duplicates.                                                                                                                                                  | Check with `context.has()` first, or ensure only one plugin registers each key.                                             |
| **Putting unit tests in `e2e/`**                              | Unit tests should be fast and not require a browser.                                                                                                                                              | Co-locate with source. Only put browser-dependent tests in `e2e/`.                                                          |
| **Using `setTimeout` or `setInterval` in game logic**         | Breaks deterministic frame execution. Timers drift and don't respect pause.                                                                                                                       | Use `ProcessComponent` with slots for cooldowns/timers, `pc.run()` for one-offs, or `TimerEntity` for scene-level timing.   |
| **Using boolean flags for cooldown state**                    | Manual booleans + `Process.delay` to reset them is error-prone and verbose.                                                                                                                       | Use `ProcessSlot` — `slot.completed` IS the state. No separate boolean needed.                                              |
| **Assuming render order = spawn order**                       | Render order is controlled by `RenderLayer` and draw priority, not entity creation order.                                                                                                         | Use layers for explicit draw ordering.                                                                                      |
| **Passing raw `Texture` objects to serializable components**  | `Texture` is a PixiJS runtime object — not JSON-serializable. `serialize()` returns `null` and the entity must handle reconstruction manually.                                                    | Use string keys: `source: { sheet, frameWidth }` for animations, `textureKey` for particles, `texture: "path"` for sprites. |

### Type Safety Checklist

Before submitting code:

- [ ] No `any` in public API signatures
- [ ] All exported functions and classes have TSDoc comments
- [ ] `ComponentClass<C>` generic is used correctly (not raw `new (...args) => Component`)
- [ ] `ServiceKey<T>` matches the service type it resolves to
- [ ] Enums use string values (not numeric) for debuggability

---

## 9. Architecture Decision Quick Reference

Quick summary of the key architectural decisions:

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
| `@serializable` decorator in core                       | Components/entities self-register at import time. `SaveService` reads the registry — no manual registration needed                             |
| String keys for texture-dependent components            | `FrameSource` (animation), `textureKey` (particles), string texture key (sprites) enable serialization without coupling to PixiJS objects      |

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) -- Plugin system specification
- [RECIPES_PLAN.md](./RECIPES_PLAN.md) -- Recipe roadmap for reusable gameplay modules

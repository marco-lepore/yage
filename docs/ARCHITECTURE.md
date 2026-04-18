# YAGE -- Plugin Architecture

## Overview

YAGE's plugin system is the mechanism by which all engine features beyond the core kernel are delivered. Rendering, physics, input, audio -- everything is a plugin. This document specifies the plugin interface, lifecycle, dependency management, and how to create custom plugins.

---

## 1. Plugin Interface

Every plugin implements the `Plugin` interface from `@yagejs/core`:

```typescript
export interface Plugin {
  /** Unique plugin name. Used for dependency resolution and logging. */
  readonly name: string;

  /** Plugin version (semver). */
  readonly version: string;

  /**
   * Names of plugins this plugin depends on.
   * The engine installs plugins in topological order based on dependencies.
   * Optional -- omit or return empty array if no dependencies.
   */
  readonly dependencies?: string[];

  /**
   * Called during engine.start() to set up the plugin.
   * Register services, allocate resources, bind event listeners.
   * May be async (e.g., loading WASM for physics).
   * Optional -- omit if the plugin has nothing to install.
   */
  install?(context: EngineContext): void | Promise<void>;

  /**
   * Register systems into the game loop.
   * Called after install(), before onStart().
   * Optional -- omit if the plugin doesn't need per-frame systems.
   */
  registerSystems?(scheduler: SystemScheduler): void;

  /**
   * Called after all plugins are installed and the game loop starts.
   * Optional -- use for post-initialization logic.
   */
  onStart?(): void;

  /**
   * Called when the engine is destroyed.
   * Clean up resources, remove event listeners.
   * Optional -- omit if nothing to clean up.
   */
  onDestroy?(): void;
}
```

---

## 2. Plugin Lifecycle

### Registration Phase

```typescript
const engine = new Engine();
engine.use(new RendererPlugin({ width: 800, height: 600 }));
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
engine.use(new InputPlugin({ actions: { jump: ['Space'] } }));
```

`engine.use()` stores the plugin instance. No installation happens yet. Plugins can be registered in any order -- dependency sorting happens at start time.

### Start Phase (`engine.start()`)

```
1. Sort plugins topologically by dependencies
2. For each plugin (in dependency order):
   a. Call plugin.install(context)        -- Register services
   b. Call plugin.registerSystems?()      -- Add systems to scheduler
3. Start the game loop
4. For each plugin (in dependency order):
   a. Call plugin.onStart?()              -- Post-init logic
```

### Destroy Phase (`engine.destroy()`)

```
1. Stop the game loop
2. For each plugin (in reverse dependency order):
   a. Call plugin.onDestroy?()            -- Clean up
3. Clear all services from EngineContext
```

### Lifecycle Diagram

```
engine.use(plugin)     →  stored (not installed)
engine.start()         →  install() → registerSystems() → loop starts → onStart()
engine.destroy()       →  loop stops → onDestroy() (reverse order) → context cleared
```

---

## 3. Dependency Declaration and Topological Sorting

### How Dependencies Work

A plugin declares dependencies by name:

```typescript
class ParticlesPlugin implements Plugin {
  readonly name = 'particles';
  readonly version = '2.0.0';
  readonly dependencies = ['renderer'];  // Requires renderer to be installed first

  install(context: EngineContext) {
    // Safe to resolve RendererKey here -- renderer is guaranteed to be installed
    const renderer = context.resolve(RendererKey);
    // ...
  }
}
```

### Sorting Algorithm

The engine uses Kahn's algorithm (BFS topological sort) to determine install order:

```
Input: [renderer, input, physics, particles, ui, ui-react, debug]
Dependencies:
  renderer: []
  input: []
  physics: []
  particles: [renderer]
  ui: [renderer]
  ui-react: [renderer, ui]
  debug: [renderer]

Sorted: [renderer, input, physics, particles, ui, ui-react, debug]
  (order among independent plugins is stable based on registration order)
```

### Error Cases

| Error | When | Message |
|---|---|---|
| Missing dependency | Plugin A depends on B, but B was not registered | `Plugin "particles" depends on "renderer", which is not registered. Call engine.use(new RendererPlugin(...)) before engine.start().` |
| Circular dependency | A depends on B, B depends on A | `Circular dependency detected: particles → renderer → particles` |
| Duplicate name | Two plugins with the same name | `Plugin "renderer" is already registered.` |

All errors are thrown during `engine.start()`, before any plugin is installed.

---

## 4. Service Registration via EngineContext

### The ServiceKey Pattern

Plugins register services using typed `ServiceKey<T>` objects. This provides:
- **Type safety**: `context.resolve(RendererKey)` returns `RendererPlugin`, not `unknown`.
- **Decoupling**: Consumers resolve by key, not by import. A mock can replace a real service.
- **Discovery**: Each plugin exports its own service keys.

### Registration Flow

```typescript
// @yagejs/renderer exports:
export const RendererKey = new ServiceKey<RendererPlugin>('renderer');

// Inside RendererPlugin.install():
class RendererPlugin implements Plugin {
  install(context: EngineContext) {
    const app = new Application();
    await app.init(this.config);

    context.register(RendererKey, this);
  }
}

// Camera is now an entity, not a service:
import { CameraEntity } from "@yagejs/renderer";

// In a scene's onEnter():
const cam = this.spawn(CameraEntity, { follow: player.get(Transform) });
cam.shake(6, 300);    // convenience methods delegate to CameraComponent
cam.zoomTo(1.5, 500); // no need for cam.get(CameraComponent)
```

### Well-Known Service Keys

These keys are registered by `@yagejs/core` itself (not by plugins):

| Key | Type | Registered by |
|---|---|---|
| `EngineKey` | `Engine` | Engine constructor |
| `EventBusKey` | `EventBus<EngineEvents>` | Engine constructor |
| `SceneManagerKey` | `SceneManager` | Engine constructor |
| `LoggerKey` | `Logger` | Engine constructor |
| `InspectorKey` | `Inspector` | Engine constructor |
| `QueryCacheKey` | `QueryCache` | Engine constructor |
| `ErrorBoundaryKey` | `ErrorBoundary` | Engine constructor |
| `GameLoopKey` | `GameLoop` | Engine constructor |
| `SystemSchedulerKey` | `SystemScheduler` | Engine constructor |
| `ProcessSystemKey` | `ProcessSystem` | Engine constructor |
| `AssetManagerKey` | `AssetManager` | Engine constructor |

Keys registered by official plugins:

| Key | Type | Registered by |
|---|---|---|
| `RendererKey` | `Renderer` | `@yagejs/renderer` |
| `SceneRenderTreeProviderKey` | `SceneRenderTreeProvider` | `@yagejs/renderer` |
| `SceneRenderTreeKey` | `SceneRenderTree` (scene-scoped) | `@yagejs/renderer` |
| `PhysicsWorldManagerKey` | `PhysicsWorldManager` | `@yagejs/physics` |
| `PhysicsWorldKey` | `PhysicsWorld` (scene-scoped) | `@yagejs/physics` |
| `InputManagerKey` | `InputManager` | `@yagejs/input` |
| `AudioManagerKey` | `AudioManager` | `@yagejs/audio` |
| `DebugRegistryKey` | `DebugRegistry` | `@yagejs/debug` |

Keys marked **(scene-scoped)** are per-scene — `Component.use()` resolves the
correct scene's instance automatically. Internally, plugins register them via
scene lifecycle hooks (`packages/core/src/SceneHooks.ts`).

### Optional Dependencies

Some plugins have optional integrations. For example, `@yagejs/tilemap` can extract collision shapes for `@yagejs/physics`, but physics is not required:

```typescript
class TilemapPlugin implements Plugin {
  readonly name = 'tilemap';
  readonly dependencies = ['renderer'];  // Hard dependency: renderer required

  install(context: EngineContext) {
    // Optional physics integration
    const physicsManager = context.tryResolve(PhysicsWorldManagerKey);
    if (physicsManager) {
      // Register collision shapes from tilemap object layers
    }
  }
}
```

Use `context.tryResolve()` for optional dependencies and `context.resolve()` for required ones.

---

## 5. System Registration

Plugins register systems into the game loop via `registerSystems()`:

```typescript
class PhysicsPlugin implements Plugin {
  registerSystems(scheduler: SystemScheduler) {
    scheduler.add(new PhysicsSystem(this.world));
    scheduler.add(new PhysicsInterpolationSystem(this.world));
  }
}
```

### Phase Assignment

Each system declares which phase it runs in:

```typescript
class PhysicsSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 0;
}

class PhysicsInterpolationSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 100;  // After other LateUpdate systems
}
```

### Execution Order

Within each phase, systems run in priority order (lower first). Systems from different plugins can interleave:

```
EarlyUpdate:
  InputSystem (priority -100, from @yagejs/input)

FixedUpdate:
  PhysicsSystem (priority 0, from @yagejs/physics)
  UserGameplaySystem (priority 10, user code)

Update:
  ParticleSystem (priority 0, from @yagejs/particles)

LateUpdate:
  CameraFollowSystem (priority 0, user code)
  PhysicsInterpolationSystem (priority 100, from @yagejs/physics)
  UILayoutSystem (priority 200, from @yagejs/ui)

Render:
  DisplaySystem (priority 0, from @yagejs/renderer)
  DebugOverlaySystem (priority 1000, from @yagejs/debug)

EndOfFrame:
  InputClearSystem (priority 0, from @yagejs/input)
  EntityCleanupSystem (priority 100, from @yagejs/core)
```

---

## 6. Component Exposure

Components don't need to be "registered" with the engine. They're just classes that extend `Component`. Any plugin can export component classes, and users import and use them directly:

```typescript
// @yagejs/physics exports:
export class RigidBodyComponent extends Component { ... }
export class ColliderComponent extends Component { ... }

// User code imports and uses:
import { RigidBodyComponent, ColliderComponent } from '@yagejs/physics';

const entity = scene.spawn('ball');
entity.add(new RigidBodyComponent({ type: 'dynamic' }));
entity.add(new ColliderComponent({ shape: { type: 'circle', radius: 20 } }));
```

### Component-System Communication

Components store data. Systems operate on data. The link is through `QueryCache`:

```typescript
// System queries for entities with specific components
class PhysicsSystem extends System {
  private query!: QueryResult;

  onRegister(context: EngineContext) {
    const cache = context.resolve(QueryCacheKey);
    this.query = cache.register([Transform, RigidBodyComponent]);
  }

  update(dt: number) {
    for (const entity of this.query) {
      const transform = entity.get(Transform);
      const body = entity.get(RigidBodyComponent);
      // Sync transforms, step physics, etc.
    }
  }
}
```

---

## 7. Engine Events

Plugins can listen to engine-wide events via the `EventBus`:

```typescript
class DebugPlugin implements Plugin {
  install(context: EngineContext) {
    const events = context.resolve(EventBusKey);

    events.on('entity:created', ({ entity }) => {
      console.log(`Entity created: ${entity.name}`);
    });

    events.on('entity:destroyed', ({ entity }) => {
      console.log(`Entity destroyed: ${entity.name}`);
    });

    events.on('scene:pushed', ({ scene }) => {
      console.log(`Scene pushed: ${scene.name}`);
    });
  }
}
```

### Available Engine Events

| Event | Data | When |
|---|---|---|
| `entity:created` | `{ entity: Entity }` | After `scene.spawn()` |
| `entity:destroyed` | `{ entity: Entity }` | After entity is cleaned up in endOfFrame |
| `component:added` | `{ entity: Entity; component: Component }` | After `entity.add()` |
| `component:removed` | `{ entity: Entity; componentClass: ComponentClass }` | After `entity.remove()` |
| `scene:pushed` | `{ scene: Scene }` | After `sceneManager.push()` |
| `scene:popped` | `{ scene: Scene }` | After `sceneManager.pop()` |
| `scene:replaced` | `{ oldScene: Scene; newScene: Scene }` | After `sceneManager.replace()` |
| `engine:started` | `void` | After `engine.start()` completes |
| `engine:stopped` | `void` | During `engine.destroy()` |

---

## 8. Creating a Custom Plugin (Step-by-Step)

### Example: A Score Tracking Plugin

**Goal**: Track player score across scenes, emit events on change, expose via service key.

#### Step 1: Define the Service Key and Types

```typescript
// packages/score/src/types.ts
import { ServiceKey } from '@yagejs/core';

export const ScoreManagerKey = new ServiceKey<ScoreManager>('scoreManager');

export interface ScoreEvents {
  'score:changed': { score: number; delta: number };
  'score:milestone': { score: number; milestone: number };
}
```

#### Step 2: Implement the Service

```typescript
// packages/score/src/ScoreManager.ts
import { EventBus } from '@yagejs/core';

export class ScoreManager {
  private _score: number = 0;
  private milestones: number[];
  private events: EventBus;

  constructor(events: EventBus, milestones: number[] = [100, 500, 1000]) {
    this.events = events;
    this.milestones = milestones;
  }

  get score(): number {
    return this._score;
  }

  add(points: number): void {
    const oldScore = this._score;
    this._score += points;

    this.events.emit('score:changed', {
      score: this._score,
      delta: points,
    });

    // Check milestones
    for (const m of this.milestones) {
      if (oldScore < m && this._score >= m) {
        this.events.emit('score:milestone', {
          score: this._score,
          milestone: m,
        });
      }
    }
  }

  reset(): void {
    this._score = 0;
    this.events.emit('score:changed', { score: 0, delta: -this._score });
  }
}
```

#### Step 3: Implement the Plugin

```typescript
// packages/score/src/ScorePlugin.ts
import { Plugin, EngineContext, EventBusKey } from '@yagejs/core';
import { ScoreManager } from './ScoreManager';
import { ScoreManagerKey } from './types';

export interface ScoreConfig {
  milestones?: number[];
}

export class ScorePlugin implements Plugin {
  readonly name = 'score';
  readonly version = '1.0.0';
  // No dependencies -- works with just @yagejs/core

  private config: ScoreConfig;
  private manager?: ScoreManager;

  constructor(config?: ScoreConfig) {
    this.config = config ?? {};
  }

  install(context: EngineContext): void {
    const events = context.resolve(EventBusKey);
    this.manager = new ScoreManager(events, this.config.milestones);
    context.register(ScoreManagerKey, this.manager);
  }

  onDestroy(): void {
    this.manager = undefined;
  }
}
```

#### Step 4: Export the Public API

```typescript
// packages/score/src/index.ts
export { ScorePlugin } from './ScorePlugin';
export { ScoreManager } from './ScoreManager';
export { ScoreManagerKey } from './types';
export type { ScoreConfig, ScoreEvents } from './types';
```

#### Step 5: Use It

```typescript
import { Engine, Scene } from '@yagejs/core';
import { ScorePlugin, ScoreManagerKey } from '@yagejs/score';

const engine = new Engine();
engine.use(new ScorePlugin({ milestones: [100, 500, 1000, 5000] }));

class GameScene extends Scene {
  readonly name = 'game';

  onEnter() {
    const score = this.context.resolve(ScoreManagerKey);
    score.add(50);
    console.log(score.score); // 50
  }
}
```

#### Step 6: Add a System (Optional)

If the plugin needs per-frame logic, add a system:

```typescript
// ScoreDisplaySystem.ts
import { System, Phase, EngineContext } from '@yagejs/core';
import { ScoreManagerKey } from './types';

export class ScoreDisplaySystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 50;

  private scoreManager!: ScoreManager;

  onRegister(context: EngineContext) {
    this.scoreManager = context.resolve(ScoreManagerKey);
  }

  update(dt: number) {
    // Update score display entity, if present
  }
}

// In ScorePlugin:
registerSystems(scheduler: SystemScheduler) {
  scheduler.add(new ScoreDisplaySystem());
}
```

---

## 9. Plugin Isolation Guarantees

### What Plugins Can Do

- Register services on `EngineContext`
- Resolve services from `EngineContext` (their own + dependencies')
- Register systems into the game loop
- Listen to engine events
- Export component classes
- Read/write entities and components

### What Plugins Cannot Do

- **Access another plugin's internals**: Only public service keys are accessible. Private state stays private.
- **Override another plugin's services**: `EngineContext.register()` throws on duplicate keys. A plugin cannot replace another plugin's service.
- **Remove another plugin's systems**: Plugins can only add and remove their own systems.
- **Block the game loop**: All system `update()` calls are wrapped by `ErrorBoundary`. A throwing system is disabled, not allowed to crash the loop.

### Failure Isolation

If a plugin's system throws:

1. `ErrorBoundary` catches the error
2. The system is disabled (`system.enabled = false`)
3. The error is logged with full context
4. The game loop continues running other systems
5. The Inspector reports the disabled system via `getErrors()`

If a plugin's `install()` throws:

1. `engine.start()` throws with a descriptive error
2. No other plugins are installed
3. The engine does not start

---

## 10. Plugin Configuration Patterns

### Constructor Config

The standard pattern. Pass configuration when creating the plugin:

```typescript
engine.use(new RendererPlugin({
  width: 800,
  height: 600,
  virtualWidth: 400,
  virtualHeight: 300,
}));
```

### Runtime Reconfiguration

For settings that can change during gameplay, expose methods on the service:

```typescript
const audio = context.resolve(AudioManagerKey);
audio.setChannelVolume('music', 0.5);
audio.setMasterMuted(true);
```

### Event-Driven Configuration

For plugins that react to external changes:

```typescript
const events = context.resolve(EventBusKey);
events.on('settings:changed', ({ key, value }) => {
  if (key === 'musicVolume') {
    audio.setChannelVolume('music', value);
  }
});
```

---

## References

- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- How to add/modify plugins as a coding agent
- [RECIPES_PLAN.md](./RECIPES_PLAN.md) -- Boundary between base plugins and recipes

# YAGE -- Plugin Architecture

## Overview

Every engine feature beyond the core kernel ships as a plugin. Rendering, physics, input, audio -- everything is a plugin. This document specifies the plugin interface, lifecycle, dependency management, and how to create custom plugins.

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
  readonly dependencies?: readonly string[];

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
   * Called after all plugins are installed and the game loop has started.
   * May be async: the engine awaits it before calling the next plugin's
   * onStart() and before emitting engine:started.
   * Optional -- use for post-initialization logic.
   */
  onStart?(): void | Promise<void>;

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
engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
```

`engine.use()` stores the plugin instance. No installation happens yet. Plugins can be registered in any order -- dependency sorting happens at start time.

### Start Phase (`engine.start()`)

```
1. Sort plugins topologically by dependencies
2. For each plugin (in dependency order):
   a. Call plugin.install(context)        -- Register services (awaited)
3. For each plugin (in dependency order):
   a. Call plugin.registerSystems?()      -- Add systems to scheduler
4. Initialize registered systems          -- system.onRegister?(context)
5. Start the game loop
6. For each plugin (in dependency order):
   a. Call plugin.onStart?()              -- Post-init logic (awaited)
7. Emit engine:started
```

`engine.start()` resolves after step 7. A scene pushed right after
`await engine.start()` therefore runs after every plugin's `onStart()` has
completed.

### Destroy Phase (`engine.destroy()`)

```
1. Emit engine:stopped
2. Stop the game loop
3. Tear down every scene on the stack
4. Call system.onUnregister?() (reverse registration order)
5. For each plugin (in reverse dependency order):
   a. Call plugin.onDestroy?()            -- Clean up
6. Dispose the inspector and clear the event bus
```

The stages are independent. If one stage throws, the remaining stages still
run. `engine.destroy()` rethrows the first error after teardown finishes.

### Lifecycle Diagram

```
engine.use(plugin)     →  stored (not installed)
engine.start()         →  install() → registerSystems() → onRegister() → loop starts → onStart() → engine:started
engine.destroy()       →  loop stops → scenes torn down → onUnregister() → onDestroy() (reverse order)
```

An engine instance runs once. After `destroy()`, and after a `start()` that
rejects, any later `start()` or `use()` call on that instance throws. Services
stay registered in `EngineContext` because plugins do not unregister them, so
the same instance cannot be started a second time. Construct a new `Engine`
instead.

---

## 3. Dependency Declaration and Topological Sorting

### How Dependencies Work

A plugin declares dependencies by name:

```typescript
class ParticlesPlugin implements Plugin {
  readonly name = "particles";
  readonly version = "2.0.0";
  readonly dependencies = ["renderer"]; // Requires renderer to be installed first

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
  ui-react: [ui]
  debug: [renderer]

Sorted: [renderer, input, physics, particles, ui, ui-react, debug]
  (order among independent plugins is stable based on registration order)
```

### Error Cases

| Error               | When                                            | Message                                                              |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Missing dependency  | Plugin A depends on B, but B was not registered | `Plugin "particles" depends on "renderer", which is not registered.` |
| Circular dependency | A depends on B, B depends on A                  | `Circular dependency detected among plugins.`                        |
| Duplicate name      | Two plugins with the same name                  | `Plugin "renderer" is already registered.`                           |

The dependency errors are thrown by `engine.start()` before any plugin is installed. A duplicate name is rejected by `engine.use()` itself.

---

## 4. Service Registration via EngineContext

### The ServiceKey Pattern

Plugins register services using typed `ServiceKey<T>` objects. Keys give:

- **Type safety**: `context.resolve(RendererKey)` returns `RendererPlugin`, not `unknown`.
- **Decoupling**: Consumers resolve by key, not by import. A mock can replace a real service.
- **Discovery**: Each plugin exports its own service keys.

The id string identifies the service. Separate `ServiceKey` objects with the
same id resolve the same registration. A package may repeat an id for the same
service contract when importing the owner's key would add an optional runtime
dependency. The repeated declaration needs a nearby comment that names the
package that owns the key.

### Registration Flow

```typescript
// @yagejs/renderer exports:
export const RendererKey = new ServiceKey<RendererPlugin>("renderer");

// Inside RendererPlugin.install():
class RendererPlugin implements Plugin {
  async install(context: EngineContext) {
    const app = new Application();
    await app.init(this.config);

    context.register(RendererKey, this);
  }
}

// The camera is an entity spawned into the scene, not a registered service:
import { CameraEntity } from "@yagejs/renderer";

// In a scene's onEnter():
const cam = this.spawn(CameraEntity, { follow: player.get(Transform) });
cam.shake(6, 0.3); // durations in seconds; convenience methods delegate to CameraComponent
cam.zoomTo(1.5, 0.5); // no need for cam.get(CameraComponent)
```

### Well-Known Service Keys

These keys are registered by `@yagejs/core` itself (not by plugins):

| Key                    | Type                           | Registered by                         |
| ---------------------- | ------------------------------ | ------------------------------------- |
| `EngineKey`            | `Engine`                       | Engine constructor                    |
| `EventBusKey`          | `EventBus<EngineEvents>`       | Engine constructor                    |
| `SceneManagerKey`      | `SceneManager`                 | Engine constructor                    |
| `LoggerKey`            | `Logger`                       | Engine constructor                    |
| `InspectorKey`         | `Inspector`                    | Engine constructor                    |
| `QueryCacheKey`        | `QueryCache`                   | Engine constructor                    |
| `ErrorBoundaryKey`     | `ErrorBoundary`                | Engine constructor                    |
| `GameLoopKey`          | `GameLoop`                     | Engine constructor                    |
| `SystemSchedulerKey`   | `SystemScheduler`              | Engine constructor                    |
| `ProcessSystemKey`     | `ProcessSystem`                | Engine constructor                    |
| `AssetManagerKey`      | `AssetManager`                 | Engine constructor                    |
| `SceneHookRegistryKey` | `SceneHookRegistry`            | Engine constructor                    |
| `SceneTimeKey`         | `SceneTime` (scene-scoped)     | Engine's own `beforeEnter` scene hook |
| `RandomKey`            | `RandomService` (scene-scoped) | Engine's own `beforeEnter` scene hook |

`RendererAdapterKey` (`RendererAdapter`) is also defined in `@yagejs/core`. It holds the pointer-input adapter of the current renderer. `@yagejs/renderer` registers itself under that key. `@yagejs/input` resolves the key for canvas targeting and coordinate mapping, so it does not depend on the renderer package.

Keys registered by official plugins:

| Key                          | Type                             | Registered by      |
| ---------------------------- | -------------------------------- | ------------------ |
| `RendererKey`                | `RendererPlugin`                 | `@yagejs/renderer` |
| `SceneRenderTreeProviderKey` | `SceneRenderTreeProvider`        | `@yagejs/renderer` |
| `SceneRenderTreeKey`         | `SceneRenderTree` (scene-scoped) | `@yagejs/renderer` |
| `PhysicsWorldManagerKey`     | `PhysicsWorldManager`            | `@yagejs/physics`  |
| `PhysicsWorldKey`            | `PhysicsWorld` (scene-scoped)    | `@yagejs/physics`  |
| `InputManagerKey`            | `InputManager`                   | `@yagejs/input`    |
| `AudioManagerKey`            | `AudioManager`                   | `@yagejs/audio`    |
| `DebugRegistryKey`           | `DebugRegistry`                  | `@yagejs/debug`    |
| `LightingWorldManagerKey`    | `LightingWorldManager`           | `@yagejs/lighting` |
| `LightingWorldKey`           | `LightingWorld` (scene-scoped)   | `@yagejs/lighting` |
| `FloatingOverlayKey`         | `FloatingOverlay` (scene-scoped) | `@yagejs/ui`       |
| `UIReactPluginKey`           | `UIReactPlugin`                  | `@yagejs/ui-react` |
| `SaveServiceKey`             | `Save`                           | `@yagejs/save`     |

Keys marked **(scene-scoped)** are declared with `new ServiceKey(id, { scope: "scene" })` and hold one instance per scene. `Component.use()` resolves the active scene's instance automatically. A plugin provides them from scene lifecycle hooks, registered through `SceneHookRegistryKey`:

```typescript
// Inside PhysicsPlugin.install():
const hooks = context.resolve(SceneHookRegistryKey);
this.unregisterHooks = hooks.register({
  beforeEnter: (scene) => {
    scene.registerScoped(PhysicsWorldKey, this.manager.getOrCreateWorld(scene));
  },
  afterExit: (scene) => {
    this.manager.destroyWorld(scene);
  },
});
```

Scoped registrations are cleared automatically when the scene exits. Resolving a scene-scoped key that no hook registered throws from `Scene.use()`. The usual cause is resolving the key before `onEnter()`.

### Optional Dependencies

A plugin that works with or without another plugin's service resolves it with `context.tryResolve()`, which returns `undefined` instead of throwing:

```typescript
class MinimapPlugin implements Plugin {
  readonly name = "minimap";
  readonly dependencies = ["renderer"]; // Hard dependency: renderer required

  install(context: EngineContext) {
    // Optional physics integration: draw collider outlines when physics is present
    const physicsManager = context.tryResolve(PhysicsWorldManagerKey);
    if (physicsManager) {
      // ...
    }
  }
}
```

Use `context.tryResolve()` for optional dependencies and `context.resolve()` for required ones. A dependency that is optional at runtime must not appear in `dependencies`, or `engine.start()` rejects when it is absent.

An optional integration does not always need a service at all.
`@yagejs/tilemap/physics` exports `toPhysicsColliders()`, a plain function that
converts a map's collision layer into `@yagejs/physics` collider configs. The
root `@yagejs/tilemap` entry does not import physics, so rendering-only projects
do not need the physics package.

`@yagejs/input` and `@yagejs/physics` use private keys with the
`"debugRegistry"` id to contribute optional diagnostics. Neither built package
depends on `@yagejs/debug`, so installing input or physics adds no debug
package and no debug overlay.

---

## 5. System Registration

Plugins register systems into the game loop via `registerSystems()`:

```typescript
class PhysicsPlugin implements Plugin {
  registerSystems(scheduler: SystemScheduler) {
    scheduler.add(new PhysicsSystem());
    scheduler.add(new PhysicsInterpolationSystem());
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
  readonly phase = Phase.Update;
  readonly priority = -100; // Before game logic reads positions
}
```

### Execution Order

Within each phase, systems run in priority order (lower first). Systems from different plugins can interleave:

```
EarlyUpdate:
  InputPollSystem (priority -100, from @yagejs/input)

FixedUpdate:
  PhysicsSystem (priority 0, from @yagejs/physics)
  ProcessFixedUpdateSystem (priority 500, from @yagejs/core)
  ComponentFixedUpdateSystem (priority 1000, from @yagejs/core)

Update:
  PhysicsInterpolationSystem (priority -100, from @yagejs/physics)
  ProcessSystem (priority 500, from @yagejs/core)
  ComponentUpdateSystem (priority 1000, from @yagejs/core)

LateUpdate:
  ParticleSystem (priority 0, from @yagejs/particles)
  UILayoutSystem (priority 200, from @yagejs/ui)
  UIRootLayoutSystem (priority 200, from @yagejs/ui-react)
  FloatingOverlaySystem (priority 201, from @yagejs/ui)

Render:
  DisplaySystem (priority 0, from @yagejs/renderer)
  LightingSystem (priority 100, from @yagejs/lighting)
  DebugRenderSystem (priority 9999, from @yagejs/debug)

EndOfFrame:
  InputClearSystem (priority 9000, from @yagejs/input)
```

Game rules run inside `ComponentFixedUpdateSystem` and `ComponentUpdateSystem`, as component `fixedUpdate` and `update` methods. Game code does not add systems of its own.

---

## 6. Component Exposure

Components are not registered with the engine. They are classes that extend `Component`. Any plugin can export component classes, and users import and use them directly:

```typescript
// @yagejs/physics exports:
export class RigidBodyComponent extends Component { ... }
export class ColliderComponent extends Component { ... }

// User code imports and uses:
import { RigidBodyComponent, ColliderComponent } from '@yagejs/physics';

class Ball extends Entity {
  setup() {
    this.add(new Transform());
    this.add(new RigidBodyComponent({ type: 'dynamic' }));
    this.add(new ColliderComponent({ shape: { type: 'circle', radius: 20 } }));
  }
}
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

    events.on("entity:created", ({ entity }) => {
      console.log(`Entity created: ${entity.name}`);
    });

    events.on("entity:destroyed", ({ entity }) => {
      console.log(`Entity destroyed: ${entity.name}`);
    });

    events.on("scene:pushed", ({ scene }) => {
      console.log(`Scene pushed: ${scene.name}`);
    });
  }
}
```

### Available Engine Events

| Event                      | Data                                                 | When                                                              |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `entity:created`           | `{ entity: Entity }`                                 | After `scene.spawn()`                                             |
| `entity:destroyed`         | `{ entity: Entity; scene: Scene }`                   | After entity is cleaned up in endOfFrame                          |
| `component:added`          | `{ entity: Entity; component: Component }`           | After `entity.add()`                                              |
| `component:removed`        | `{ entity: Entity; componentClass: ComponentClass }` | After `entity.remove()`                                           |
| `scene:pushed`             | `{ scene: Scene }`                                   | After `sceneManager.push()`                                       |
| `scene:popped`             | `{ scene: Scene }`                                   | After `sceneManager.pop()`                                        |
| `scene:replaced`           | `{ oldScene: Scene; newScene: Scene }`               | After `sceneManager.replace()`                                    |
| `scene:transition:started` | `{ kind; fromScene?; toScene? }`                     | A scene transition begins                                         |
| `scene:transition:ended`   | `{ kind; fromScene?; toScene? }`                     | A scene transition finishes                                       |
| `scene:loading:progress`   | `{ scene: Scene; ratio: number }`                    | A loading scene reports progress                                  |
| `scene:loading:done`       | `{ scene: Scene }`                                   | A loading scene finishes                                          |
| `engine:started`           | `undefined`                                          | After every plugin's `onStart()` has completed                    |
| `engine:stopped`           | `undefined`                                          | First step of `engine.destroy()`                                  |
| `screen:fullscreen`        | `{ active: boolean }`                                | Canvas host enters or leaves fullscreen (from `@yagejs/renderer`) |
| `screen:orientation`       | `{ type: OrientationType }`                          | Device orientation changes (from `@yagejs/renderer`)              |

Entity payloads carry the live `Entity`. Scene payloads are `SceneRef` views, except `entity:destroyed` and the loading events, which carry the full `Scene`.

---

## 8. Creating a Custom Plugin (Step-by-Step)

A plugin owns infrastructure that the whole engine shares: a device, a browser API, a remote service. Game state is not a plugin. A score, lives or an inventory lives in a component on a host entity, and changes reach it as entity events:

```typescript
const EnemyDefeated = defineEvent<{ points: number }>("enemy:defeated");
export const ScoreChanged = defineEvent<{ score: number }>("score:changed");

/** The score, on a host entity spawned with { key: "score" }. */
class Score extends Component {
  private _points = 0;

  get points(): number {
    return this._points;
  }

  onAdd() {
    // Enemies emit on themselves; the event bubbles to the scene.
    this.listenScene(EnemyDefeated, ({ points }) => {
      this._points += points;
      this.entity.emit(ScoreChanged, { score: this._points });
    });
  }
}

// Anywhere in the scene:
const points = scene.findByKey("score")?.get(Score).points;
```

The full recipe is "Game state on a host entity" in `docs/llms/patterns.md`.

### Example: A Telemetry Plugin

**Goal**: let game code queue analytics records, send them to a server in batches, and expose the queue through a service key.

#### Step 1: Define the Service Key and Types

```typescript
// packages/telemetry/src/types.ts
import { ServiceKey } from "@yagejs/core";
import type { Telemetry } from "./Telemetry";

export const TelemetryKey = new ServiceKey<Telemetry>("telemetry");

export interface TelemetryConfig {
  /** URL that receives each batch as a POST with a JSON body. */
  endpoint: string;
  /** Records per batch. Default 20. */
  batchSize?: number;
}

export interface TelemetryRecord {
  name: string;
  data: Record<string, unknown>;
}
```

#### Step 2: Implement the Service

```typescript
// packages/telemetry/src/Telemetry.ts
import type { TelemetryRecord } from "./types";

export class Telemetry {
  readonly batchSize: number;
  private readonly endpoint: string;
  private queue: TelemetryRecord[] = [];

  constructor(endpoint: string, batchSize: number) {
    this.endpoint = endpoint;
    this.batchSize = batchSize;
  }

  /** Queue one record. It is sent with the next batch. */
  track(name: string, data: Record<string, unknown> = {}): void {
    this.queue.push({ name, data });
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Send every queued record. `sendBeacon` returns at once, and returns
   * `false` when the browser refuses the request; the records then stay
   * queued for the next flush.
   */
  flush(): void {
    if (this.queue.length === 0) return;
    if (navigator.sendBeacon(this.endpoint, JSON.stringify(this.queue))) {
      this.queue = [];
    }
  }
}
```

#### Step 3: Implement the Plugin

```typescript
// packages/telemetry/src/TelemetryPlugin.ts
import { EventBusKey, type EngineContext, type Plugin } from "@yagejs/core";
import { Telemetry } from "./Telemetry";
import { TelemetryKey, type TelemetryConfig } from "./types";

export class TelemetryPlugin implements Plugin {
  readonly name = "telemetry";
  readonly version = "1.0.0";
  // No dependencies -- works with @yagejs/core alone

  private readonly endpoint: string;
  private readonly batchSize: number;
  private telemetry: Telemetry | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(config: TelemetryConfig) {
    // Validate at the entry, before anything is installed.
    const batchSize = config.batchSize ?? 20;
    if (config.endpoint === "") {
      throw new Error("TelemetryPlugin: endpoint must not be empty");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error(
        `TelemetryPlugin: batchSize must be an integer of at least 1, got ${batchSize}`,
      );
    }
    this.endpoint = config.endpoint;
    this.batchSize = batchSize;
  }

  install(context: EngineContext): void {
    const telemetry = new Telemetry(this.endpoint, this.batchSize);
    this.telemetry = telemetry;
    context.register(TelemetryKey, telemetry);

    // Record every scene push from the engine's own events.
    this.unsubscribe = context
      .resolve(EventBusKey)
      .on("scene:pushed", ({ scene }) => {
        telemetry.track("scene:pushed", { scene: scene.name });
      });
  }

  onDestroy(): void {
    this.unsubscribe?.();
    this.telemetry?.flush(); // send what is left
    this.telemetry = undefined;
  }
}
```

#### Step 4: Export the Public API

```typescript
// packages/telemetry/src/index.ts
export { TelemetryPlugin } from "./TelemetryPlugin";
export { Telemetry } from "./Telemetry";
export { TelemetryKey } from "./types";
export type { TelemetryConfig, TelemetryRecord } from "./types";
```

#### Step 5: Use It

```typescript
import { Component, Engine } from "@yagejs/core";
import { TelemetryPlugin, TelemetryKey } from "@yagejs/telemetry";
import { GoalReached } from "./events";

const engine = new Engine();
engine.use(new TelemetryPlugin({ endpoint: "https://example.com/telemetry" }));

/** Reports a finished level. */
class LevelReport extends Component {
  private readonly telemetry = this.service(TelemetryKey);

  onAdd() {
    this.listenScene(GoalReached, () => {
      this.telemetry.track("level:complete", { scene: this.scene.name });
    });
  }
}
```

#### Step 6: Add a System (Optional)

If the plugin needs per-frame logic, add a system:

```typescript
// TelemetryFlushSystem.ts
import { System, Phase } from "@yagejs/core";
import type { EngineContext } from "@yagejs/core";
import type { Telemetry } from "./Telemetry";
import { TelemetryKey } from "./types";

export class TelemetryFlushSystem extends System {
  readonly phase = Phase.EndOfFrame;
  readonly priority = 0;

  private telemetry!: Telemetry;

  onRegister(context: EngineContext) {
    this.telemetry = context.resolve(TelemetryKey);
  }

  update() {
    // One request per full batch, after the frame's game code has run.
    if (this.telemetry.pending >= this.telemetry.batchSize) {
      this.telemetry.flush();
    }
  }
}

// In TelemetryPlugin:
registerSystems(scheduler: SystemScheduler) {
  scheduler.add(new TelemetryFlushSystem());
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
- **Remove another plugin's systems**: `SystemScheduler.remove()` accepts any system, but a plugin removes only the systems it added. Nothing enforces that limit. It is part of the plugin contract.
- **Escape the error boundary**: every system `update()` runs through `ErrorBoundary.wrapSystem`, which records the system that threw before the error propagates.

### Failure Model

The engine reports an error and rethrows it. It never suppresses one. If a plugin's system throws:

1. `ErrorBoundary` records the system that threw (readable via `Inspector.getErrors().callbackErrors`) and logs it through `Logger`.
2. The error is rethrown. Nothing is disabled, unsubscribed, or muted. `system.enabled` is a flag the game sets, and `ErrorBoundary` never changes it.
3. If nothing inside the frame catches it, `GameLoop.tick()` stops the loop and rethrows so the error reaches the host (`window.onerror`, an unhandled-rejection handler, or the caller's own `try`/`catch`).

If a plugin's `install()` or `onStart()` throws:

1. `engine.start()` rejects with that error.
2. Plugins installed earlier in the order stay installed, and their services stay registered.
3. Any later `start()` or `use()` on that instance throws. Call `engine.destroy()` to release the plugins that did install, then construct a new `Engine`.

---

## 10. Plugin Configuration Patterns

### Constructor Config

The standard pattern is to pass configuration when creating the plugin:

```typescript
engine.use(
  new RendererPlugin({
    width: 800,
    height: 600,
    virtualWidth: 400,
    virtualHeight: 300,
  }),
);
```

### Runtime Reconfiguration

For settings that can change during gameplay, expose methods on the service:

```typescript
const audio = context.resolve(AudioManagerKey);
audio.setChannelVolume("music", 0.5);
audio.muteAll();
```

### Event-Driven Configuration

For plugins that react to engine events:

```typescript
const events = context.resolve(EventBusKey);
events.on("screen:fullscreen", ({ active }) => {
  if (!active) audio.muteAll();
});
```

`EventBus<EngineEvents>` only accepts the events in `EngineEvents`. Game events are `defineEvent` tokens emitted on entities and scenes, as the `Score` component in section 8 does.

---

## References

- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- How to add/modify plugins as a coding agent

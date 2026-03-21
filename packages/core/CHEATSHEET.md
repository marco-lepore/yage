# @yage/core Cheat Sheet

Quick reference for building plugins and features against the YAGE v2 core kernel.

---

## Architecture Overview

YAGE uses a **hybrid OOP + ECS** model:

- **Components** own game logic. They have `update(dt)` and `fixedUpdate(dt)` methods called automatically by the engine.
- **Systems** power engine plugins (renderer, physics, audio). They run in a specific game loop phase and iterate entities via QueryCache.
- **Entities** are named containers of components with O(1) type-based lookups.
- **Scenes** own entities and define lifecycle hooks. Managed as a stack.
- **EngineContext** is a typed DI container. Services are registered with `ServiceKey<T>` and resolved by plugins and components.

### Frame Execution Order

```
1. EarlyUpdate     — input polling, pre-frame setup
2. FixedUpdate     — physics step, component.fixedUpdate(dt) [deterministic timestep]
3. Update          — component.update(dt), general game logic [variable dt]
4. LateUpdate      — camera follow, post-logic adjustments
5. Render          — display object sync, draw calls
6. EndOfFrame      — deferred entity destruction, cleanup
```

FixedUpdate runs with a fixed timestep (default ~16.67ms) using an accumulator. It may run 0-5 times per frame. All other phases run once per frame with the actual frame delta.

---

## Engine Setup

```typescript
import { Engine } from "@yage/core";

const engine = new Engine({
  debug: true,             // exposes globalThis.__yage__
  fixedTimestep: 1000 / 60, // 60Hz fixed update (default)
  maxFixedStepsPerFrame: 5,  // prevent spiral of death (default)
});

engine.use(myPlugin);       // register plugins before start
await engine.start();       // topo-sort plugins, install, start loop

// later...
engine.destroy();           // stop loop, teardown plugins in reverse order
```

---

## Writing a Plugin

Plugins are the extension point for the engine. They install services, register systems, and hook into the engine lifecycle.

```typescript
import {
  type Plugin,
  type EngineContext,
  ServiceKey,
  SystemScheduler,
} from "@yage/core";

// 1. Define a service key for your plugin's main service
export const MyServiceKey = new ServiceKey<MyService>("myService");

// 2. Implement the Plugin interface
export const MyPlugin: Plugin = {
  name: "my-plugin",
  version: "1.0.0",
  dependencies: [],         // names of plugins that must install first

  install(context: EngineContext) {
    // Create and register services
    const service = new MyService();
    context.register(MyServiceKey, service);
  },

  registerSystems(scheduler: SystemScheduler) {
    // Register systems that run each frame
    scheduler.add(new MyRenderSystem());
  },

  onStart() {
    // Called after all plugins installed and engine started
  },

  onDestroy() {
    // Called on engine.destroy() in reverse topological order
  },
};
```

**Plugin lifecycle order:**
1. `install()` — called in topological dependency order
2. `registerSystems()` — called after all installs complete
3. System `_setContext()` + `onRegister()` — engine wires up all systems
4. Game loop starts
5. `onStart()` — called after loop begins
6. (game runs)
7. `onDestroy()` — called in reverse topological order during `engine.destroy()`

---

## Writing a Component

Components are the primary way to write game logic. They live on entities and have access to the engine context.

```typescript
import { Component, ServiceKey } from "@yage/core";

class Health extends Component {
  current = 100;
  max = 100;

  // Lifecycle hooks (all optional)
  onAdd() {
    // Called when added to an entity. this.entity is available.
  }

  onRemove() {
    // Called when removed from entity or entity is destroyed.
  }

  onDestroy() {
    // Called after onRemove during cleanup.
  }

  // Per-frame update (optional). Called by the built-in ComponentUpdateSystem.
  update(dt: number) {
    // dt is frame delta in ms (variable)
    // Runs during the Update phase
  }

  // Fixed timestep update (optional). Called by the built-in ComponentFixedUpdateSystem.
  fixedUpdate(dt: number) {
    // dt is the fixed timestep in ms (deterministic)
    // Runs during the FixedUpdate phase — use for physics-dependent logic
  }
}
```

### Accessing Services from Components

Use `this.use(key)` for cached service resolution (zero-cost after first call):

```typescript
import { Component, SceneManagerKey, EventBusKey } from "@yage/core";

class Interaction extends Component {
  onAdd() {
    const bus = this.use(EventBusKey);
    bus.on("some:event", (data) => this.handleEvent(data));
  }

  update(dt: number) {
    const scenes = this.use(SceneManagerKey); // cached — no repeated lookup
    const active = scenes.active;
    // ...
  }
}
```

### Accessing Other Components

```typescript
import { Component, Transform } from "@yage/core";

class Movement extends Component {
  update(dt: number) {
    const transform = this.entity.get(Transform);    // throws if missing
    const health = this.entity.tryGet(Health);         // returns undefined if missing
    if (this.entity.has(Shield)) { /* ... */ }
  }
}
```

### Error Handling

If a component's `update()` or `fixedUpdate()` throws, the ErrorBoundary catches it, sets `component.enabled = false`, and logs the error. The game continues running. Disabled components are skipped on subsequent frames.

---

## Writing a System

Systems are for engine-level cross-cutting concerns (rendering, physics, audio sync). Game developers typically write Components instead.

```typescript
import {
  System,
  Phase,
  QueryCacheKey,
  type EngineContext,
  type QueryResult,
} from "@yage/core";
import { Transform } from "@yage/core";

class DisplaySyncSystem extends System {
  readonly phase = Phase.Render;  // which frame phase to run in
  readonly priority = 0;          // lower = earlier within the phase (default: 0)

  private bodies!: QueryResult;

  onRegister(context: EngineContext) {
    // Register queries for efficient entity iteration
    const cache = this.use(QueryCacheKey);
    this.bodies = cache.register([Transform, SpriteComponent]);
  }

  update(dt: number) {
    // Called once per frame (or per fixed step for FixedUpdate systems)
    for (const entity of this.bodies) {
      const transform = entity.get(Transform);
      const sprite = entity.get(SpriteComponent);
      sprite.pixiSprite.position.set(transform.position.x, transform.position.y);
    }
  }

  onUnregister() {
    // Cleanup when system is removed
  }
}
```

**Phase choices:**

| Phase | Use for |
|---|---|
| `EarlyUpdate` | Input polling, pre-frame setup |
| `FixedUpdate` | Physics stepping, deterministic simulation |
| `Update` | General game logic, AI |
| `LateUpdate` | Camera follow, post-logic adjustments |
| `Render` | Display object sync, draw calls |
| `EndOfFrame` | Cleanup, deferred operations |

**Priority within a phase:** Lower number = runs earlier. The built-in `ComponentUpdateSystem` and `ComponentFixedUpdateSystem` use priority `1000`, so plugin systems at priority `0` run first (e.g., physics step before game logic sees results).

---

## Entities

Entities support two usage styles, and you can mix both in the same project:

- **Data containers (ECS-style)**: Use entities as plain ID + component bags. Systems or other actors query and manipulate components directly. Good for bulk processing (physics bodies, particles, tiles).
- **Game object API layer**: Use entity subclasses with methods that internally interact with components, exposing a clean public API. Add `@trait()` for shared behaviors that are discoverable at runtime. Good for gameplay objects with rich interactions (NPCs, items, doors).

```typescript
// Spawn from a scene
const entity = scene.spawn("player");

// Component operations
entity.add(new Transform());
entity.add(new Health());
const t = entity.get(Transform);        // throws if missing
const h = entity.tryGet(Health);         // undefined if missing
entity.has(Transform);                   // boolean
entity.remove(Health);                   // calls onRemove + onDestroy
entity.getAll();                         // iterable of all components

// Tags
entity.tags.add("enemy");
entity.tags.has("enemy");                // true

// Destruction (deferred to end of frame)
scene.destroyEntity(entity);
entity.isDestroyed;                      // true immediately
// Actual cleanup happens during EndOfFrame phase
```

---

## Scenes

```typescript
import { Scene } from "@yage/core";

class GameScene extends Scene {
  readonly name = "game";
  readonly pauseBelow = true;        // pause scenes below this one (default: true)
  readonly transparentBelow = false;  // render scenes below this one (default: false)

  onEnter() { /* pushed onto stack */ }
  onExit() { /* popped or replaced */ }
  onPause() { /* another scene pushed on top */ }
  onResume() { /* scene above was popped */ }
}

// Scene management (stack-based)
engine.scenes.push(new GameScene());   // onEnter called
engine.scenes.push(new PauseMenu());   // GameScene.onPause, PauseMenu.onEnter
engine.scenes.pop();                   // PauseMenu.onExit, GameScene.onResume
engine.scenes.replace(new GameOver()); // GameScene.onExit, GameOver.onEnter
engine.scenes.active;                  // top of stack (or undefined)

// Entity queries within a scene
scene.findEntity("player");            // first entity with name
scene.findEntitiesByTag("enemy");      // all entities with tag
scene.getEntities();                   // ReadonlySet<Entity>
```

---

## Events

```typescript
import { EventBus, type EngineEvents, EventBusKey } from "@yage/core";

// The engine's event bus is available via context
const bus = this.use(EventBusKey);

// Subscribe (returns unsubscribe function)
const unsub = bus.on("entity:created", ({ entity }) => {
  console.log(`Created: ${entity.name}`);
});
unsub(); // unsubscribe

// Subscribe once
bus.once("engine:started", () => { /* ... */ });

// Emit
bus.emit("entity:created", { entity: someEntity });
```

**Built-in engine events:**

| Event | Payload |
|---|---|
| `entity:created` | `{ entity }` |
| `entity:destroyed` | `{ entity }` |
| `component:added` | `{ entity, component }` |
| `component:removed` | `{ entity, componentClass }` |
| `scene:pushed` | `{ scene }` |
| `scene:popped` | `{ scene }` |
| `scene:replaced` | `{ oldScene, newScene }` |
| `engine:started` | `undefined` |
| `engine:stopped` | `undefined` |

### Custom Event Bus

```typescript
interface MyEvents {
  "player:died": { entityId: number };
  "level:complete": { score: number };
}

const gameBus = new EventBus<MyEvents>();
gameBus.on("player:died", ({ entityId }) => { /* ... */ });
gameBus.emit("player:died", { entityId: 42 });
```

---

## QueryCache

Register a query once, get a live result set that updates automatically as components are added/removed.

```typescript
import { QueryCacheKey, Transform } from "@yage/core";

// In a System's onRegister:
const cache = this.use(QueryCacheKey);
const enemies = cache.register([Transform, EnemyTag]);

// In update:
for (const entity of enemies) {
  const t = entity.get(Transform);
  // ...
}

enemies.size;       // current count
enemies.first;      // first match or undefined
enemies.toArray();  // snapshot as array (allocates)
```

---

## Processes, Tweens & Sequences

### ProcessComponent (entity-level timing)

Add a `ProcessComponent` to any entity that needs timers, tweens, or cooldowns. Ticked automatically by `ProcessSystem` each frame (game-time aware — respects pause and timeScale).

```typescript
import { ProcessComponent, Process, Tween } from "@yage/core";

// Add to entity
entity.add(new ProcessComponent());
const pc = entity.get(ProcessComponent);

// --- Slots: reusable, restartable process handles ---
// Slots start in `completed` state. Call start() to activate.
const shootCd = pc.slot({ duration: 300 });
const flash = pc.slot({
  duration: 100,
  cleanup: () => { sprite.tint = 0xffffff; },  // runs on complete, cancel, OR restart
});
const shake = pc.slot({
  duration: 150,
  update: (dt, elapsed) => {
    sprite.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
  },
  cleanup: () => sprite.position.set(0, 0),
});

// Use slots
if (shootCd.completed) { shootCd.start(); /* fire bullet */ }
flash.restart();                           // cleanup + cancel + start
shake.restart({ duration: 200 });          // override config for this run
shootCd.completed;                         // true when not running
shootCd.elapsed;                           // ms since start
shootCd.ratio;                             // 0..1 (elapsed / duration)
shootCd.pause();
shootCd.resume();
shootCd.cancel();                          // calls cleanup if running

// --- One-off processes: fire-and-forget ---
pc.run(Process.delay(500, () => entity.destroy()));
pc.run(Tween.to(sprite, "alpha", 0, 300));
pc.run(myProcess, { tags: ["vfx"] });      // tag for cancel-by-tag

// Cancel
pc.cancel("vfx");                          // cancel slots and one-offs with tag
pc.cancel();                               // cancel everything
```

Slots are created in `onAdd()` (the sibling ProcessComponent must be resolved):

```typescript
class PlayerController extends Component {
  private pc = this.sibling(ProcessComponent);
  private shootCd!: ProcessSlot;

  onAdd(): void {
    this.shootCd = this.pc.slot({ duration: 300 });
  }

  shoot(): void {
    if (!this.shootCd.completed) return;
    this.shootCd.start();
    // spawn bullet...
  }
}
```

### TimerEntity (scene-level timing)

Pre-built entity that exposes the ProcessComponent API directly. Use for scene-level orchestration instead of `setTimeout`.

```typescript
import { TimerEntity, Process } from "@yage/core";

// In a Scene:
const timers = this.spawn(TimerEntity);
timers.run(Process.delay(500, () => { controller.inputEnabled = true; }));
timers.slot({ duration: 1000 });
timers.cancel();
```

### Process (low-level coroutine)

```typescript
import { Process } from "@yage/core";

const proc = new Process({
  duration: 1000,                    // auto-complete after 1s
  loop: false,                       // repeat indefinitely
  update: (dt, elapsed) => {
    // dt = frame delta, elapsed = total time since start
    // return true to complete early
  },
  onComplete: () => { /* done */ },
});

proc.pause();
proc.resume();
proc.cancel();
proc.completed;                      // boolean
await proc.toPromise();              // resolves on completion
```

### Tween (animate values)

```typescript
import { Tween, easeOutQuad, Vec2 } from "@yage/core";

// Tween a numeric property
const proc = Tween.to(sprite, "alpha", 0, 500, easeOutQuad);

// Tween with custom setter
const proc2 = Tween.custom(
  (v) => transform.setPosition(new Vec2(v, 0)),
  0, 100, 300, easeOutQuad,
);

// Tween a Vec2
const proc3 = Tween.vec2(
  (v) => transform.setPosition(v),
  Vec2.ZERO, new Vec2(100, 200),
  500,
);
```

**Built-in easing:** `easeLinear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeOutBounce`

### Sequence (chain actions)

```typescript
import { Sequence, Tween, easeOutQuad } from "@yage/core";

const seq = new Sequence()
  .then(Tween.to(obj, "x", 100, 500))         // move right
  .wait(200)                                    // pause 200ms
  .call(() => console.log("halfway!"))          // instant callback
  .parallel(                                    // run in parallel
    Tween.to(obj, "x", 0, 500),
    Tween.to(obj, "alpha", 0, 500, easeOutQuad),
  )
  .loop()                                       // loop indefinitely
  .start();                                     // returns a Process

// Or repeat a fixed number of times:
new Sequence().call(() => flash()).wait(100).repeat(3).start();
```

---

## Entity Subclasses (recommended)

The preferred way to define entity types. Use `setup()` instead of the constructor — it runs after the entity is wired to its scene, so components can access services.

### With traits (discoverable capabilities)

```typescript
import { Entity, defineTrait, trait, Transform, Vec2 } from "@yage/core";

// Define a trait (reusable across entity types)
const Interactable = defineTrait<{ interact(): void; priority: number }>(
  "Interactable",
);

// @trait() enforces that the class implements all trait members at compile time
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

// Spawn — params are typed from setup()
const light = scene.spawn(LightEntity, { x: 100, y: 200 });

// Runtime trait check (type guard)
if (entity.hasTrait(Interactable)) {
  entity.interact(); // correctly typed
}
```

### Without traits (custom logic, not discoverable)

```typescript
class Wall extends Entity {
  setup({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new ColliderComponent({ shape: { type: "box", width: w, height: h } }));
  }
}

const wall = scene.spawn(Wall, { x: 0, y: 0, w: 100, h: 10 });
```

### Why `setup()` instead of constructor?

When `scene.spawn(Class, params)` runs, it:
1. Creates the entity (`new Class()`)
2. Wires it to the scene (`_setScene`)
3. Emits `entity:created`
4. Calls `setup(params)` — scene is available, so `onAdd` hooks and service resolution work

If you put component setup in the constructor, the entity isn't wired to a scene yet and service resolution will fail.

---

## Blueprints (deprecated)

Blueprints still work but entity subclasses are preferred for new code.

```typescript
import { defineBlueprint, Transform } from "@yage/core";

const SoldierBlueprint = defineBlueprint<{
  hp: number;
  isBoss?: boolean;
}>("soldier", (entity, params) => {
  entity.tags.add("enemy");
  entity.tags.add("npc");
  if (params.isBoss) entity.tags.add("boss");

  entity.add(new Transform());
  entity.add(new Health(params.hp));
  entity.add(new Weapon());
});

const entity = scene.spawn(SoldierBlueprint, {
  hp: 200,
  isBoss: true,
});
```

---

## EngineContext (DI)

```typescript
import { EngineContext, ServiceKey } from "@yage/core";

// Define a typed key
const AudioKey = new ServiceKey<AudioManager>("audio");

// Register (typically in plugin.install)
context.register(AudioKey, new AudioManager());

// Resolve
const audio = context.resolve(AudioKey);      // throws if not registered
const audio2 = context.tryResolve(AudioKey);  // returns undefined if missing
context.has(AudioKey);                        // boolean
```

**Well-known keys:** `EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`

---

## Testing

All test utilities are exported from `@yage/core`. Tests run in Vitest (Node.js, no browser needed).

### Test Utilities

```typescript
import {
  createTestEngine,   // fully wired Engine (async)
  createMockScene,     // lightweight Scene + EngineContext
  createMockEntity,    // entity in a mock scene with full context
  advanceFrames,       // tick the game loop N times
} from "@yage/core";
```

### Unit Testing a Component

Use `createMockEntity` for isolated component tests — no Engine overhead, but full context access:

```typescript
import { describe, it, expect } from "vitest";
import { createMockEntity, Transform, Vec2 } from "@yage/core";

class Gravity extends Component {
  fixedUpdate(dt: number) {
    const t = this.entity.get(Transform);
    t.translate(new Vec2(0, 9.8 * (dt / 1000)));
  }
}

describe("Gravity", () => {
  it("moves entity downward each fixed step", () => {
    const { entity } = createMockEntity("ball");
    entity.add(new Transform());
    const gravity = new Gravity();
    entity.add(gravity);

    // Simulate a fixed step manually
    gravity.fixedUpdate(16);

    const pos = entity.get(Transform).position;
    expect(pos.y).toBeGreaterThan(0);
  });

  it("does nothing when disabled", () => {
    const { entity } = createMockEntity("ball");
    entity.add(new Transform());
    const gravity = new Gravity();
    gravity.enabled = false;
    entity.add(gravity);

    gravity.fixedUpdate(16);

    expect(entity.get(Transform).position.y).toBe(0);
  });
});
```

### Unit Testing a System

Use `createMockScene` + `EngineContext` to wire up a system without a full Engine:

```typescript
import { describe, it, expect } from "vitest";
import {
  createMockScene,
  EngineContext,
  SceneManagerKey,
  ErrorBoundaryKey,
  ErrorBoundary,
  Logger,
  Phase,
  System,
} from "@yage/core";

class CountSystem extends System {
  readonly phase = Phase.Update;
  count = 0;
  update() { this.count++; }
}

describe("CountSystem", () => {
  function setup() {
    const { scene, context } = createMockScene();
    // Systems need SceneManager — mock it
    const sceneManager = { get active() { return scene; } };
    context.register(SceneManagerKey, sceneManager as never);

    const sys = new CountSystem();
    sys._setContext(context);
    sys.onRegister?.(context);
    return { sys, scene, context };
  }

  it("increments count each update", () => {
    const { sys } = setup();
    sys.update(16);
    sys.update(16);
    expect(sys.count).toBe(2);
  });
});
```

### Integration Testing with the Engine

Use `createTestEngine` + `advanceFrames` for full integration tests:

```typescript
import { describe, it, expect } from "vitest";
import {
  createTestEngine,
  advanceFrames,
  Scene,
  Component,
  Transform,
  Vec2,
} from "@yage/core";

class GameScene extends Scene {
  readonly name = "game";
}

class Mover extends Component {
  update(dt: number) {
    this.entity.get(Transform).translate(new Vec2(1, 0));
  }
}

describe("Movement integration", () => {
  it("entity moves over multiple frames", async () => {
    const engine = await createTestEngine();
    const scene = new GameScene();
    engine.scenes.push(scene);

    const entity = scene.spawn("player");
    entity.add(new Transform());
    entity.add(new Mover());

    advanceFrames(engine, 10);

    expect(entity.get(Transform).position.x).toBe(10);
    engine.destroy();
  });
});
```

### Testing Processes, Slots, and Tweens

Processes are updated manually via `_update(dt)` — no game loop needed. ProcessSlot uses `_tick(dt)`:

```typescript
import { describe, it, expect } from "vitest";
import { Process, Tween, Sequence, ProcessSlot, easeLinear } from "@yage/core";

describe("Tween", () => {
  it("tweens a value over duration", () => {
    const obj = { x: 0 };
    const proc = Tween.to(obj, "x", 100, 1000, easeLinear);

    proc._update(500);  // halfway
    expect(obj.x).toBeCloseTo(50);

    proc._update(500);  // done
    expect(obj.x).toBeCloseTo(100);
    expect(proc.completed).toBe(true);
  });
});

describe("ProcessSlot", () => {
  it("acts as a cooldown timer", () => {
    const slot = new ProcessSlot({ duration: 300 });
    expect(slot.completed).toBe(true);   // starts completed (ready)

    slot.start();
    expect(slot.completed).toBe(false);

    slot._tick(300);
    expect(slot.completed).toBe(true);   // cooldown done
  });

  it("calls cleanup on cancel and restart", () => {
    const cleanup = vi.fn();
    const slot = new ProcessSlot({ duration: 100, cleanup });
    slot.start();
    slot.restart();              // cleanup called, then restarted
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe("Sequence", () => {
  it("runs steps in order", () => {
    const order: string[] = [];
    const seq = new Sequence()
      .call(() => order.push("a"))
      .call(() => order.push("b"))
      ._build();                    // use _build() in tests instead of start()

    seq._update(16);  // "a" completes instantly
    seq._update(16);  // "b" completes instantly
    expect(order).toEqual(["a", "b"]);
  });
});
```

### Testing a Plugin

```typescript
import { describe, it, expect } from "vitest";
import { createTestEngine, ServiceKey, type Plugin } from "@yage/core";

class FooService { value = 42; }
const FooKey = new ServiceKey<FooService>("foo");

const FooPlugin: Plugin = {
  name: "foo",
  version: "1.0.0",
  install(context) {
    context.register(FooKey, new FooService());
  },
};

describe("FooPlugin", () => {
  it("registers FooService in context", async () => {
    const engine = await createTestEngine();
    // Note: must register plugin BEFORE start — use Engine directly
    const eng2 = new (await import("@yage/core")).Engine();
    eng2.use(FooPlugin);
    await eng2.start();

    expect(eng2.context.resolve(FooKey).value).toBe(42);
    eng2.destroy();
  });
});
```

### Testing Tips

- Use `createMockEntity` for component unit tests — fast, no Engine overhead
- Use `createTestEngine` + `advanceFrames` for integration tests involving the game loop
- Call `engine.destroy()` at the end of every integration test to clean up
- Process and Tween tests use `_update(dt)` for direct control — no game loop needed
- ProcessSlot tests use `_tick(dt)` for direct control
- Sequences use `_build()` in tests instead of `start()` for direct control
- Entity IDs auto-reset between tests via the test utilities (they call `_resetEntityIdCounter`)
- The ErrorBoundary catches all component/system errors — test that crashing components get `enabled = false`
- Use `vi.fn()` and `vi.spyOn()` from Vitest for mocking callbacks and service methods

---

## Related Docs

- [Recipes Plan](../../docs/v2/RECIPES_PLAN.md) -- Planned reusable gameplay modules and implementation details

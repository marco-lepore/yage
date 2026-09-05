# YAGE Core Concepts

## Architecture

Hybrid OOP+ECS. Components own game logic. Systems handle engine internals. Entities are component containers. Scenes manage entity lifecycles.

```
Engine
  └── SceneManager (stack of Scenes)
        └── Scene (set of Entities)
              └── Entity (map of Components)
```

**Components** define behavior via `update(dt)` and `fixedUpdate(dt)`. The built-in `ComponentUpdateSystem` calls these automatically.

**Systems** are for cross-cutting engine concerns (physics stepping, rendering sync, input polling). Game code rarely needs custom systems.

**Entities** are named containers with O(1) component lookups by class. Can be subclassed with `setup()` for game objects.

**Scenes** own entities and have lifecycle hooks. Stack-based management (push/pop/replace).

## Frame Execution Order

Six phases per frame, with a fixed-timestep accumulator for physics:

```
1. EarlyUpdate    - input polling, pre-frame bookkeeping
2. FixedUpdate    - physics, fixed-rate logic (may run 0..N times)
3. Update         - physics interpolation, then game logic: component.update(dt)
4. LateUpdate     - UI layout
5. Render         - Transform -> display object sync
6. EndOfFrame     - deferred entity destruction flush (onDestroy, detach from scene)
```

Fixed timestep default: `1/60` s. Max steps per frame: 5 (prevents spiral of death).

## Engine Setup

```ts
import { Scene } from "@yagejs/core";
class MyScene extends Scene {
  readonly name = "game";
}

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 800, height: 600 }));
await engine.start();
await engine.scenes.push(new MyScene());
// later:
engine.destroy();
```

`engine.use(plugin)` must be called before `start()`. Plugins are installed in topological dependency order.

An engine instance is single-use. `destroy()` and a rejected `start()` are both terminal: after either, `start()` and `use()` throw. `destroy()` stays available after a rejected `start()` — call it to release whatever did install — and further `destroy()` calls are ignored. Construct a new `Engine` to run again. `destroy()` during an in-flight `start()` cancels the rest of startup, so the loop never starts.

Scene teardown, system unregistration and plugin `onDestroy` are independent stages of `destroy()`: a throw in one still lets the others run, and the first error is rethrown once teardown finishes.

To restart gameplay, keep the engine running and reset the scene stack: `scenes.replace(new GameScene())`, or `scenes.popAll()` followed by `scenes.push()`. Scene changes after `destroy()` are ignored, with a dev-build warning naming the dropped call.

## Plugin Interface

```ts
import type { EngineContext, SystemScheduler } from "@yagejs/core";

interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  install?(context: EngineContext): void | Promise<void>;
  registerSystems?(scheduler: SystemScheduler): void;
  onStart?(): void;
  onDestroy?(): void;
}
```

`install` registers services into `EngineContext`. `registerSystems` adds systems to the scheduler. `onStart` fires after all plugins are installed and the loop is running.

## Component Lifecycle

```ts
import { Component } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { SpriteComponent } from "@yagejs/renderer";

class MyComponent extends Component {
  // Lazy DI resolution (cached after first call)
  private input = this.service(InputManagerKey);

  // Lazy sibling resolution
  private sprite = this.sibling(SpriteComponent);

  onAdd() {} // added to entity
  update(dt: number) {} // every frame (variable dt in seconds)
  fixedUpdate(dt: number) {} // every fixed step (fixed dt in seconds)
  onDestroy() {} // entity destroyed or component removed
}
```

| Method                | When to use                                          | Resolves                           |
| --------------------- | ---------------------------------------------------- | ---------------------------------- |
| `this.service(key)`   | Field declarations (`private x = this.service(K)`)   | Lazy proxy — first property access |
| `this.use(key)`       | Inside `onAdd()` or later                            | Immediately (cached)               |
| `this.sibling(Class)` | Field declarations (`private rb = this.sibling(RB)`) | Lazy proxy — first property access |

`this.listen(entity, token, handler)`, `this.listenScene(token, handler)` and `this.listenBus(event, handler)` auto-unsubscribe on removal. `this.scene` and `this.context` are accessors.

## Entity Operations

```ts yage-context="scene"
import { Entity, Transform, Vec2 } from "@yagejs/core";
class PlayerEntity extends Entity {
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
  }
}
const parent = scene.spawn("parent");
const childEntity = scene.spawn("child");

// Spawn
const e = scene.spawn("name"); // plain entity
const p = scene.spawn(PlayerEntity, { x: 0, y: 0 }); // subclass with setup()

// Components
e.add(new Transform({ position: new Vec2(10, 20) }));
const t = e.get(Transform); // throws if missing
const t2 = e.tryGet(Transform); // undefined if missing
e.has(Transform); // boolean
e.remove(Transform); // remove + call onDestroy
// From inside a component, `this.destroy()` does the same thing without
// having to name its own class — useful under subclassing.

// Tags
const enemy = new Entity("enemy", ["hostile", "npc"]);
enemy.tags.has("hostile");

// Hierarchy
parent.addChild("arm", childEntity);
parent.getChild("arm");
parent.removeChild("arm");

// Per-entity time scale (composes with the scene's effective scale)
e.timeScale = 0.5; // components get dt * sceneEffectiveScale * entity.timeScale
// sceneEffectiveScale = scene.timeScale x active SceneTime requests (see SceneTime).
// Affects component update/fixedUpdate, the entity's ProcessComponent, and its
// particle emitters. NOT physics (shared Rapier world steps under the scene's
// effective scale only).

// Destruction — deactivates immediately (isActive false, onDisable fires,
// leaves every query); onDestroy and detach from the scene wait for the
// EndOfFrame flush.
e.destroy();
```

## Entity Subclasses and setup()

Use `setup()` instead of the constructor -- it runs after the entity is attached to its scene, so services and `onAdd` hooks work.

```ts
import { Entity, Transform, Vec2 } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";

class Player extends Entity {
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new SpriteComponent({ texture: "player.png" }));
  }
}

// scene.spawn(Player, { x: 100, y: 200 });
```

Entity subclasses have no `use()` / `service()` / `context` of their own — only `this.scene`. From an entity method, resolve an engine-scope service through the scene: `this.scene.context.resolve(key)` (throws if missing) or `this.scene.context.tryResolve(key)` (undefined if missing). Per-scene infrastructure (physics world, render tree) and any service-heavy logic belong in a `Component`, where `this.use(key)` resolves the correct scope automatically.

## Traits

Compile-time enforced, runtime-queryable capabilities on entity subclasses.

```ts yage-context="entity"
import { defineTrait, trait, Entity } from "@yagejs/core";

const Interactable = defineTrait<{ interact(): void }>("Interactable");

@trait(Interactable)
class Door extends Entity {
  interact() {
    /* open door */
  }
  setup() {
    /* ... */
  }
}

// Type-guarded query:
if (entity.hasTrait(Interactable)) {
  entity.interact(); // typed
}
```

## Scenes

Stack-based via `SceneManager`:

```ts yage-context="engine"
import { Scene } from "@yagejs/core";
class GameScene extends Scene {
  readonly name = "game";
}
class MenuScene extends Scene {
  readonly name = "menu";
}

await engine.scenes.push(new GameScene()); // enters scene
await engine.scenes.pop(); // exits top scene
await engine.scenes.replace(new MenuScene()); // swap top
await engine.scenes.popAll(); // exits all (queued)
```

All four are async and queued — they await `beforeEnter` hooks,
`scene.preload`, and any in-flight transition before applying.

Scene hooks: `onEnter`, `onExit`, `onPause` (scene became effectively paused — covered by a pushed `pauseBelow` scene, manual `paused = true`, or blur auto-pause), `onResume` (scene became effectively unpaused).

Properties: `pauseBelow` (default true), `transparentBelow` (default false), `paused` (setting it fires `onPause`/`onResume` when `isPaused` flips), `timeScale`.

`transparentBelow` controls whether scenes below this one render. `false` (default) hides below-stack scene trees — world AND screen-space (UI/HUD). `true` keeps them visible (pause menus, dialog overlays). The flag composes: a below scene stays visible only while every scene above it is `transparentBelow: true`. During a `SceneManager` transition both outgoing and incoming scenes render regardless (so e.g. `crossFade` works); the chain is reapplied when the transition ends. Detached trees mounted via `_mountDetached` (e.g. the debug overlay) are NOT affected — their visibility is owned by whoever mounted them.

Asset preloading: declare `readonly preload` array of `AssetHandle` -- loaded before `onEnter()`.

Entity queries: `scene.findEntity(name)`, `scene.findEntitiesByTag(tag)`, `scene.findEntities(filter)`.

## Events

### Entity events (defineEvent / entity.on / entity.emit)

```ts yage-context="entity"
import { defineEvent } from "@yagejs/core";

const HitEvent = defineEvent<{ damage: number }>("hit");

entity.on(HitEvent, ({ damage }) => {
  /* ... */
});
entity.emit(HitEvent, { damage: 10 });
```

Entity events bubble to the scene:

```ts yage-context="scene"
import { defineEvent } from "@yagejs/core";
const HitEvent = defineEvent<{ damage: number }>("hit");

scene.on(HitEvent, (data, emittingEntity) => {
  /* ... */
});
```

### Engine EventBus (global)

```ts yage-context="context"
import { EventBusKey } from "@yagejs/core";

const bus = context.resolve(EventBusKey);
const unsub = bus.on("entity:created", ({ entity }) => {
  /* ... */
});
bus.once("engine:started", () => {
  /* ... */
});
```

Built-in events: `entity:created`, `entity:destroyed`, `component:added`, `component:removed`, `scene:pushed`, `scene:popped`, `scene:replaced`, `scene:transition:started`, `scene:transition:ended`, `scene:loading:progress`, `scene:loading:done`, `engine:started`, `engine:stopped`, `screen:fullscreen`, `screen:orientation`. Payloads: the `EngineEvents` table in `packages/core.md`. From a component, `this.listenBus(event, handler)` subscribes with auto-cleanup.

## Dependency Injection

`EngineContext` is a typed DI container using `ServiceKey<T>`.

```ts yage-context="context"
import { ServiceKey } from "@yagejs/core";
class MyService {
  now() {
    return performance.now();
  }
}

const MyServiceKey = new ServiceKey<MyService>("myService");
context.register(MyServiceKey, new MyService());
const svc = context.resolve(MyServiceKey); // throws if missing
const svc2 = context.tryResolve(MyServiceKey); // undefined if missing
```

Well-known keys: `EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`, `ProcessSystemKey`, `AssetManagerKey`, `SceneTimeKey` (per-scene, registered by the engine itself).

Plugin keys: `RendererKey`, `RendererAdapterKey` (cross-package pointer-input contract defined in core; registered by `RendererPlugin` or a foreign renderer, consumed by `InputPlugin`), `SceneRenderTreeKey`, `InputManagerKey`, `PhysicsWorldKey`, `PhysicsWorldManagerKey`, `AudioManagerKey`, `SaveServiceKey`.

Some keys (`PhysicsWorldKey`, `SceneRenderTreeKey`, `SceneTimeKey`) are per-scene —
`this.use(key)` resolves the correct scene's instance automatically. This
works from both `Component` code and from a `Scene` subclass: `Scene.use(key)`
/ `Scene.service(key)` are scope-aware, so `this.use(SceneRenderTreeKey)`
resolves from `onEnter` onward (scene-scoped values are registered by plugin
`beforeEnter` hooks, which run before `onEnter`). Don't use the
provider key (`SceneRenderTreeProviderKey`) from game code — that's tooling-only
(inspector and debug) for enumerating trees across scenes.

### Scene render layers

Scenes declare layers via `readonly layers`. The renderer materializes them
when the scene is pushed. Components specify `{ layer: "world" }` to attach
to a specific layer.

```ts
import { Scene } from "@yagejs/core";

import type { LayerDef } from "@yagejs/renderer";

class GameScene extends Scene {
  readonly name = "game";
  readonly layers: readonly LayerDef[] = [
    { name: "bg", order: -10 },
    { name: "world", order: 0 },
    { name: "hud", order: 100, space: "screen" },
  ];
}
```

Note: `push`/`replace` are async — `await` them to ensure `onEnter` has fired.

## Processes

Ongoing actions updated each frame, managed by `ProcessComponent`.

```ts yage-context="entity"
import { ProcessComponent, Process, Tween, easeOutQuad } from "@yagejs/core";
const obj = { x: 0 };
const fire = () => console.log("Fire");

// Add ProcessComponent to entity
const pc = entity.add(new ProcessComponent());

// One-off process (durations in seconds)
pc.run(Process.delay(0.5, () => console.log("done")));
pc.run(Tween.to(obj, "x", 100, 0.3, easeOutQuad));

// Reusable slot (cooldowns, effects)
const cd = pc.slot({ duration: 1, onComplete: () => fire() });
cd.start(); // activate
cd.running; // boolean
cd.ratio; // 0..1 progress
cd.restart(); // cancel + restart
cd.cancel();
```

### Tween

```ts
import { Tween, Vec2, easeOutQuad } from "@yagejs/core";
const target = { property: 0 };
const toValue = 100,
  durationSeconds = 0.3;
const easing = easeOutQuad;
const setter = (value: number) => {
  target.property = value;
};
const from = 0,
  to = 1;
let position = new Vec2(0, 0);
const setPosition = (value: Vec2) => {
  position = value;
};
const fromVec = new Vec2(0, 0),
  toVec = new Vec2(100, 0);

Tween.to(target, "property", toValue, durationSeconds, easing);
Tween.custom(setter, from, to, durationSeconds, easing);
Tween.vec2(setPosition, fromVec, toVec, durationSeconds, easing);
```

### Sequence

```ts yage-context="entity"
import { Sequence, Tween, ProcessComponent } from "@yagejs/core";
const obj = { alpha: 1, x: 0, y: 0 };
const tweenA = Tween.to(obj, "x", 100, 0.3);
const tweenB = Tween.to(obj, "y", 100, 0.3);
const pc = entity.get(ProcessComponent);

const seq = new Sequence()
  .then(Tween.to(obj, "alpha", 0, 0.3))
  .wait(0.2)
  .call(() => console.log("fade done"))
  .parallel(tweenA, tweenB)
  .loop();

pc.run(seq.start());
```

### TimerEntity

Pre-built entity with `ProcessComponent` API. No manual component setup:

```ts yage-context="scene"
import { TimerEntity, Process } from "@yagejs/core";

const timers = scene.spawn(TimerEntity);
timers.run(
  Process.delay(0.5, () => {
    /* ... */
  }),
);
const cd = timers.slot({ duration: 0.3 });
timers.removeSlot(cd); // cancel and unregister a slot that will not be reused
```

## Save state

`@yagejs/save` consumes explicit `Serializable<TEncoded>` state roots. Core
state factories implement that interface. Live scenes, entities, components,
processes, and services are not traversed automatically. Save stable game facts
and reconstruct runtime objects through normal scene and entity setup after
load.

## Error Boundary

`ErrorBoundary` wraps every system, component, and developer-callback call —
a collision handler, an event listener, a component's own `update()`, a scene
lifecycle hook. A throw is attributed to the culprit, logged through
`Logger`, recorded (readable via `engine.inspector.getErrors().callbackErrors`),
and rethrown. Nothing is disabled, unsubscribed, or muted.

`GameLoop.tick()` is the one place that decides a failure is terminal: an
error that escapes an entire frame unhandled stops the loop and rethrows, so
it reaches your own `try`/`catch`, `window.onerror`, or an
unhandled-rejection handler. An error your own code catches inside the frame
leaves the loop running.

Scene lifecycle hooks (`onEnter`, `onExit`, `onPause`, `onResume`, a plugin's
`beforeEnter`) are reported the same way, and a synchronous throw is
rethrown — a scene half-built by a throwing hook must not look like it
mounted cleanly. A rejected async hook is reported only, not rethrown, since
the call has already returned by the time the rejection settles.

```ts yage-context="engine"
// Every recorded failure:
const { callbackErrors } = engine.inspector.getErrors();
// [{ kind: "Collision handler", entity: "DoorPad", error: "..." }]
```

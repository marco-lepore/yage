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

**Entities** are named containers with O(1) component lookups by class. An entity type is an `Entity` subclass whose `setup(params)` adds its components; spawn it with `scene.spawn(Class, params)`.

**Scenes** own entities and have lifecycle hooks. Stack-based management (push/pop/replace). Every scene is a `Scene` subclass; its `onEnter` assembles the scene (spawns, camera, music) and holds no state or rules.

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
import { Engine, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";

class MyScene extends Scene {
  readonly name = "my-scene";
}

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
import type {
  EngineContext,
  Plugin as BasePlugin,
  SystemScheduler,
} from "@yagejs/core";

interface Plugin extends BasePlugin {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  install?(context: EngineContext): void | Promise<void>;
  registerSystems?(scheduler: SystemScheduler): void;
  onStart?(): void | Promise<void>;
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

// Spawn
const p = scene.spawn(PlayerEntity, { x: 0, y: 0 }); // entity type: subclass with setup()
const e = scene.spawn("background"); // one-off entity: spawned once, no behaviour of its own

// Components
e.add(new Transform({ position: new Vec2(10, 20) }));
const t = e.get(Transform); // throws if missing
const t2 = e.tryGet(Transform); // undefined if missing
e.has(Transform); // boolean
e.remove(Transform); // remove + call onDestroy
// From inside a component, `this.destroy()` does the same thing without
// having to name its own class — useful under subclassing.

// Tags
e.tags.add("hostile");
e.tags.has("hostile");

// Hierarchy
const parent = scene.spawn("parent");
const childEntity = scene.spawn("arm");
parent.addChild("arm", childEntity);
parent.getChild("arm"); // throws when there is no child by that name
parent.tryGetChild("arm"); // undefined when there is no child by that name
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

Entity subclasses have no `use()` / `service()` / `context` of their own — only `this.scene`. From an entity method, `this.scene.use(key)` resolves any service: it checks scene scope first (physics world, render tree, scene RNG), then engine scope, and throws when the key resolves nowhere. Use `this.scene.context.tryResolve(key)` when `undefined` is the wanted answer for a missing engine-scope key. `Component.use(key)` caches its result and `Scene.use(key)` does not, so a lookup that runs every frame belongs in a component.

## Traits

Compile-time enforced, runtime-queryable capabilities on entity subclasses.

```ts yage-context="entity"
import { Entity, defineTrait, trait } from "@yagejs/core";

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

Scene hooks, every one `Scene` declares: `onProgress(ratio)` (asset preload progress, 0→1), `onEnter`, `onExit`, `onPause` (scene became effectively paused — covered by a pushed `pauseBelow` scene, manual `paused = true`, or blur auto-pause), `onResume` (scene became effectively unpaused). `LoadingScene` adds one more, `onLoadError(error)`, for a preload that fails.

A scene has no per-frame hook. `update` and `fixedUpdate` are typed as `never` on `Scene`, so a subclass that declares either one fails to compile. Put per-frame scene logic in a component on an entity the scene spawns, or in a process on a queue from `makeSceneScopedQueue()`. The same rule holds for an `Entity` subclass: components tick, entities do not.

Properties: `pauseBelow` (default true), `transparentBelow` (default false), `paused` (setting it fires `onPause`/`onResume` when `isPaused` flips), `timeScale`.

`transparentBelow` controls whether scenes below this one render. `false` (default) hides below-stack scene trees — world AND screen-space (UI/HUD). `true` keeps them visible (pause menus, dialog overlays). The flag composes: a below scene stays visible only while every scene above it is `transparentBelow: true`. During a `SceneManager` transition both outgoing and incoming scenes render regardless (so e.g. `crossFade` works); the chain is reapplied when the transition ends. The debug overlay is not on the scene stack, so it stays visible.

Asset preloading: declare `readonly preload` array of `AssetHandle` -- loaded before `onEnter()`.

Entity queries: `scene.findEntity(name)`, `scene.findEntitiesByTag(tag)`, `scene.findEntities(filter)`. `scene.findEntities({ trait: token })` returns `(Entity & T)[]` for a `TraitToken<T>`; every other filter returns `Entity[]`.

## Events

### Entity events (defineEvent / entity.on / entity.emit)

```ts yage-group="events" yage-context="scene,entity"
import { defineEvent } from "@yagejs/core";

const HitEvent = defineEvent<{ damage: number }>("hit");

entity.on(HitEvent, ({ damage }) => {
  /* ... */
});
entity.emit(HitEvent, { damage: 10 });
```

Entity events bubble to the scene:

```ts yage-group="events" yage-context="scene,entity"
scene.on(HitEvent, (data, emittingEntity) => {
  /* ... */
});
```

Game code subscribes from a component: `this.listen(entity, HitEvent, fn)` or `this.listenScene(HitEvent, fn)`. Both unsubscribe when the component is removed. The engine `EventBus` below is for engine events, not game events.

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

## Game State

Score, lives, a quest log, a run timer: state that game rules change lives in a component on a host entity. Spawn the host with a `key` and reach it with `scene.findByKey`, a query, or the reference `spawn()` returned. The host dies with its scene, so the state starts fresh each time the scene is entered.

```ts yage-context="scene"
import { Component, Entity, Scene, defineEvent } from "@yagejs/core";

const CoinCollected = defineEvent("coin:collected");
const HUD_KEY = "hud";

class RunProgress extends Component {
  coins = 0;

  onAdd() {
    // Coins emit on themselves; the event bubbles to the scene.
    this.listenScene(CoinCollected, () => {
      this.coins += 1;
    });
  }
}

class HudEntity extends Entity {
  progress!: RunProgress;

  setup() {
    this.progress = this.add(new RunProgress());
  }
}

class GameScene extends Scene {
  readonly name = "game";

  onEnter() {
    this.spawn(HudEntity, { key: HUD_KEY });
  }
}

// Anywhere with a scene reference:
const coins = scene.findByKey<HudEntity>(HUD_KEY)?.progress.coins;
```

- Not a module-level `let`, not a field on the `Scene`, not a `ServiceKey`.
- Module-level `createStore` / `createRecord` is only for state that `@yagejs/save` persists (`packages/save.md`).
- Full recipe: `patterns.md` → "Game state on a host entity".

## Dependency Injection

`EngineContext` is a typed DI container using `ServiceKey<T>`. A `ServiceKey` is for plugin-owned infrastructure (renderer, physics world, input manager); game state goes on a host entity (Game State above).

```ts yage-context="context"
import { ServiceKey } from "@yagejs/core";

class MyService {}

const MyServiceKey = new ServiceKey<MyService>("myService");
context.register(MyServiceKey, new MyService());
const svc = context.resolve(MyServiceKey); // throws if missing
const svc2 = context.tryResolve(MyServiceKey); // undefined if missing
```

Well-known keys: `EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`, `ProcessSystemKey`, `AssetManagerKey`, `SceneTimeKey` (per-scene, registered by the engine itself).

Plugin keys: `RendererKey`, `RendererAdapterKey` (cross-package pointer-input contract defined in core; registered by `RendererPlugin` or a foreign renderer, consumed by `InputPlugin`), `SceneRenderTreeKey`, `InputManagerKey`, `PhysicsWorldKey`, `PhysicsWorldManagerKey`, `AudioManagerKey`, `SaveServiceKey`.

Some keys (`PhysicsWorldKey`, `SceneRenderTreeKey`, `SceneTimeKey`) are per-scene —
`this.use(key)` resolves the correct scene's instance automatically. This
works from `Component` code and from anything holding the scene: `Scene.use(key)`
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

Ongoing actions updated each frame, managed by `ProcessComponent`. Timers in game code are processes, slots, or a `TimerEntity`. `setTimeout` / `setInterval` keep running while the game is paused and ignore time scale.

```ts yage-group="processes" yage-context="entity"
import { Process, ProcessComponent, Tween, easeOutQuad } from "@yagejs/core";

const obj = { x: 0, alpha: 1 };
function fire() {
  /* spawn a bullet */
}

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
// A slot with loop: true never completes, so onComplete never runs.
// For a repeating callback, loop a sequence (see Sequence below).
cd.restart(); // cancel + restart
cd.cancel();
```

### Tween

```ts
import { Tween as BaseTween } from "@yagejs/core";
import type { EasingFunction, Process, Vec2, Vec2Like } from "@yagejs/core";

// Tween is a plain object; these are its factories.
type TweenObject = typeof BaseTween;
interface Tween extends TweenObject {
  to(
    target: Record<string, number>,
    property: string,
    toValue: number,
    durationSeconds: number,
    easing?: EasingFunction,
  ): Process;
  custom(
    setter: (value: number) => void,
    from: number,
    to: number,
    durationSeconds: number,
    easing?: EasingFunction,
  ): Process;
  vec2(
    setter: (value: Vec2) => void,
    fromVec: Vec2Like,
    toVec: Vec2Like,
    durationSeconds: number,
    easing?: EasingFunction,
  ): Process;
}
```

### Sequence

```ts yage-group="processes" yage-context="entity"
import { Sequence } from "@yagejs/core";

const tweenA = Tween.to(obj, "x", 200, 0.3);
const tweenB = Tween.to(obj, "alpha", 1, 0.3);

const seq = new Sequence()
  .then(Tween.to(obj, "alpha", 0, 0.3))
  .wait(0.2)
  .call(() => console.log("fade done"))
  .parallel(tweenA, tweenB)
  .loop();

pc.run(seq.build());
```

### TimerEntity

Pre-built entity with `ProcessComponent` API. No manual component setup:

```ts yage-context="scene"
import { Process, TimerEntity } from "@yagejs/core";

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

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
3. Update         - main game logic, component.update(dt)
4. LateUpdate     - camera follow, physics interpolation
5. Render         - Transform -> display object sync
6. EndOfFrame     - deferred entity destruction flush
```

Fixed timestep default: `1000/60` ms. Max steps per frame: 5 (prevents spiral of death).

## Engine Setup

```ts
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";

const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 800, height: 600 }));
await engine.start();
engine.scenes.push(new MyScene());
// later:
engine.destroy();
```

`engine.use(plugin)` must be called before `start()`. Plugins are installed in topological dependency order.

## Plugin Interface

```ts
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
class MyComponent extends Component {
  // Lazy DI resolution (cached after first call)
  private camera = this.service(CameraKey);

  // Lazy sibling resolution
  private sprite = this.sibling(SpriteComponent);

  onAdd() {}          // added to entity
  update(dt) {}       // every frame (variable dt in ms)
  fixedUpdate(dt) {}  // every fixed step (fixed dt in ms)
  onRemove() {}       // removed from entity
  onDestroy() {}      // entity destroyed or component removed
}
```

| Method | When to use | Resolves |
|---|---|---|
| `this.service(key)` | Field declarations (`private x = this.service(K)`) | Lazy proxy — first property access |
| `this.use(key)` | Inside `onAdd()` or later | Immediately (cached) |
| `this.sibling(Class)` | Field declarations (`private rb = this.sibling(RB)`) | Lazy proxy — first property access |

`this.listen(entity, token, handler)` auto-unsubscribes on removal. `this.scene` and `this.context` are accessors.

## Entity Operations

```ts
// Spawn
const e = scene.spawn("name");                    // plain entity
const p = scene.spawn(PlayerEntity, { x: 0, y: 0 }); // subclass with setup()

// Components
e.add(new Transform({ position: new Vec2(10, 20) }));
const t = e.get(Transform);       // throws if missing
const t2 = e.tryGet(Transform);   // undefined if missing
e.has(Transform);                  // boolean
e.remove(Transform);               // remove + call onRemove/onDestroy

// Tags
const e = new Entity("enemy", ["hostile", "npc"]);
e.tags.has("hostile");

// Hierarchy
parent.addChild("arm", childEntity);
parent.getChild("arm");
parent.removeChild("arm");

// Destruction (deferred to EndOfFrame)
e.destroy();
```

## Entity Subclasses and setup()

Use `setup()` instead of the constructor -- it runs after the entity is wired to its scene, so services and `onAdd` hooks work.

```ts
class Player extends Entity {
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new SpriteComponent({ texture: "player.png" }));
  }
}

// scene.spawn(Player, { x: 100, y: 200 });
```

## Traits

Compile-time enforced, runtime-queryable capabilities on entity subclasses.

```ts
const Interactable = defineTrait<{ interact(): void }>("Interactable");

@trait(Interactable)
class Door extends Entity {
  interact() { /* open door */ }
  setup() { /* ... */ }
}

// Type-guarded query:
if (entity.hasTrait(Interactable)) {
  entity.interact(); // typed
}
```

## Scenes

Stack-based via `SceneManager`:

```ts
engine.scenes.push(new GameScene());   // enters scene
engine.scenes.pop();                    // exits top scene
engine.scenes.replace(new MenuScene()); // swap top
engine.scenes.clear();                  // exit all
```

Scene hooks: `onEnter`, `onExit`, `onPause` (scene pushed on top), `onResume` (scene above popped).

Properties: `pauseBelow` (default true), `transparentBelow` (default false), `paused`, `timeScale`.

Asset preloading: declare `readonly preload` array of `AssetHandle` -- loaded before `onEnter()`.

Entity queries: `scene.findEntity(name)`, `scene.findEntitiesByTag(tag)`, `scene.findEntities(filter)`.

## Events

### Entity events (defineEvent / entity.on / entity.emit)

```ts
const HitEvent = defineEvent<{ damage: number }>("hit");

entity.on(HitEvent, ({ damage }) => { /* ... */ });
entity.emit(HitEvent, { damage: 10 });
```

Entity events bubble to the scene:

```ts
scene.on(HitEvent, (data, emittingEntity) => { /* ... */ });
```

### Engine EventBus (global)

```ts
const bus = context.resolve(EventBusKey);
const unsub = bus.on("entity:created", ({ entity }) => { /* ... */ });
bus.once("engine:started", () => { /* ... */ });
```

Built-in events: `entity:created`, `entity:destroyed`, `component:added`, `component:removed`, `scene:pushed`, `scene:popped`, `scene:replaced`, `engine:started`, `engine:stopped`.

## Dependency Injection

`EngineContext` is a typed DI container using `ServiceKey<T>`.

```ts
const MyServiceKey = new ServiceKey<MyService>("myService");
context.register(MyServiceKey, new MyService());
const svc = context.resolve(MyServiceKey); // throws if missing
const svc2 = context.tryResolve(MyServiceKey); // undefined if missing
```

Well-known keys: `EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`, `ProcessSystemKey`, `AssetManagerKey`.

Plugin keys: `CameraKey`, `SceneRenderTreeKey` (scene-scoped), `SceneRenderTreeProviderKey`, `InputManagerKey`, `PhysicsWorldKey` (scene-scoped), `PhysicsWorldManagerKey`, `AudioManagerKey`, `SaveServiceKey`.

Keys declared with `{ scope: "scene" }` are registered by a plugin's
`beforeEnter` scene hook (see `engine.registerSceneHooks(...)`) and resolved
by `Component.use()` before falling through to engine scope.

## Processes

Ongoing actions updated each frame, managed by `ProcessComponent`.

```ts
// Add ProcessComponent to entity
const pc = entity.add(new ProcessComponent());

// One-off process
pc.run(Process.delay(500, () => console.log("done")));
pc.run(Tween.to(obj, "x", 100, 300, easeOutQuad));

// Reusable slot (cooldowns, effects)
const cd = pc.slot({ duration: 1000, onComplete: () => fire() });
cd.start();          // activate
cd.running;          // boolean
cd.ratio;            // 0..1 progress
cd.restart();        // cancel + restart
cd.cancel();
```

### Tween

```ts
Tween.to(target, "property", toValue, durationMs, easing);
Tween.custom(setter, from, to, durationMs, easing);
Tween.vec2(setter, fromVec, toVec, durationMs, easing);
```

### Sequence

```ts
const seq = new Sequence()
  .then(Tween.to(obj, "alpha", 0, 300))
  .wait(200)
  .call(() => console.log("fade done"))
  .parallel(tweenA, tweenB)
  .loop();

pc.run(seq.start());
```

### TimerEntity

Pre-built entity with `ProcessComponent` API. No manual component wiring:

```ts
const timers = scene.spawn(TimerEntity);
timers.run(Process.delay(500, () => { /* ... */ }));
const cd = timers.slot({ duration: 300 });
```

## Serialization

Decorate with `@serializable`. Implement `serialize()` and `static fromSnapshot()`.

```ts
@serializable
class HealthComponent extends Component {
  health = 100;
  serialize() { return { health: this.health }; }
  static fromSnapshot(data: { health: number }) {
    const c = new HealthComponent();
    c.health = data.health;
    return c;
  }
}
```

Entities: `@serializable` + optional `serialize()` / `afterRestore(data, resolve)`. Components with `fromSnapshot()` are saved automatically.

## Error Boundary

Component/system errors are caught by `ErrorBoundary`. The offending component is disabled (`enabled = false`), logged, and the game continues. The game loop never crashes.

```ts
// Check disabled items:
const { systems, components } = context.resolve(ErrorBoundaryKey).getDisabled();
```

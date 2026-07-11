# @yagejs/core

Zero runtime dependencies. ECS foundation, DI, game loop, scenes, events, processes.

## Key Exports

### Architecture

| Export | Purpose |
|---|---|
| `Engine` | Entry point; plugin orchestration, game loop, scene manager |
| `EngineContext` | DI container |
| `ServiceKey<T>` | Typed DI key |
| `Scene` | Abstract scene base class |
| `SceneManager` | Stack-based scene management (push/pop/replace) |
| `Entity` | Named component container |
| `Component` | Base class for game logic |
| `System` | Base class for engine-level systems |
| `Phase` | Enum: EarlyUpdate, FixedUpdate, Update, LateUpdate, Render, EndOfFrame |

### Entity

```ts
class Entity {
  readonly name: string;
  readonly key?: string;                      // stable identity (opt-in)
  get scene(): Scene;                         // throws if detached
  get tryScene(): Scene | null;               // null if detached
  requireKey(): string;                       // throws if no key
  addChild(name: string, child: Entity): void;
  spawnChild(name: string, options?: SpawnOptions): Entity;
  // Trailing args derived from the entity's setup() signature.
  spawnChild<E extends Entity>(
    name: string,
    Class: new () => E,
    ...rest: ClassSpawnArgs<E>
  ): E;
  spawnChild<P>(
    name: string,
    blueprint: Blueprint<P>,
    params: P,
    options?: SpawnOptions,
  ): Entity;
}
```

- `entity.scene` throws with a clear error when the entity is detached (not yet spawned, or already removed). Prefer it in user code — failing loud beats a silent `null` propagation. Use `entity.tryScene` only in defensive paths (e.g. systems iterating query results during teardown) where detachment is expected.
- `entity.spawnChild(name, Class, params?)` combines `scene.spawn(...)` + `this.addChild(name, ...)`. Child is auto-added to the parent's scene. Use for sub-entities owned by a parent (enemy body + health bar, player + weapon, etc.).

### Events

| Export | Purpose |
|---|---|
| `EventBus<E>` | Typed pub/sub (`on`, `once`, `emit`, `clear`) |
| `EventToken<T>` | Typed token for entity events |
| `defineEvent<T>(name)` | Create an event token |

`EngineEvents` (the typed map used by `EventBusKey`):

| Event | Payload |
|---|---|
| `entity:created` / `entity:destroyed` | `{ entity }` |
| `component:added` | `{ entity; component }` |
| `component:removed` | `{ entity; componentClass }` |
| `scene:pushed` / `scene:popped` | `{ scene }` |
| `scene:replaced` | `{ oldScene; newScene }` |
| `scene:transition:started` / `scene:transition:ended` | `{ kind; fromScene; toScene }` |
| `scene:loading:progress` | `{ scene; ratio }` |
| `scene:loading:done` | `{ scene }` |
| `engine:started` / `engine:stopped` | `undefined` |
| `screen:fullscreen` | `{ active: boolean }` — emitted by `RendererPlugin` on `fullscreenchange` / `webkitfullscreenchange` |
| `screen:orientation` | `{ type: OrientationType }` — emitted by `RendererPlugin` on `screen.orientation.change` (or `orientationchange` fallback) |

### Scene Events

`Scene.on(token, handler)` subscribes to a typed event at the scene level. Handlers fire for **both** scene-emitted events (`scene.emit(token, data)`) and entity events that bubble up (`entity.emit(token, data)`). The handler signature distinguishes the two via an optional second arg:

```ts
import { defineEvent, type Entity } from "@yagejs/core";

const DamagedEvent = defineEvent<{ amount: number }>("damaged");

// Inside a scene:
scene.on(DamagedEvent, (data: { amount: number }, entity?: Entity) => {
  if (entity) {
    // bubbled — `entity` is the source that called entity.emit(DamagedEvent, ...)
    console.log(`${entity.name} took ${data.amount}`);
  } else {
    // scene-emitted via scene.emit(DamagedEvent, ...)
    console.log(`scene-wide damage event: ${data.amount}`);
  }
});

scene.emit(DamagedEvent, { amount: 5 });          // handler runs with entity = undefined
someEntity.emit(DamagedEvent, { amount: 10 });    // handler runs with entity = someEntity
```

`Scene.on` returns an unsubscribe function. The handler param is `(data, entity?)` regardless of which side emitted — game code should check `entity` to decide whether to read source state.

`Scene.registerScoped<T>(key: ServiceKey<T>, value: T)` (public) attaches a scene-scoped service resolvable via `Component.use(key)` — and via `Scene.use(key)` / `Scene.service(key)` from the scene itself, which are scope-aware (scene scope first, then engine). Plugins call it from `beforeEnter`; game code can call it from `onEnter` for scene-local state. Every key registered this way is auto-unregistered on scene exit (after `onExit` and plugin `afterExit` hooks), so scenes don't leak services into one another. `_registerScoped` is a kept internal alias — prefer `registerScoped` in new code.

### Math

| Export | Purpose |
|---|---|
| `Vec2` | Immutable 2D vector (`add`, `sub`, `scale`, `normalize`, `lerp`, `dot`, `distance`, static `moveTowards`) |
| `Transform` | Mutable position/rotation/scale component (`setPosition`, `translate`, `rotate`); `worldPosition` / `worldRotation` / `worldScale` are lazily computed and cache-invalidate on local mutation or reparenting |
| `MathUtils` | `lerp`, `inverseLerp`, `lerpAngle`, `shortestAngleBetween`, `pingPong`, `smoothDamp`, `clamp`, etc. |
| `SmoothDampResult` | `{ value, velocity }` returned by `MathUtils.smoothDamp()` |

Math signatures:

```ts
MathUtils.lerp(a: number, b: number, t: number): number
MathUtils.inverseLerp(a: number, b: number, v: number): number // clamped 0..1
MathUtils.lerpAngle(a: number, b: number, t: number): number // radians, shortest path around +/-PI
MathUtils.shortestAngleBetween(a: number, b: number): number // signed delta in [-PI, PI]
MathUtils.pingPong(t: number, length: number): number // bounces in [0, length]
MathUtils.smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  deltaTime: number,
  maxSpeed?: number,
): SmoothDampResult

Vec2.lerp(a: Vec2Like, b: Vec2Like, t: number): Vec2
Vec2.moveTowards(current: Vec2Like, target: Vec2Like, maxDelta: number): Vec2
```

For `smoothDamp`, pass the returned `velocity` into the next frame. `smoothTime`
and `deltaTime` must use the same unit — pass the `dt` (seconds) the engine
gives you and express `smoothTime` in seconds; `maxSpeed` is in units per second.

### Scale inheritance

`Transform.worldScale` composes through the parent chain (`parent.worldScale * local.scale`), the same way `worldPosition` and `worldRotation` do. `DisplaySystem` reads `worldScale` each Render phase, so flipping a parent flips every descendant sprite for free — useful for multi-layer characters (head + body + outfit) where every layer must mirror in lockstep.

```ts
import { Entity, Transform } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";

class Character extends Entity {
  setup() {
    this.add(new Transform());                      // parent — drives facing
    const body = this.spawnChild("body");
    body.add(new Transform());
    body.add(new SpriteComponent({ texture: "body.png" }));
    const head = this.spawnChild("head");
    head.add(new Transform({ position: { x: 0, y: -20 } }));
    head.add(new SpriteComponent({ texture: "head.png" }));
  }

  faceLeft(): void {
    this.get(Transform).setScale(-1, 1);            // mirrors body + head together
  }
  faceRight(): void {
    this.get(Transform).setScale(1, 1);
  }
}
```

Negative scale on a child still composes — a child with `setScale(-1, 1)` under a parent already at `(-1, 1)` ends up at `worldScale = (1, 1)` (un-mirrored). The same composition applies to positive non-unit scales (a parent at `2x` zooms its whole subtree).

### Processes

| Export | Purpose |
|---|---|
| `Process` | Frame-updated action; `Process.delay(seconds, cb)`; `.elapsed` — seconds ticked so far, scaled by the caller's timeScale |
| `ProcessComponent` | Entity component managing processes and slots |
| `ProcessSlot` | Reusable restartable handle (cooldowns, effects) |
| `Tween` | Static factory: `to`, `custom`, `vec2`, `stagger` |
| `Sequence` | Chainable step builder: `then`, `wait`, `call`, `parallel`, `loop` |
| `TimerEntity` | Pre-built entity with ProcessComponent API |

Decision matrix:

| Need | Reach for |
|---|---|
| Wait N seconds then run a callback | `Process.delay()` |
| Cooldown / restartable timer (`completed`, `restart`) | `pc.slot()` |
| Animate one property A → B | `Tween.to()` / `.vec2()` |
| Interpolate a number from→to with a custom setter | `Tween.custom(setter, from, to, duration, easing?)` |
| Cascade a tween across an array (staggered starts) | `Tween.stagger(items, (item, i) => Process, stepMs)` → `Process[]` |
| Arbitrary per-frame logic (no interpolation) | `new Process({ update })` |
| Multi-step "do this, then this, then this" | `Sequence` |
| Run several animations together | `Sequence.parallel()` |
| Multi-point or non-monotonic animation curves | `KeyframeAnimator` |
| Fire discrete events at specific times | `KeyframeAnimator` keyframe `event` |

Tag processes with `pc.run(p, { tags: ["vfx"] })` then cancel groups with `pc.cancel("vfx")`. Processes and slots auto-cancel on entity destroy via `ProcessComponent.onDestroy()`.

### Animation

Keyframe-based property animation on top of `ProcessComponent`. Runs multiple named animations concurrently; values interpolate between keyframes via an easing function and are pushed to a user-supplied setter.

| Export | Purpose |
|---|---|
| `KeyframeAnimator<T>` | Component hosting named keyframe animations (`play`, `stop`, `stopAll`, `isPlaying`) |
| `Keyframe<T>` | `{ time, data, easing?, event? }` — single control point |
| `KeyframeAnimationDef<T>` | `{ keyframes, setter?, loop?, speed?, duration?, easing?, onEnter?, onExit? }` |
| `createKeyframeTrack<T>(options)` | Factory that returns a `Process` driving a single track |
| `interpolate<T>(from, to, t, easing?)` | Blend two `Interpolatable` values |
| `Interpolatable` | `number \| Vec2Like` — registered interpolation types |

```ts
import { KeyframeAnimator, ProcessComponent, Transform } from "@yagejs/core";

entity.add(new ProcessComponent());
const anim = entity.add(new KeyframeAnimator({
  bob: {
    keyframes: [
      { time: 0, data: 0 },
      { time: 0.5, data: 10 },
      { time: 1, data: 0 },
    ],
    setter: (v) => (entity.get(Transform).y = v as number),
    loop: true,
  },
}));
anim.play("bob");
```

`KeyframeAnimator` requires `ProcessComponent` on the same entity. Each keyframe's `time` is in seconds along the track.

`setter` is **optional** — omit it for "pure timeline" animations that only
fire keyframe `event` callbacks (cutscenes, audio cues, gameplay beats):

```ts
new KeyframeAnimator({
  intro: {
    keyframes: [
      { time: 0,    data: 0, event: () => audio.play("step") },
      { time: 250,  data: 0, event: () => audio.play("step") },
      { time: 500,  data: 0, event: () => audio.play("door") },
    ],
    // no setter — only the events matter
  },
});
```

`KeyframeAnimationDef.setter` is declared with method syntax so it's
contravariance-friendly: a `Record<string, KeyframeAnimationDef<number>>`
flows into the constructor unchanged, no `as` cast or widening helper needed.

### Pause on Tab Blur

```ts
const scenes = this.context.resolve(SceneManagerKey);

scenes.autoPauseOnBlur = true;  // default: false
```

When enabled, `SceneManager` sets `scene.paused = true` on every scene in `activeScenes` on `document.hidden === true`, and restores them on `hidden === false`. Only scenes paused by this mechanism are restored — user-paused scenes (manual `scene.paused = true` or `pauseBelow` cascade) are never touched. Toggling the flag off mid-blur unpauses immediately. No-op in non-browser environments.

### Scene Transitions

| Export | Purpose |
|---|---|
| `SceneTransition` | Interface: `duration`, `begin?`, `tick`, `end?` |
| `SceneTransitionContext` | `elapsed`, `kind`, `engineContext`, `fromScene`, `toScene` |
| `SceneTransitionKind` | `"push" \| "pop" \| "replace"` |
| `SceneTransitionOptions` | `{ transition?: SceneTransition }` |
| `resolveTransition(callSite, destination)` | Precedence: call-site → `scene.defaultTransition` → undefined |

Core ships the transition contract + orchestration only. Concrete transitions (`fade`, `flash`, `crossFade`) live in `@yagejs/renderer`.

`SceneManager.push/pop/replace` accept `{ transition }`. `Scene.defaultTransition` provides a per-scene default. `Scene.isTransitioning` and `SceneManager.isTransitioning` reflect active transition state.

Events: `scene:transition:started { kind, fromScene, toScene }`, `scene:transition:ended { kind, fromScene, toScene }` (fromScene/toScene may be `undefined`).

**Breaking:** `SceneManager.pop()` returns `Promise<Scene | undefined>`.

#### Reentrant scene swaps

`push`/`pop`/`replace`/`popAll` are safe to call from inside a lifecycle hook
(`onEnter`, `onExit`, `onPause`, `onResume`, or a `beforeEnter`/`afterExit`
hook). The call is queued on the manager's internal pending chain and runs
after the current mutation finishes; the returned promise resolves when the
deferred operation completes.

```ts
class TitleScene extends Scene {
  onEnter() {
    // Safe — `replace` is queued and runs after TitleScene's onEnter returns.
    if (saveSystem.hasAutosave()) {
      this.context.resolve(SceneManagerKey).replace(new GameScene());
    }
  }
}
```

Dev builds emit a `console.warn` because reentrant swaps are usually a smell
(an `onEnter` that immediately replaces the scene rarely matches intent, and
a dropped promise can hide errors). Production builds suppress the warning.

### Easing

`easeLinear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeOutBounce`

### Serialization

| Export | Purpose |
|---|---|
| `@serializable` | Class decorator for save/load registration |
| `SerializableRegistry` | Auto-populated registry of decorated classes |
| `SnapshotResolver` | Maps old entity IDs to restored instances in `afterRestore()` |

### Traits

| Export | Purpose |
|---|---|
| `defineTrait<T>(name)` | Define a trait token |
| `@trait(token)` | Decorator: declare entity implements trait |
| `TraitToken<T>` | Token used with `entity.hasTrait(token)` |

### Entity Queries

| Export | Purpose |
|---|---|
| `QueryCache` | Incremental entity query cache |
| `QueryResult` | Iterable result from `cache.register([Component, ...])` |
| `filterEntities(entities, filter)` | One-off filter by name, tag, component, or trait |

Call `cache.unregister(result)` when a registered query no longer needs live updates — a `QueryResult` keeps receiving `onComponentAdded`/`onComponentRemoved` updates until released. Queries registered once at system-install time (`DisplaySystem`, `UILayoutSystem`) are engine-lifetime by design and are never unregistered; per-mount registrations (e.g. `@yagejs/ui-react`'s `useQuery`) release on unmount.

### Stable Identity

Opt-in per-scene entity keys. Most entities (bullets, particles, transient enemies) don't need them; pass `{ key }` only for entities whose state should persist (chests, doors, named NPCs).

| Export | Purpose |
|---|---|
| `SpawnOptions` | `{ key?: string }` — trailing arg of `scene.spawn` / `entity.spawnChild` |
| `entity.key` | `string \| undefined` — the assigned key |
| `entity.requireKey()` | Returns `key` or throws (use in component `setup()`) |
| `scene.findByKey<E>(key)` | Look up entity by key, scene-scoped, hides destroyed entities |

```ts
scene.spawn(Chest, { content: ["potion"] }, { key: "forest/chest-01" });
scene.spawn(Plain, { key: "spawn-point" });        // class with no setup-params
scene.spawn("anchor", { key: "anchor-01" });       // anonymous entity with a key
parent.spawnChild("body", Bone, { key: "bone-01" });

const chest = scene.findByKey<Chest>("forest/chest-01");
```

The class form derives its trailing args from the entity's `setup` PARAMETER. No declared `setup`, or a zero-parameter `setup(): void` → `spawn(Class, options?)` (no params slot). `setup(params)` with a required parameter → params is required: `spawn(Class, params, options?)`, and `spawn(Class)` is a type error (even when every field of `params` is optional — a required parameter still means `setup(undefined)` would crash). `setup(params?)` or a defaulted parameter → params optional: `spawn(Class, params?, options?)`. Omitting a required field reports that field as missing on the params object (`Property 'spawnPoint' is missing`), naming the field that's actually absent.

The params slot takes the setup param type, not `SpawnOptions`, so a `SpawnOptions`-shaped literal (e.g. `{ key }`) is rejected there; key an all-optional-param class via the 3-arg form `spawn(Class, {}, { key })`. Residual: if the setup param type itself declares an optional `key`, `{ key }` satisfies the params slot and the runtime routes it to options — don't name a top-level setup-params field `key`; if you must, use the 3-arg form. The 3-arg form `spawn(Class, params, options)` is always unambiguous.

Duplicate keys throw at spawn time with no orphan side-effect — the entity is not added to `scene.entities` and `entity:created` is not emitted. Keys are immutable for an entity's lifetime; destroy + respawn to swap. The index is per-scene and clears on scene teardown. Identity is independent of `@yagejs/save` — game code uses `entity.key` as a stable id in persistent stores (`createSet<string>()`).

### Assets

| Export | Purpose |
|---|---|
| `AssetHandle<T>` | Typed handle returned by asset factory functions |
| `AssetManager` | Load/unload assets, register loaders |

### Testing

| Export | Purpose |
|---|---|
| `createTestEngine(config?)` | Fully wired Engine for integration tests |
| `createMockScene(name?)` | Lightweight scene with EngineContext for unit tests |
| `createMockEntity(name?)` | Entity spawned in a mock scene |
| `advanceFrames(engine, n, dtMs?)` | Advance game loop by N frames (`dtMs` is the per-frame ms delta; default `1000/60`) |

See also the `Testing & Debugging` section in the Quick Start for a runnable example and the Inspector API for runtime introspection.

### Logging & Diagnostics

Category-tagged logger with a ring buffer. Installed on `Engine` and available via `LoggerKey`. The game loop auto-updates the logger's frame counter, so every `LogEntry` carries the frame number it was emitted on.

| Export | Purpose |
|---|---|
| `Logger` | `debug`, `info`, `warn`, `error` (all take `category, message, data?`); `getRecent(count?)`, `formatRecentLogs(count?)`, `clear()` |
| `LogLevel` | `Debug` (0) / `Info` (1) / `Warn` (2) / `Error` (3) / `None` (4) |
| `LoggerConfig` | `{ level?, categories?, bufferSize?, output? }` |
| `LogEntry` | `{ level, category, message, data?, timestamp, frame }` |
| `LoggerKey` | DI key for resolving a `Logger` from `EngineContext` |

```ts
import { LogLevel } from "@yagejs/core";

const engine = new Engine({ debug: true });

engine.logger.info("physics", "Shape spawned", { x: 100, y: 200 });
engine.logger.warn("gameplay", "Low health");
engine.logger.error("render", "Texture missing", { key: "hero.png" });

// Dump the most recent entries (e.g. on crash)
console.log(engine.logger.formatRecentLogs(20));
```

`bufferSize` (default 500) caps the ring buffer; `categories` restricts which categories are accepted; `output` overrides the default `console.*` handler with a custom sink (e.g., to ship logs to a remote service).

### Well-known DI Keys

`EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`, `ProcessSystemKey`, `AssetManagerKey`

## LoadingScene

Base class for a progress-bar loading screen. Orchestrates preload, emits events on the bus, and hands off to a target scene. No rendering — the visual lives in `@yagejs/ui` (`LoadingSceneProgressBar`) or user-written components subscribing to the events. Full reference: `loading-scene.md`.

```ts
import { LoadingScene } from "@yagejs/core";
import { fade } from "@yagejs/renderer";
import { LoadingSceneProgressBar } from "@yagejs/ui";

class Boot extends LoadingScene {
  readonly target = new GameScene();
  readonly minDuration = 0.5;
  readonly transition = fade({ duration: 0.3 });
  override onEnter() {
    this.spawn(LoadingSceneProgressBar);
    this.startLoading();
  }
}
```

Emits `scene:loading:progress` and `scene:loading:done` on `EventBusKey`. Set `autoContinue = false` and call `scene.continue()` to gate the handoff (e.g. "press any key").

## State

Typed reactive primitives for game-wide singleton state. Used by `@yagejs/ui-react`'s `useStore` and the save layer.

### Contracts

Three orthogonal interfaces; every `Reactive*` shape implements all three:

```ts
interface Reactive            { subscribe(fn: () => void): () => void }
interface Serializable<TEnc>  { serialize(): TEnc; hydrate(raw: TEnc): void }
interface Resettable          { reset(): void }
```

Each shape also carries a `[STATE_KIND]` symbol-brand (`"value" | "counter" | "record" | "map" | "set" | "list" | "store"`) — `useStore` dispatches on it.

```ts
interface ReactiveValue<T>          extends Reactive, Serializable<{value:T}>, Resettable { get(): T; set(v: T): void }
interface ReactiveCounter           extends Reactive, Serializable<number>,     Resettable {
  value(): number; set(n: number): void; increment(by?: number): void;
  decrement(by?: number): void; clamp(value: number, min: number, max: number): void;
}
interface ReactiveRecord<T extends object> extends Reactive, Serializable<T>, Resettable {
  get(): Readonly<T>; set(partial: Partial<T>): void;
}
interface ReactiveMap<K, V>         extends Reactive, Serializable<Array<[K,V]>>, Resettable {
  get(k: K): V | undefined; set(k: K, v: V): void; delete(k: K): void;
  has(k: K): boolean; entries(): Array<[K, V]>; size(): number; clear(): void;
}
interface ReactiveSet<K>            extends Reactive, Serializable<K[]>, Resettable {
  add(k: K): void; delete(k: K): void; has(k: K): boolean;
  values(): K[]; size(): number; clear(): void;
}
interface ReactiveList<T>           extends Reactive, Serializable<ListEncoded<T>>, Resettable {
  add(item: T): number;            // returns assigned id
  remove(id: number): boolean;     // by id, not delete — semantically distinct
  get(id: number): T | undefined; update(id: number, partial: Partial<T>): boolean;
  list(): T[]; size(): number; clear(): void;
  // keyed lookup — requires the `keyBy` option, else these throw.
  // A keyed list holds at most one item per key; add/update/upsert throw on a
  // duplicate key. upsert requires keyBy(item) === key.
  findId(key: string | number): number | undefined;   // id for a domain key
  getByKey(key: string | number): T | undefined;       // item for a domain key
  upsert(key: string | number, item: T): number;       // add-or-replace by key; returns id
}
interface ReactiveStore<L>          extends Reactive, Serializable<EncodedStore<L>>, Resettable { /* plus L's leaves */ }
```

### Factories

```ts
import {
  createValue, createCounter, createRecord,
  createMap, createSet, createList, createStore,
} from "@yagejs/core";

// Leaf factories — usable on their own.
const settings = createRecord<Settings>({ default: () => ({ music: 0.8, sfx: 1.0 }) });
const opened    = createSet<string>();
const enemies   = createMap<string, number>();
const restEpoch = createCounter();
const day       = createValue<number>({ default: 1 });
const journal   = createList<{ at: number; text: string }>();

// Keyed list — pass `keyBy` to look items up by a domain field in O(1).
// Keys are unique: at most one item per key. add/update/upsert throw if the
// result would share a key with another item; upsert requires keyBy(item) === key.
const inventory = createList<{ itemId: string; quantity: number }>({
  keyBy: (slot) => slot.itemId,
});
inventory.upsert("sword", { itemId: "sword", quantity: 1 }); // insert
inventory.upsert("sword", { itemId: "sword", quantity: 2 }); // replace in place
inventory.findId("sword");    // -> id
inventory.getByKey("sword");  // -> { itemId: "sword", quantity: 2 }

// Compound — bundle leaves so they serialise/restore atomically.
const game = createStore((s) => ({
  inventory: s.map<string, number>(),
  recipes:   s.set<string>(),
  gold:      s.counter({ default: 0 }),
  shelf:     s.list<Potion>(),
  day:       s.value<number>({ default: 1 }),
  settings:  s.record<Settings>({ default: () => ({ volume: 0.8, lang: "en" }) }),
}));
game.gold.increment(10);
game.inventory.set("moonleaf", 3);
```

Factories take no id and no version — they return fresh, pure data instances. Ids and version envelopes live at the save call site (`@yagejs/save`); `useStore(compound)` works (returns the encoded snapshot), though reading individual leaves keeps subscription granularity per-leaf.

Codecs for non-JSON-native types: `jsonCodec()`, `setCodec<K>()`, `mapCodec<K,V>()`, `dateCodec()`. Set/Map/Counter/List bundle codecs internally; you only specify a codec on `createRecord<T>` / `createValue<T>` (or the matching `s.record`/`s.value` leaves) for exotic types.

See `@yagejs/save` docs for the IO layer that consumes any `Serializable<T>`.

## Core Types

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

enum Phase {
  EarlyUpdate, FixedUpdate, Update, LateUpdate, Render, EndOfFrame
}

type EasingFunction = (t: number) => number;
type ComponentClass<C> = new (...args: never[]) => C;
```

## Error Handling

`ErrorBoundary` wraps all system and component execution. Errors disable the offending system/component. The game loop never crashes. Query disabled items via `ErrorBoundary.getDisabled()`.

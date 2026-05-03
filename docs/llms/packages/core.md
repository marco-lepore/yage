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
  get scene(): Scene;                         // throws if detached
  get tryScene(): Scene | null;               // null if detached
  addChild(name: string, child: Entity): void;
  spawnChild(name: string): Entity;
  spawnChild<E extends Entity>(name: string, Class: new () => E): E;
  spawnChild<E extends Entity, P>(
    name: string,
    Class: new () => E & { setup(params: P): void },
    params: P,
  ): E;
  spawnChild<P>(name: string, blueprint: Blueprint<P>, params: P): Entity;
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

### Math

| Export | Purpose |
|---|---|
| `Vec2` | Immutable 2D vector (`add`, `sub`, `scale`, `normalize`, `lerp`, `dot`, `distance`, static `moveTowards`) |
| `Transform` | Mutable position/rotation/scale component (`setPosition`, `translate`, `rotate`) |
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
and `deltaTime` must use the same unit; `maxSpeed` is in units per that same
time base.

### Processes

| Export | Purpose |
|---|---|
| `Process` | Frame-updated action; `Process.delay(ms, cb)` |
| `ProcessComponent` | Entity component managing processes and slots |
| `ProcessSlot` | Reusable restartable handle (cooldowns, effects) |
| `Tween` | Static factory: `to`, `custom`, `vec2` |
| `Sequence` | Chainable step builder: `then`, `wait`, `call`, `parallel`, `loop` |
| `TimerEntity` | Pre-built entity with ProcessComponent API |

Decision matrix:

| Need | Reach for |
|---|---|
| Wait N ms then run a callback | `Process.delay()` |
| Cooldown / restartable timer (`completed`, `restart`) | `pc.slot()` |
| Animate one property A → B | `Tween.to()` / `.vec2()` |
| Interpolate a number from→to with a custom setter | `Tween.custom(setter, from, to, duration, easing?)` |
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
| `KeyframeAnimationDef<T>` | `{ keyframes, setter, loop?, speed?, duration?, easing?, onEnter?, onExit? }` |
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
      { time: 500, data: 10 },
      { time: 1000, data: 0 },
    ],
    setter: (v) => (entity.get(Transform).y = v as number),
    loop: true,
  },
}));
anim.play("bob");
```

`KeyframeAnimator` requires `ProcessComponent` on the same entity. Each keyframe's `time` is in milliseconds along the track.

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
| `advanceFrames(engine, n, dtMs?)` | Advance game loop by N frames |

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
  readonly minDuration = 500;
  readonly transition = fade({ duration: 300 });
  override onEnter() {
    this.spawn(LoadingSceneProgressBar);
    this.startLoading();
  }
}
```

Emits `scene:loading:progress` and `scene:loading:done` on `EventBusKey`. Set `autoContinue = false` and call `scene.continue()` to gate the handoff (e.g. "press any key").

## State

Typed reactive primitives for game-wide singleton state. Used by `@yagejs/ui-react`'s `useStore`, the save layer (via `defineStore` etc.), and any code wanting a typed singleton with subscribers.

```ts
import { createAtom, createStore, defineStore, defineSet, defineMap, defineCounter } from "@yagejs/core";

// Minimal reactive cell (signal-shaped)
const a = createAtom(0);
a.get();             // 0
a.set(1);            // notifies subscribers iff Object.is(old, next) is false
a.subscribe(v => …); // returns unsubscribe

// Object-shaped store with shallow merge
const store = createStore({ score: 0, hp: 100 });
store.get();                  // Readonly<{score, hp}>, stable ref between sets
store.set({ score: 5 });      // shallow merge, only notifies on change
store.subscribe(() => …);

// Persistent stores — add id/version/migrate/codec/serialize/hydrate.
// Save layer (`@yagejs/save`) consumes these.
const settings = defineStore<Settings>("settings", {
  version: 1,
  defaults: () => ({ music: 0.8, sfx: 1.0 }),
});
const opened   = defineSet<string>("world.opened");          // .has/.add/.remove
const enemies  = defineMap<string, number>("world.enemies"); // .has/.get/.set/.remove
const restEpoch = defineCounter("world.rest");                // .value/.set/.increment/.decrement
```

Codecs for non-JSON-native types: `jsonCodec()`, `setCodec<K>()`, `mapCodec<K,V>()`, `dateCodec()`. Set/Map/Counter wrappers bundle codecs internally; you only specify a codec on `defineStore<T>` for exotic types.

Test reset: `_resetAllStoresForTesting()` resets every defined store to defaults. See `@yagejs/save` docs for the IO layer that consumes these.

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

# @yage/core

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

### Events

| Export | Purpose |
|---|---|
| `EventBus<E>` | Typed pub/sub (`on`, `once`, `emit`, `clear`) |
| `EventToken<T>` | Typed token for entity events |
| `defineEvent<T>(name)` | Create an event token |

### Math

| Export | Purpose |
|---|---|
| `Vec2` | Immutable 2D vector (`add`, `sub`, `scale`, `normalize`, `lerp`, `dot`, `distance`) |
| `Transform` | Mutable position/rotation/scale component (`setPosition`, `translate`, `rotate`) |
| `MathUtils` | `lerp`, `clamp`, `angleLerp`, `randomRange`, etc. |

### Processes

| Export | Purpose |
|---|---|
| `Process` | Frame-updated action; `Process.delay(ms, cb)` |
| `ProcessComponent` | Entity component managing processes and slots |
| `ProcessSlot` | Reusable restartable handle (cooldowns, effects) |
| `Tween` | Static factory: `to`, `custom`, `vec2` |
| `Sequence` | Chainable step builder: `then`, `wait`, `call`, `parallel`, `loop` |
| `TimerEntity` | Pre-built entity with ProcessComponent API |

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

### Well-known DI Keys

`EngineKey`, `EventBusKey`, `SceneManagerKey`, `LoggerKey`, `QueryCacheKey`, `ErrorBoundaryKey`, `GameLoopKey`, `InspectorKey`, `SystemSchedulerKey`, `ProcessSystemKey`, `AssetManagerKey`

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

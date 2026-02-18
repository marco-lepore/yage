# YAGE v2 -- Technical Design Document

## Table of Contents

1. [Monorepo Structure](#1-monorepo-structure)
2. [Core Kernel (`@yage/core`)](#2-core-kernel-yagecore)
3. [Renderer Plugin (`@yage/renderer`)](#3-renderer-plugin-yagerenderer)
4. [Physics Plugin (`@yage/physics`)](#4-physics-plugin-yagephysics)
5. [Input Plugin (`@yage/input`)](#5-input-plugin-yageinput)
6. [Audio Plugin (`@yage/audio`)](#6-audio-plugin-yageaudio)
7. [Other Plugins](#7-other-plugins)
8. [API Sketches](#8-api-sketches)
9. [v1 Pain Point Resolution Table](#9-v1-pain-point-resolution-table)

---

## 1. Monorepo Structure

### Package Layout

```
yage/
├── packages/
│   ├── core/                 # @yage/core - Zero-dependency kernel
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── Engine.ts
│   │   │   ├── Engine.test.ts          # Tests co-located with source
│   │   │   ├── EngineContext.ts
│   │   │   ├── EngineContext.test.ts
│   │   │   ├── Entity.ts
│   │   │   ├── Entity.test.ts
│   │   │   ├── Component.ts
│   │   │   ├── Component.test.ts
│   │   │   ├── System.ts
│   │   │   ├── System.test.ts
│   │   │   ├── SystemScheduler.ts
│   │   │   ├── GameLoop.ts
│   │   │   ├── GameLoop.test.ts
│   │   │   ├── QueryCache.ts
│   │   │   ├── QueryCache.test.ts
│   │   │   ├── EventBus.ts
│   │   │   ├── EventBus.test.ts
│   │   │   ├── SceneManager.ts
│   │   │   ├── SceneManager.test.ts
│   │   │   ├── Scene.ts
│   │   │   ├── Scene.test.ts
│   │   │   ├── Process.ts
│   │   │   ├── Process.test.ts
│   │   │   ├── Tween.ts
│   │   │   ├── Sequence.ts
│   │   │   ├── Prefab.ts
│   │   │   ├── Prefab.test.ts
│   │   │   ├── ErrorBoundary.ts
│   │   │   ├── ErrorBoundary.test.ts
│   │   │   ├── Inspector.ts
│   │   │   ├── Inspector.test.ts
│   │   │   ├── Logger.ts
│   │   │   ├── Logger.test.ts
│   │   │   ├── Vec2.ts
│   │   │   ├── Vec2.test.ts
│   │   │   ├── Transform.ts
│   │   │   ├── MathUtils.ts
│   │   │   ├── MathUtils.test.ts
│   │   │   ├── test-utils.ts           # Mock factories for testing
│   │   │   └── types.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   └── vitest.config.ts
│   │
│   ├── renderer/             # @yage/renderer - PixiJS v8 integration
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── RendererPlugin.ts
│   │   │   ├── SpriteComponent.ts
│   │   │   ├── GraphicsComponent.ts
│   │   │   ├── AnimatedSpriteComponent.ts
│   │   │   ├── Camera.ts
│   │   │   ├── Camera.test.ts
│   │   │   ├── DisplaySystem.ts
│   │   │   ├── RenderLayer.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── physics/              # @yage/physics - Rapier2D integration
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── PhysicsPlugin.ts
│   │   │   ├── PhysicsWorld.ts
│   │   │   ├── RigidBodyComponent.ts
│   │   │   ├── ColliderComponent.ts
│   │   │   ├── PhysicsSystem.ts
│   │   │   ├── PhysicsInterpolationSystem.ts
│   │   │   ├── CollisionLayers.ts
│   │   │   ├── CollisionLayers.test.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── input/                # @yage/input - Multi-device input
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── InputPlugin.ts
│   │   │   ├── InputManager.ts
│   │   │   ├── InputSystem.ts
│   │   │   ├── ActionMap.ts
│   │   │   ├── ActionMap.test.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── audio/                # @yage/audio - Sound management
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── AudioPlugin.ts
│   │   │   ├── AudioManager.ts
│   │   │   ├── SoundComponent.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── particles/            # @yage/particles - Particle effects
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── tilemap/              # @yage/tilemap - Tiled map support
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui/                   # @yage/ui - Layout system
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── debug/                # @yage/debug - Debug overlay & tools
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── yage/                 # yage - Meta-package (re-exports all)
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   ├── bouncing-ball/
│   ├── platformer/
│   ├── top-down/
│   ├── input-demo/
│   ├── particles-demo/
│   └── scene-stack/
│
├── e2e/                      # Playwright integration tests
│   ├── bouncing-ball.spec.ts
│   ├── input.spec.ts
│   ├── physics.spec.ts
│   ├── scene-transitions.spec.ts
│   ├── ui.spec.ts
│   ├── inspector.spec.ts
│   └── global.d.ts
│
├── turbo.json
├── package.json              # Workspace root
├── tsconfig.base.json
├── vitest.workspace.ts
├── playwright.config.ts
└── docs/
    └── v2/
```

### Dependency Graph

```
yage (meta-package)
├── @yage/core          (zero dependencies)
├── @yage/renderer      → @yage/core, pixi.js
├── @yage/physics       → @yage/core, @dimforge/rapier2d
├── @yage/input         → @yage/core
├── @yage/audio         → @yage/core, @pixi/sound
├── @yage/particles     → @yage/core, @yage/renderer
├── @yage/tilemap       → @yage/core, @yage/renderer, @yage/physics (optional peer)
├── @yage/ui            → @yage/core, @yage/renderer
└── @yage/debug         → @yage/core, @yage/renderer, @yage/physics (optional peer)
```

### Build Tooling

- **Monorepo**: Turborepo for task orchestration
- **Bundler**: tsup (esbuild-based) for each package -- outputs ESM + CJS + .d.ts
- **TypeScript**: Shared `tsconfig.base.json` with project references
- **Test Runner**: Vitest (workspace mode) for unit tests, Playwright for E2E
- **Linting**: ESLint flat config + Prettier
- **CI**: GitHub Actions running lint > typecheck > unit tests > build > e2e tests

---

## 2. Core Kernel (`@yage/core`)

`@yage/core` has **zero runtime dependencies**. It defines the ECS kernel, game loop contract, scene management, event system, and all supporting infrastructure. It runs in any JavaScript environment (browser, Node.js, workers).

### 2.1 Engine

The `Engine` is the top-level entry point. It owns the plugin registry, game loop, scene manager, and DI container.

```typescript
export interface EngineConfig {
  /** Enable debug mode (Inspector API, debug logging) */
  debug?: boolean;
  /** Fixed timestep in ms (default: 1000/60) */
  fixedTimestep?: number;
  /** Max fixed steps per frame to prevent spiral of death (default: 5) */
  maxFixedStepsPerFrame?: number;
  /** Logger configuration */
  logger?: LoggerConfig;
}

export class Engine {
  readonly context: EngineContext;
  readonly scenes: SceneManager;
  readonly events: EventBus;
  readonly loop: GameLoop;
  readonly logger: Logger;
  readonly inspector: Inspector;

  private plugins: Map<string, Plugin> = new Map();
  private started: boolean = false;

  constructor(config?: EngineConfig);

  /** Register a plugin. Must be called before start(). */
  use(plugin: Plugin): this;

  /** Start the engine. Installs plugins (topological order), starts the game loop. */
  async start(): Promise<void>;

  /** Stop the engine. Destroys all scenes, plugins, and the game loop. */
  destroy(): void;
}
```

### 2.2 EngineContext (Dependency Injection)

Replaces the global mutable `Executor` singleton. Services are registered by typed keys and resolved explicitly. No global state, no ambient access.

```typescript
/** A typed key for service registration/resolution. */
export class ServiceKey<T> {
  constructor(public readonly id: string) {}
}

export class EngineContext {
  private services: Map<string, unknown> = new Map();

  /** Register a service. Throws if key already registered. */
  register<T>(key: ServiceKey<T>, service: T): void;

  /** Resolve a service. Throws if not registered. */
  resolve<T>(key: ServiceKey<T>): T;

  /** Resolve a service, returning undefined if not registered. */
  tryResolve<T>(key: ServiceKey<T>): T | undefined;

  /** Check if a service is registered. */
  has<T>(key: ServiceKey<T>): boolean;
}

// Well-known service keys (exported from @yage/core)
export const EngineKey = new ServiceKey<Engine>('engine');
export const EventBusKey = new ServiceKey<EventBus>('eventBus');
export const SceneManagerKey = new ServiceKey<SceneManager>('sceneManager');
export const LoggerKey = new ServiceKey<Logger>('logger');
export const InspectorKey = new ServiceKey<Inspector>('inspector');
export const QueryCacheKey = new ServiceKey<QueryCache>('queryCache');
export const ErrorBoundaryKey = new ServiceKey<ErrorBoundary>('errorBoundary');
export const GameLoopKey = new ServiceKey<GameLoop>('gameLoop');
```

### 2.3 Entity

Replaces `GameObject`. Uses a `Map<ComponentConstructor, Component>` for O(1) lookups by type.

```typescript
export class Entity {
  readonly id: number;
  readonly name: string;
  readonly tags: Set<string>;

  private components: Map<ComponentClass, Component> = new Map();
  private scene: Scene;
  private destroyed: boolean = false;

  /** Add a component instance. Notifies QueryCache. */
  add<C extends Component>(component: C): C;

  /** Get a component by class. Throws if not found. */
  get<C extends Component>(cls: ComponentClass<C>): C;

  /** Get a component by class, or undefined if not found. */
  tryGet<C extends Component>(cls: ComponentClass<C>): C | undefined;

  /** Check if entity has a component. */
  has(cls: ComponentClass): boolean;

  /** Remove a component by class. Notifies QueryCache. */
  remove(cls: ComponentClass): void;

  /** Get all components as an iterable. */
  getAll(): Iterable<Component>;

  /** Mark for destruction at end of current frame phase. */
  destroy(): void;

  /** True if destroy() has been called. */
  get isDestroyed(): boolean;
}

/** Constructor type for components */
export type ComponentClass<C extends Component = Component> = new (...args: any[]) => C;
```

### 2.4 Component

Base class with no lifecycle methods. Systems call updates, not components. This ensures disabled components are never accidentally ticked.

```typescript
export abstract class Component {
  /** Set by the engine when added to an entity. */
  entity!: Entity;

  /** Whether this component is active. Systems skip disabled components. */
  enabled: boolean = true;

  /** Called when the component is added to an entity. */
  onAdd?(): void;

  /** Called when the component is removed from an entity. */
  onRemove?(): void;

  /** Called when the component is destroyed (entity destroyed or component removed). */
  onDestroy?(): void;
}
```

**Key design decision**: No `onTick`, `onFixedTick`, or any update methods on `Component`. All per-frame work is done by `System` classes that query for components. This inverts the v1 model where every component was responsible for its own update, and disabled components were still iterated.

### 2.5 System

Systems are the workhorses. Each System runs in a specific game loop phase, queries for entities matching a component signature, and operates on them.

```typescript
export enum Phase {
  EarlyUpdate = 'earlyUpdate',
  FixedUpdate = 'fixedUpdate',
  Update = 'update',
  LateUpdate = 'lateUpdate',
  Render = 'render',
  EndOfFrame = 'endOfFrame',
}

export abstract class System {
  /** The phase this system runs in. */
  abstract readonly phase: Phase;

  /** Execution priority within the phase. Lower = earlier. Default: 0. */
  readonly priority: number = 0;

  /** Whether this system is active. */
  enabled: boolean = true;

  /** Reference to the engine context, set on registration. */
  protected context!: EngineContext;

  /** Called once when the system is registered with the engine. */
  onRegister?(context: EngineContext): void;

  /** Called every frame (or every fixed step for FixedUpdate). */
  abstract update(dt: number): void;

  /** Called when the system is removed. */
  onUnregister?(): void;
}
```

### 2.6 SystemScheduler

Manages ordered execution of systems within each phase.

```typescript
export class SystemScheduler {
  private phases: Map<Phase, System[]> = new Map();

  /** Register a system. Inserts sorted by priority. */
  add(system: System): void;

  /** Remove a system. */
  remove(system: System): void;

  /** Run all systems in a given phase. Wraps each in ErrorBoundary. */
  run(phase: Phase, dt: number): void;

  /** Get all systems registered for a phase. */
  getSystems(phase: Phase): readonly System[];
}
```

### 2.7 GameLoop

Driven by an external ticker (PixiJS v8 Ticker when renderer is installed, or a manual `requestAnimationFrame` fallback). Implements fixed timestep with accumulator for physics determinism.

```typescript
export interface GameLoopCallbacks {
  earlyUpdate(dt: number): void;
  fixedUpdate(fixedDt: number): void;
  update(dt: number): void;
  lateUpdate(dt: number): void;
  render(dt: number): void;
  endOfFrame(dt: number): void;
}

export class GameLoop {
  readonly fixedTimestep: number;
  readonly maxFixedStepsPerFrame: number;

  private accumulator: number = 0;
  private running: boolean = false;
  private tickerUnsubscribe?: () => void;

  constructor(config: {
    fixedTimestep?: number;
    maxFixedStepsPerFrame?: number;
  });

  /** Provide the callbacks that the loop invokes each frame. */
  setCallbacks(callbacks: GameLoopCallbacks): void;

  /**
   * Attach an external ticker (e.g. PixiJS Ticker).
   * The ticker calls `tick(dt)` every frame.
   * If no ticker is attached, the loop uses requestAnimationFrame.
   */
  attachTicker(subscribe: (callback: (dt: number) => void) => () => void): void;

  /** Start the loop. */
  start(): void;

  /** Stop the loop. */
  stop(): void;

  /** Called each frame by the ticker. dt is in milliseconds. */
  tick(dtMs: number): void;
}
```

**Frame execution order per `tick(dt)`**:

```
1. earlyUpdate(dt)
2. accumulator += dt
3. while (accumulator >= fixedTimestep && steps < max):
     fixedUpdate(fixedTimestep)
     accumulator -= fixedTimestep
     steps++
4. update(dt)
5. lateUpdate(dt)
6. render(dt)
7. endOfFrame(dt)
```

No `setTimeout`. No async. Fully synchronous within a frame.

### 2.8 QueryCache

Incrementally maintained entity sets based on component signatures (archetypes). Only invalidates when components are added/removed from entities, not every frame.

```typescript
export type QueryFilter = ComponentClass[];

export class QueryCache {
  /** Register a query. Returns a stable reference to the result set. */
  register(filter: QueryFilter): QueryResult;

  /** Called by Entity when a component is added. O(queries) update. */
  onComponentAdded(entity: Entity, componentClass: ComponentClass): void;

  /** Called by Entity when a component is removed. O(queries) update. */
  onComponentRemoved(entity: Entity, componentClass: ComponentClass): void;

  /** Called when an entity is destroyed. */
  onEntityDestroyed(entity: Entity): void;
}

export class QueryResult {
  /** Iterate matching entities. O(matched). */
  [Symbol.iterator](): Iterator<Entity>;

  /** Number of matching entities. */
  get size(): number;

  /** Get the first match (useful for singleton queries). */
  get first(): Entity | undefined;

  /** Convert to array (allocates). */
  toArray(): Entity[];
}
```

**How it works**: Each `QueryResult` stores a `Set<Entity>`. When an entity gains or loses a component, the cache checks all registered queries. If the entity now matches (or no longer matches), the set is updated. This is O(registered queries) per add/remove, but O(0) per frame for iteration.

### 2.9 EventBus

Typed publish/subscribe with no DOM dependency.

```typescript
export type EventMap = Record<string, unknown>;

export class EventBus<E extends EventMap = EventMap> {
  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void;

  /** Subscribe to an event, auto-unsubscribe after first emission. */
  once<K extends keyof E>(event: K, handler: (data: E[K]) => void): () => void;

  /** Emit an event. Handlers are called synchronously in registration order. */
  emit<K extends keyof E>(event: K, data: E[K]): void;

  /** Remove all handlers for an event, or all handlers if no event specified. */
  clear(event?: keyof E): void;
}

// Well-known engine events
export interface EngineEvents {
  'entity:created': { entity: Entity };
  'entity:destroyed': { entity: Entity };
  'component:added': { entity: Entity; component: Component };
  'component:removed': { entity: Entity; componentClass: ComponentClass };
  'scene:pushed': { scene: Scene };
  'scene:popped': { scene: Scene };
  'scene:replaced': { oldScene: Scene; newScene: Scene };
  'engine:started': void;
  'engine:stopped': void;
}
```

### 2.10 SceneManager

Scene stack with push/pop/replace semantics. Supports overlays and pause-below.

```typescript
export class SceneManager {
  private stack: Scene[] = [];

  /** The topmost (active) scene. */
  get active(): Scene | undefined;

  /** All scenes in the stack, bottom to top. */
  get all(): readonly Scene[];

  /** Push a scene onto the stack. Previous scene receives onPause(). */
  push(scene: Scene): void;

  /** Pop the top scene. Next scene receives onResume(). */
  pop(): Scene | undefined;

  /**
   * Replace the top scene. Equivalent to pop + push but the old scene
   * receives onExit() instead of onPause().
   */
  replace(scene: Scene): void;

  /** Clear all scenes. */
  clear(): void;
}
```

### 2.11 Scene

Scenes own entities and define asset manifests. Each scene is a self-contained world with its own entity pool.

```typescript
export interface AssetManifest {
  bundles: Array<{
    name: string;
    assets: Array<{ alias: string; src: string }>;
  }>;
}

export abstract class Scene {
  /** Name for debugging/inspection. */
  readonly name: string;

  /** Asset manifest to load when this scene is entered. */
  readonly assets?: AssetManifest;

  /** Whether scenes below this one in the stack should be paused. */
  readonly pauseBelow: boolean = true;

  /** Whether scenes below this one should still render. */
  readonly transparentBelow: boolean = false;

  private entities: Set<Entity> = new Set();
  private context!: EngineContext;
  private entityIdCounter: number = 0;

  /** Spawn a new entity in this scene. */
  spawn(name?: string): Entity;

  /** Spawn an entity from a prefab. */
  spawnPrefab(prefab: Prefab, overrides?: PrefabOverrides): Entity;

  /** Destroy an entity. Deferred to endOfFrame. */
  destroyEntity(entity: Entity): void;

  /** Get all active entities. */
  getEntities(): ReadonlySet<Entity>;

  /** Find entity by name (first match). */
  findEntity(name: string): Entity | undefined;

  /** Find entities by tag. */
  findEntitiesByTag(tag: string): Entity[];

  // Lifecycle hooks (override in subclasses)
  /** Called when assets are loaded and the scene is entered. */
  onEnter?(): void;
  /** Called when the scene is exited (popped or replaced). */
  onExit?(): void;
  /** Called when a scene is pushed on top of this one. */
  onPause?(): void;
  /** Called when the scene above is popped, restoring this scene. */
  onResume?(): void;
}
```

### 2.12 Process / Tween / Sequence

Coroutine system for async game logic within the synchronous game loop.

```typescript
export class Process {
  readonly completed: boolean;

  constructor(options: {
    update: (dt: number, elapsed: number) => boolean | void;
    onComplete?: () => void;
    duration?: number;
    loop?: boolean;
    tags?: string[];
  });

  pause(): void;
  resume(): void;
  cancel(): void;
  toPromise(): Promise<void>;

  /**
   * Advance the process by dt milliseconds. Called internally by the
   * process manager each frame. Exposed for unit testing.
   * @internal
   */
  _update(dt: number): void;

  /** Factory: create and auto-register with the current scene. */
  static spawn(scene: Scene, options: ProcessOptions): Process;
}

export class Tween {
  /** Tween a numeric value. */
  static to(
    target: object,
    property: string,
    to: number,
    duration: number,
    easing?: EasingFunction,
  ): Process;

  /** Tween using a custom setter. */
  static custom(
    setter: (value: number) => void,
    from: number,
    to: number,
    duration: number,
    easing?: EasingFunction,
  ): Process;

  /** Tween a Vec2. */
  static vec2(
    setter: (value: Vec2) => void,
    from: Vec2,
    to: Vec2,
    duration: number,
    easing?: EasingFunction,
  ): Process;
}

export class Sequence {
  private steps: Array<Process | (() => Process)> = [];

  /** Add a step. */
  then(step: Process | (() => Process)): this;

  /** Add a delay. */
  wait(ms: number): this;

  /** Add a callback (runs instantly). */
  call(fn: () => void): this;

  /** Run steps in parallel (all must complete before sequence continues). */
  parallel(...steps: Array<Process | (() => Process)>): this;

  /** Build and start the sequence, registering with the scene. */
  start(scene: Scene): Process;

  /**
   * Build the sequence into a Process without registering with a scene.
   * Exposed for unit testing.
   * @internal
   */
  _build(): Process;
}
```

### 2.13 Prefab

Declarative entity templates with a builder pattern.

```typescript
export class Prefab {
  private name: string;
  private tags: string[] = [];
  private components: Array<{ cls: ComponentClass; args: unknown[] }> = [];
  private children: Prefab[] = [];

  constructor(name: string);

  /** Add a tag. */
  tag(...tags: string[]): this;

  /** Add a component with constructor args. */
  with<C extends Component>(cls: ComponentClass<C>, ...args: ConstructorArgs<C>): this;

  /** Add a child prefab. */
  child(prefab: Prefab): this;

  /** Build the entity in a scene. */
  spawn(scene: Scene, overrides?: PrefabOverrides): Entity;
}

export interface PrefabOverrides {
  name?: string;
  tags?: string[];
  components?: Array<{ cls: ComponentClass; args: unknown[] }>;
}

// Usage example:
const EnemyPrefab = new Prefab('enemy')
  .tag('enemy', 'damageable')
  .with(SpriteComponent, 'enemy.png')
  .with(RigidBodyComponent, { type: 'dynamic' })
  .with(ColliderComponent, { shape: 'circle', radius: 16 })
  .with(HealthComponent, 100);
```

### 2.14 ErrorBoundary

Wraps system and component execution. On error, disables the offending component/system and logs the error. The game loop never crashes.

```typescript
export class ErrorBoundary {
  private logger: Logger;
  private disabledSystems: Set<System> = new Set();

  constructor(logger: Logger);

  /** Wrap a system update call. On throw, disables the system. */
  wrapSystem(system: System, fn: () => void): void;

  /** Wrap a component lifecycle call. On throw, disables the component. */
  wrapComponent(component: Component, fn: () => void): void;

  /** Get all disabled systems/components for inspection. */
  getDisabled(): { systems: readonly System[]; components: readonly Component[] };
}
```

### 2.15 Inspector

Programmatic state queries for testing and debugging. Exposed on `window.__yage__` in debug mode.

```typescript
export class Inspector {
  private engine: Engine;

  constructor(engine: Engine);

  /** Full state snapshot (serializable). */
  snapshot(): EngineSnapshot;

  /** Find entity by name in the active scene. */
  getEntityByName(name: string): EntitySnapshot | undefined;

  /** Get entity position (from Transform component). */
  getEntityPosition(name: string): { x: number; y: number } | undefined;

  /** Check if an entity has a component. */
  hasComponent(entityName: string, componentClass: string): boolean;

  /** Get component data (serializable subset). */
  getComponentData(entityName: string, componentClass: string): unknown;

  /** Get all entities in the active scene. */
  getEntities(): EntitySnapshot[];

  /** Get scene stack info. */
  getSceneStack(): SceneSnapshot[];

  /** Get active system info. */
  getSystems(): SystemSnapshot[];

  /** Get disabled components/systems from error boundary. */
  getErrors(): ErrorSnapshot;
}

export interface EngineSnapshot {
  frameCount: number;
  sceneStack: SceneSnapshot[];
  entityCount: number;
  systemCount: number;
  errors: ErrorSnapshot;
}

export interface EntitySnapshot {
  id: number;
  name: string;
  tags: string[];
  components: string[];
  position?: { x: number; y: number };
}

export interface SceneSnapshot {
  name: string;
  entityCount: number;
  paused: boolean;
}

export interface SystemSnapshot {
  name: string;
  phase: string;
  priority: number;
  enabled: boolean;
}

export interface ErrorSnapshot {
  disabledSystems: string[];
  disabledComponents: Array<{ entity: string; component: string; error: string }>;
}
```

### 2.16 Logger

Structured logging with levels, categories, and a ring buffer. Designed for both human reading and agent consumption.

```typescript
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  None = 4,
}

export interface LoggerConfig {
  level?: LogLevel;
  categories?: string[];        // Whitelist. Empty = all.
  bufferSize?: number;          // Ring buffer size (default: 500)
  output?: (entry: LogEntry) => void;  // Custom output handler
}

export interface LogEntry {
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
  timestamp: number;
  frame: number;
}

export class Logger {
  constructor(config?: LoggerConfig);

  debug(category: string, message: string, data?: unknown): void;
  info(category: string, message: string, data?: unknown): void;
  warn(category: string, message: string, data?: unknown): void;
  error(category: string, message: string, data?: unknown): void;

  /** Get recent log entries (from ring buffer). */
  getRecent(count?: number): LogEntry[];

  /** Format recent logs as structured text for agent consumption. */
  formatRecentLogs(count?: number): string;

  /** Clear the ring buffer. */
  clear(): void;
}
```

**Log format** for `formatRecentLogs()`:

```
[INFO][physics] f142 Collision detected {entity:"player", other:"enemy", started:true}
[WARN][render] f143 Sprite texture missing {entity:"particle_42", texture:"spark.png"}
[ERROR][core] f143 Component threw in onAdd {entity:"badEntity", component:"BrokenComponent", error:"Cannot read property 'x' of undefined"}
```

### 2.17 Vec2, Transform, MathUtils

```typescript
/** Immutable 2D vector. All operations return new instances. */
export class Vec2 {
  constructor(public readonly x: number, public readonly y: number);

  static readonly ZERO: Vec2;
  static readonly ONE: Vec2;
  static readonly UP: Vec2;    // (0, -1)
  static readonly DOWN: Vec2;  // (0, 1)
  static readonly LEFT: Vec2;  // (-1, 0)
  static readonly RIGHT: Vec2; // (1, 0)

  add(other: Vec2): Vec2;
  sub(other: Vec2): Vec2;
  scale(scalar: number): Vec2;
  dot(other: Vec2): number;
  cross(other: Vec2): number;
  length(): number;
  lengthSq(): number;
  normalize(): Vec2;
  distance(other: Vec2): number;
  distanceSq(other: Vec2): number;
  lerp(other: Vec2, t: number): Vec2;
  angle(): number;
  rotate(radians: number): Vec2;
  equals(other: Vec2, epsilon?: number): boolean;
  toString(): string;

  static fromAngle(radians: number, length?: number): Vec2;
  static distance(a: Vec2, b: Vec2): number;
  static lerp(a: Vec2, b: Vec2, t: number): Vec2;
}

/** Mutable transform for entity positioning. */
export class Transform extends Component {
  position: Vec2;
  rotation: number;         // Radians
  scale: Vec2;

  constructor(options?: { position?: Vec2; rotation?: number; scale?: Vec2 });

  /** Set position. */
  setPosition(x: number, y: number): void;

  /** Translate by offset. */
  translate(dx: number, dy: number): void;

  /** Set rotation in radians. */
  setRotation(radians: number): void;

  /** Rotate by delta. */
  rotate(deltaRadians: number): void;

  /** Set scale. */
  setScale(x: number, y: number): void;
}

export const MathUtils = {
  lerp(a: number, b: number, t: number): number,
  clamp(value: number, min: number, max: number): number,
  remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number,
  randomRange(min: number, max: number): number,
  randomInt(min: number, max: number): number,
  degToRad(degrees: number): number,
  radToDeg(radians: number): number,
  approach(current: number, target: number, step: number): number,
  wrap(value: number, min: number, max: number): number,
} as const;
```

---

## 3. Renderer Plugin (`@yage/renderer`)

### 3.1 RendererPlugin

```typescript
import { Plugin, ServiceKey, Phase } from '@yage/core';
import { Application, Container } from 'pixi.js';

export const RendererKey = new ServiceKey<RendererPlugin>('renderer');
export const StageKey = new ServiceKey<Container>('stage');
export const CameraKey = new ServiceKey<Camera>('camera');

export interface RendererConfig {
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
  /** Virtual resolution width (game coordinates). */
  virtualWidth?: number;
  /** Virtual resolution height (game coordinates). */
  virtualHeight?: number;
  /** Background color. */
  backgroundColor?: number;
  /** Existing canvas element (optional). */
  canvas?: HTMLCanvasElement;
  /** PixiJS application options pass-through. */
  pixi?: Partial<ApplicationOptions>;
}

export class RendererPlugin implements Plugin {
  readonly name = 'renderer';
  readonly version = '2.0.0';

  private app!: Application;
  private config: RendererConfig;

  constructor(config: RendererConfig);

  async install(context: EngineContext): Promise<void>;
  registerSystems(scheduler: SystemScheduler): void;
  onStart(): void;
  onDestroy(): void;

  /** The PixiJS Application instance. */
  get application(): Application;

  /** The HTML canvas element. */
  get canvas(): HTMLCanvasElement;

  /** Virtual resolution (game coordinate space). */
  get virtualSize(): { width: number; height: number };
}
```

### 3.2 Components

```typescript
export class SpriteComponent extends Component {
  sprite: Sprite;
  layer: number;

  constructor(options: {
    texture: string | Texture;
    anchor?: { x: number; y: number };
    layer?: number;
    visible?: boolean;
    tint?: number;
    alpha?: number;
  });
}

export class GraphicsComponent extends Component {
  graphics: Graphics;
  layer: number;

  constructor(options?: { layer?: number });

  /** Access the PixiJS Graphics for drawing. */
  draw(fn: (g: Graphics) => void): void;
}

export class AnimatedSpriteComponent extends Component {
  animatedSprite: AnimatedSprite;
  layer: number;

  constructor(options: {
    spritesheet: string | Spritesheet;
    layer?: number;
  });

  play(animation: string, options?: {
    speed?: number;
    loop?: boolean;
    onComplete?: () => void;
  }): void;

  stop(): void;
  get currentAnimation(): string | null;
  get isPlaying(): boolean;
}
```

### 3.3 Camera

```typescript
export class Camera {
  position: Vec2;
  zoom: number;
  rotation: number;
  bounds?: { x: number; y: number; width: number; height: number };

  /** Follow an entity with optional deadzone and smoothing. */
  follow(entity: Entity, options?: {
    deadzone?: { width: number; height: number };
    smoothing?: number;  // 0-1, lower = smoother
    offset?: Vec2;
  }): void;

  /** Stop following. */
  unfollow(): void;

  /** Apply screen shake. */
  shake(intensity: number, duration: number, options?: {
    frequency?: number;
    decay?: boolean;
  }): void;

  /** Smoothly zoom to a target level. */
  zoomTo(target: number, duration: number, easing?: EasingFunction): void;

  /** Convert screen coordinates to world coordinates. */
  screenToWorld(screenX: number, screenY: number): Vec2;

  /** Convert world coordinates to screen coordinates. */
  worldToScreen(worldX: number, worldY: number): Vec2;

  /** Update camera (called by DisplaySystem). */
  update(dt: number): void;
}
```

### 3.4 DisplaySystem

Syncs Transform components to PixiJS display objects. Runs in the Render phase.

```typescript
export class DisplaySystem extends System {
  readonly phase = Phase.Render;
  readonly priority = 0;

  update(dt: number): void;
  // For each entity with Transform + any renderable component:
  //   1. Read Transform position, rotation, scale
  //   2. Apply to the PixiJS display object
  //   3. Apply Camera transform to the stage container
}
```

### 3.5 RenderLayer

Named layers for draw order control.

```typescript
export class RenderLayer {
  readonly name: string;
  readonly order: number;     // Lower = drawn first (behind)
  readonly container: Container;

  constructor(name: string, order: number);
}

// Usage in RendererPlugin:
// Layers are created via config and accessible via RendererPlugin.getLayer(name)
```

---

## 4. Physics Plugin (`@yage/physics`)

### 4.1 PhysicsPlugin

```typescript
import { Plugin, ServiceKey, Phase } from '@yage/core';

export const PhysicsWorldKey = new ServiceKey<PhysicsWorld>('physicsWorld');

export interface PhysicsConfig {
  /** Gravity in pixels/s^2. Default: { x: 0, y: 980 } */
  gravity?: { x: number; y: number };
  /** Pixels per meter for Rapier. Users never see this. Default: 50. */
  pixelsPerMeter?: number;
}

export class PhysicsPlugin implements Plugin {
  readonly name = 'physics';
  readonly version = '2.0.0';

  constructor(config?: PhysicsConfig);

  async install(context: EngineContext): Promise<void>;
  registerSystems(scheduler: SystemScheduler): void;
  onDestroy(): void;
}
```

### 4.2 PhysicsWorld

Internal coordinate conversion. Users work in pixels everywhere; Rapier works in meters internally.

```typescript
export class PhysicsWorld {
  private world: World;
  private eventQueue: EventQueue;
  private pixelsPerMeter: number;
  private bodyMap: Map<number, Entity> = new Map();
  private colliderMap: Map<number, Entity> = new Map();

  constructor(config: PhysicsConfig);

  /** Convert pixels to meters (internal use). */
  toMeters(pixels: number): number;

  /** Convert meters to pixels (internal use). */
  toPixels(meters: number): number;

  /** Step the physics simulation. Called by PhysicsSystem. */
  step(dt: number): void;

  /** Drain collision events and dispatch to handlers. */
  processCollisionEvents(): void;

  /** Cast a ray. Returns results in pixel coordinates. */
  raycast(origin: Vec2, direction: Vec2, maxDistance: number, options?: {
    layers?: number;
    excludeEntity?: Entity;
  }): RaycastHit | null;

  /** Set gravity in pixels/s^2. */
  setGravity(x: number, y: number): void;

  /** Internal: register a rigid body, returns the Rapier body handle. */
  createBody(entity: Entity, desc: RigidBodyConfig): number;

  /** Internal: register a collider on a body. */
  createCollider(entity: Entity, bodyHandle: number, desc: ColliderConfig): number;

  /** Internal: remove a body and its colliders. */
  removeBody(handle: number): void;

  destroy(): void;
}

export interface RaycastHit {
  entity: Entity;
  point: Vec2;
  normal: Vec2;
  distance: number;
}
```

### 4.3 Components

```typescript
export type BodyType = 'dynamic' | 'static' | 'kinematic';

export interface RigidBodyConfig {
  type: BodyType;
  /** Linear damping. */
  linearDamping?: number;
  /** Angular damping. */
  angularDamping?: number;
  /** Lock rotation. */
  fixedRotation?: boolean;
  /** Gravity scale (0 = no gravity). */
  gravityScale?: number;
  /** Continuous collision detection. */
  ccd?: boolean;
}

export class RigidBodyComponent extends Component {
  constructor(config: RigidBodyConfig);

  /** Body type. */
  readonly type: BodyType;

  /** Apply force at center of mass (pixels/s^2). */
  applyForce(force: Vec2): void;

  /** Apply impulse at center of mass (pixels/s). */
  applyImpulse(impulse: Vec2): void;

  /** Set linear velocity directly (pixels/s). */
  setVelocity(velocity: Vec2): void;

  /** Get current linear velocity (pixels/s). */
  getVelocity(): Vec2;

  /** Apply torque. */
  applyTorque(torque: number): void;

  /** Set angular velocity. */
  setAngularVelocity(velocity: number): void;

  /** Get angular velocity. */
  getAngularVelocity(): number;

  /** Teleport the body (for kinematic). */
  setPosition(x: number, y: number): void;
}

export type ColliderShape =
  | { type: 'box'; width: number; height: number }
  | { type: 'circle'; radius: number }
  | { type: 'capsule'; halfHeight: number; radius: number }
  | { type: 'polygon'; vertices: Vec2[] };

export interface ColliderConfig {
  shape: ColliderShape;
  /** Offset from body center in pixels. */
  offset?: Vec2;
  /** Bounciness. 0-1. */
  restitution?: number;
  /** Friction. 0-1. */
  friction?: number;
  /** Density (affects mass). */
  density?: number;
  /** Is this a sensor (trigger)? */
  sensor?: boolean;
  /** Collision layer membership (bitmask). */
  layers?: number;
  /** Collision layer filter (bitmask). */
  mask?: number;
}

export class ColliderComponent extends Component {
  constructor(config: ColliderConfig);

  /** Listen for collision start/end events. */
  onCollision(handler: (event: CollisionEvent) => void): () => void;

  /** Listen for sensor trigger events. */
  onTrigger(handler: (event: TriggerEvent) => void): () => void;

  /** Update collider shape at runtime. */
  setShape(shape: ColliderShape): void;

  /** Update sensor flag. */
  setSensor(sensor: boolean): void;
}

export interface CollisionEvent {
  other: Entity;
  otherCollider: ColliderComponent;
  started: boolean;      // true = contact began, false = contact ended
  contactNormal?: Vec2;  // Only present on start
  contactPoint?: Vec2;   // Only present on start
}

export interface TriggerEvent {
  other: Entity;
  otherCollider: ColliderComponent;
  entered: boolean;      // true = entered, false = exited
}
```

**Key design decision**: `RigidBodyComponent` and `ColliderComponent` are separate. An entity can have one `RigidBodyComponent` and multiple `ColliderComponent`s. This matches Rapier's model and allows compound colliders (e.g., a character with a body collider and a ground-check sensor).

For multiple colliders, `ColliderComponent` supports array-style usage:

```typescript
// Entity with compound colliders
const entity = scene.spawn('player');
entity.add(new Transform({ position: new Vec2(100, 200) }));
entity.add(new RigidBodyComponent({ type: 'dynamic' }));
entity.add(new ColliderComponent({
  shape: { type: 'capsule', halfHeight: 16, radius: 8 },
}));
// Additional sensor for ground detection stored separately
const groundSensor = new ColliderComponent({
  shape: { type: 'box', width: 12, height: 4 },
  offset: new Vec2(0, 20),
  sensor: true,
});
// Since Entity stores one component per class, we use a tagged approach:
// groundSensor gets added to a GroundSensorComponent subclass or a separate entity.
```

> Note: For the compound collider pattern, the recommended approach is either subclassing `ColliderComponent` for specialized sensors (e.g., `class GroundSensor extends ColliderComponent`) or using a dedicated child entity.

### 4.4 Systems

```typescript
export class PhysicsSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 0;

  update(fixedDt: number): void;
  // 1. Sync Transform → Rapier bodies (for kinematic/teleported entities)
  // 2. Step Rapier world
  // 3. Sync Rapier bodies → Transform (for dynamic entities)
  // 4. Process collision events → dispatch to ColliderComponent handlers
}

export class PhysicsInterpolationSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 100;  // Runs after other LateUpdate systems

  update(dt: number): void;
  // Interpolates Transform between previous and current physics state
  // for smooth rendering at variable frame rates.
}
```

### 4.5 Collision Layers

```typescript
export class CollisionLayers {
  private names: Map<string, number> = new Map();

  /** Define a named layer. Layer numbers are auto-assigned (powers of 2). */
  define(name: string): number;

  /** Get bitmask for a layer name. */
  get(name: string): number;

  /** Combine multiple layer names into a bitmask. */
  combine(...names: string[]): number;
}

// Usage:
const layers = new CollisionLayers();
const PLAYER = layers.define('player');
const ENEMY = layers.define('enemy');
const GROUND = layers.define('ground');
const PROJECTILE = layers.define('projectile');

// Player collides with enemy and ground
entity.add(new ColliderComponent({
  shape: { type: 'capsule', halfHeight: 16, radius: 8 },
  layers: PLAYER,
  mask: layers.combine('enemy', 'ground'),
}));
```

---

## 5. Input Plugin (`@yage/input`)

### 5.1 InputPlugin

```typescript
export const InputManagerKey = new ServiceKey<InputManager>('inputManager');

export class InputPlugin implements Plugin {
  readonly name = 'input';
  readonly version = '2.0.0';

  constructor(config?: InputConfig);

  async install(context: EngineContext): Promise<void>;
  registerSystems(scheduler: SystemScheduler): void;
  onDestroy(): void;
}

export interface InputConfig {
  /** Target element for event listeners (default: canvas or document). */
  target?: HTMLElement;
  /** Action map definition. */
  actions?: ActionMapDefinition;
  /** Keys to preventDefault on (default: none). */
  preventDefaultKeys?: string[];
  /** Gamepad deadzone (default: 0.15). */
  gamepadDeadzone?: number;
}
```

### 5.2 InputManager

```typescript
export class InputManager {
  /** Check if an action is currently held. */
  isPressed(action: string): boolean;

  /** Check if an action was pressed this frame. */
  isJustPressed(action: string): boolean;

  /** Check if an action was released this frame. */
  isJustReleased(action: string): boolean;

  /** Get the hold duration of an action in ms. Returns 0 if not held. */
  getHoldDuration(action: string): number;

  /** Check if action has been held for at least minTime ms. */
  isHeldFor(action: string, minTime: number): boolean;

  /** Get axis value (-1 to 1). */
  getAxis(action: string): number;

  /** Get 2D axis vector (for movement). */
  getVector(horizontal: string, vertical: string): Vec2;

  /** Get mouse/touch position in world coordinates. */
  getPointerPosition(): Vec2;

  /** Get mouse/touch position in screen coordinates. */
  getPointerScreenPosition(): Vec2;

  /** Is a pointer (mouse/touch) currently active? */
  isPointerDown(): boolean;

  /** Get connected gamepads. */
  getGamepads(): GamepadState[];

  /** Update action map at runtime. */
  setActionMap(actions: ActionMapDefinition): void;

  /** Add/remove specific key from an action at runtime. */
  bindKey(action: string, key: string): void;
  unbindKey(action: string, key: string): void;
}

export interface ActionMapDefinition {
  [actionName: string]: string[];
  // Example:
  // {
  //   jump: ['Space', 'KeyW', 'GamepadA'],
  //   moveLeft: ['KeyA', 'ArrowLeft', 'GamepadLeftStickLeft'],
  //   moveRight: ['KeyD', 'ArrowRight', 'GamepadLeftStickRight'],
  //   fire: ['MouseLeft', 'GamepadRightTrigger'],
  // }
}

export interface GamepadState {
  index: number;
  id: string;
  connected: boolean;
  axes: number[];
  buttons: boolean[];
}
```

### 5.3 InputSystem

```typescript
export class InputSystem extends System {
  readonly phase = Phase.EarlyUpdate;
  readonly priority = -100; // Runs first

  update(dt: number): void;
  // 1. Poll gamepad state
  // 2. Update "just pressed" / "just released" flags
  // 3. Update hold timers
  // At end of frame (EndOfFrame phase), clear per-frame flags
}
```

**Key design decision**: Input is centralized in `InputManager`, not per-entity. This matches how real games work -- you check input state and act on it in your systems, rather than attaching input listeners to individual entities. The v1 `InputComponent` pattern (per-entity `Map<string, string[]>`) is replaced by a single action map.

---

## 6. Audio Plugin (`@yage/audio`)

### 6.1 AudioPlugin

```typescript
export const AudioManagerKey = new ServiceKey<AudioManager>('audioManager');

export class AudioPlugin implements Plugin {
  readonly name = 'audio';
  readonly version = '2.0.0';

  constructor(config?: AudioConfig);

  async install(context: EngineContext): Promise<void>;
  onDestroy(): void;
}

export interface AudioConfig {
  /** Channel definitions. Default: { sfx: { volume: 1 }, music: { volume: 0.7 } } */
  channels?: Record<string, { volume: number }>;
}
```

### 6.2 AudioManager

```typescript
export class AudioManager {
  /** Play a sound on a channel. */
  play(alias: string, options?: {
    channel?: string;    // Default: 'sfx'
    volume?: number;     // Override channel volume
    loop?: boolean;
    speed?: number;
  }): SoundHandle;

  /** Play a random sound from a list. */
  playRandom(aliases: string[], options?: PlayOptions): SoundHandle;

  /** Stop a specific sound. */
  stop(handle: SoundHandle): void;

  /** Stop all sounds on a channel. */
  stopChannel(channel: string): void;

  /** Stop all sounds. */
  stopAll(): void;

  /** Set channel volume (0-1). */
  setChannelVolume(channel: string, volume: number): void;

  /** Get channel volume. */
  getChannelVolume(channel: string): number;

  /** Mute/unmute a channel. */
  setChannelMuted(channel: string, muted: boolean): void;

  /** Global mute. */
  setMasterMuted(muted: boolean): void;

  /** Pause/resume a channel (e.g., pause music during menu). */
  pauseChannel(channel: string): void;
  resumeChannel(channel: string): void;
}

export interface SoundHandle {
  readonly id: number;
  readonly playing: boolean;
  stop(): void;
  pause(): void;
  resume(): void;
  setVolume(volume: number): void;
}
```

### 6.3 SoundComponent

For entity-bound audio (e.g., a coin pickup sound when the coin is collected).

```typescript
export class SoundComponent extends Component {
  constructor(options: {
    alias: string;
    channel?: string;
    playOnAdd?: boolean;
    loop?: boolean;
    volume?: number;
  });

  play(): SoundHandle;
  stop(): void;
}
```

---

## 7. Other Plugins

### 7.1 Particles Plugin (`@yage/particles`)

```typescript
export class ParticlesPlugin implements Plugin {
  readonly name = 'particles';
  readonly dependencies = ['renderer'];
  // ...
}

export class ParticleEmitterComponent extends Component {
  constructor(config: EmitterConfig);

  emit(): void;
  stop(): void;
  burst(count: number): void;
  get isEmitting(): boolean;
}

export class ParticleSystem extends System {
  readonly phase = Phase.Update;
  // Updates all active particle emitters
}
```

### 7.2 Tilemap Plugin (`@yage/tilemap`)

```typescript
export class TilemapPlugin implements Plugin {
  readonly name = 'tilemap';
  readonly dependencies = ['renderer'];
  // ...
}

export class TilemapComponent extends Component {
  constructor(options: {
    /** Path to Tiled JSON map file. */
    map: string | TiledMap;
    /** Layer to render. */
    layers?: string[];
  });

  /** Get tile at world position. */
  getTileAt(x: number, y: number, layer?: string): Tile | null;

  /** Get collision shapes from object layers. */
  getCollisionShapes(): ColliderConfig[];
}
```

### 7.3 UI Plugin (`@yage/ui`)

```typescript
export class UIPlugin implements Plugin {
  readonly name = 'ui';
  readonly dependencies = ['renderer'];
  // ...
}

export class UIRootComponent extends Component {
  constructor(options?: {
    /** Anchor point (default: top-left). */
    anchor?: 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    /** Layout direction. */
    direction?: 'row' | 'column';
    /** Gap between children in pixels. */
    gap?: number;
    /** Padding. */
    padding?: number | { top: number; right: number; bottom: number; left: number };
  });

  addChild(child: UIElement): void;
  removeChild(child: UIElement): void;
}

export class UITextElement extends Component implements UIElement {
  constructor(text: string, style?: TextStyle);
  setText(text: string): void;
}

export class UIButtonElement extends Component implements UIElement {
  constructor(label: string, onClick: () => void, style?: ButtonStyle);
  setLabel(label: string): void;
  setEnabled(enabled: boolean): void;
}

export class UIPanelElement extends Component implements UIElement {
  constructor(options?: PanelStyle);
  addChild(child: UIElement): void;
}
```

### 7.4 Debug Plugin (`@yage/debug`)

```typescript
export class DebugPlugin implements Plugin {
  readonly name = 'debug';
  readonly dependencies = ['renderer'];
  // ...
}

export interface DebugConfig {
  /** Show FPS counter. */
  fps?: boolean;
  /** Show entity count. */
  entityCount?: boolean;
  /** Draw physics collider shapes. */
  physicsShapes?: boolean;
  /** Draw entity labels. */
  entityLabels?: boolean;
  /** Show system timing. */
  systemTiming?: boolean;
  /** Toggle key (default: F12). */
  toggleKey?: string;
}
```

---

## 8. API Sketches

### 8.1 Creating an Engine and Loading a Scene

```typescript
import { Engine, Scene, Transform, Vec2 } from '@yage/core';
import { RendererPlugin, SpriteComponent } from '@yage/renderer';
import { InputPlugin } from '@yage/input';

// Create engine with plugins
const engine = new Engine({ debug: true });

engine
  .use(new RendererPlugin({
    width: 800,
    height: 600,
    virtualWidth: 400,
    virtualHeight: 300,
    backgroundColor: 0x1a1a2e,
  }))
  .use(new InputPlugin({
    actions: {
      moveLeft: ['KeyA', 'ArrowLeft'],
      moveRight: ['KeyD', 'ArrowRight'],
      jump: ['Space', 'KeyW', 'ArrowUp'],
    },
  }));

// Define a scene
class GameScene extends Scene {
  readonly name = 'game';

  onEnter() {
    const player = this.spawn('player');
    player.add(new Transform({ position: new Vec2(200, 150) }));
    player.add(new SpriteComponent({ texture: 'hero.png' }));
  }
}

// Start
await engine.start();
engine.scenes.push(new GameScene());
```

### 8.2 Bouncing Ball (Complete Example, <10 Lines of User Code)

```typescript
import { Engine, Scene, Transform, Vec2 } from '@yage/core';
import { RendererPlugin, GraphicsComponent } from '@yage/renderer';
import { PhysicsPlugin, RigidBodyComponent, ColliderComponent } from '@yage/physics';

const engine = new Engine();
engine.use(new RendererPlugin({ width: 800, height: 600, backgroundColor: 0x1a1a2e }));
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));

class BounceScene extends Scene {
  readonly name = 'bounce';

  onEnter() {
    // Ball
    const ball = this.spawn('ball');
    ball.add(new Transform({ position: new Vec2(400, 100) }));
    ball.add(new RigidBodyComponent({ type: 'dynamic' }));
    ball.add(new ColliderComponent({ shape: { type: 'circle', radius: 20 }, restitution: 0.8 }));
    ball.add(new GraphicsComponent()).draw(g => g.circle(0, 0, 20).fill(0xffffff));

    // Floor
    const floor = this.spawn('floor');
    floor.add(new Transform({ position: new Vec2(400, 580) }));
    floor.add(new RigidBodyComponent({ type: 'static' }));
    floor.add(new ColliderComponent({ shape: { type: 'box', width: 800, height: 40 } }));
    floor.add(new GraphicsComponent()).draw(g => g.rect(-400, -20, 800, 40).fill(0x333333));
  }
}

await engine.start();
engine.scenes.push(new BounceScene());
```

Compare this to the v1 equivalent which required `pu()` conversion, `RigidBodyDesc`/`ColliderDesc` from Rapier directly, `Executor.execute()`, a `Game` wrapper, `GraphicComponent` with linked transforms, and `Vector2` imports from Rapier.

### 8.3 Custom System

```typescript
import { System, Phase, Entity, Transform, Vec2 } from '@yage/core';
import { InputManagerKey } from '@yage/input';
import { RigidBodyComponent } from '@yage/physics';

class PlayerMovementSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 10;

  private query!: QueryResult;
  private input!: InputManager;

  onRegister(context: EngineContext) {
    this.query = context.resolve(QueryCacheKey).register([Transform, RigidBodyComponent]);
    this.input = context.resolve(InputManagerKey);
  }

  update(dt: number) {
    for (const entity of this.query) {
      if (!entity.tags.has('player')) continue;

      const body = entity.get(RigidBodyComponent);
      const moveX = this.input.getAxis('moveRight') - this.input.getAxis('moveLeft');

      body.setVelocity(new Vec2(moveX * 200, body.getVelocity().y));

      if (this.input.isJustPressed('jump')) {
        body.applyImpulse(new Vec2(0, -300));
      }
    }
  }
}
```

### 8.4 Scene Stacking (HUD Overlay)

```typescript
class GameScene extends Scene {
  readonly name = 'game';
  readonly pauseBelow = true;

  onEnter() {
    // ... spawn game entities
  }
}

class HUDScene extends Scene {
  readonly name = 'hud';
  readonly pauseBelow = false;       // Game scene keeps running
  readonly transparentBelow = true;  // Game scene still renders

  onEnter() {
    const scoreText = this.spawn('score');
    scoreText.add(new Transform({ position: new Vec2(10, 10) }));
    scoreText.add(new UITextElement('Score: 0', { fill: 0xffffff, fontSize: 24 }));
  }
}

class PauseScene extends Scene {
  readonly name = 'pause';
  readonly pauseBelow = true;        // Game freezes
  readonly transparentBelow = true;  // Game still visible behind

  onEnter() {
    const label = this.spawn('pauseLabel');
    label.add(new Transform({ position: new Vec2(200, 150) }));
    label.add(new UITextElement('PAUSED', { fill: 0xffffff, fontSize: 48 }));
  }
}

// Usage:
engine.scenes.push(new GameScene());  // Stack: [Game]
engine.scenes.push(new HUDScene());   // Stack: [Game, HUD] -- both run, both render
engine.scenes.push(new PauseScene()); // Stack: [Game, HUD, Pause] -- Game+HUD paused but visible
engine.scenes.pop();                  // Stack: [Game, HUD] -- Game+HUD resume
```

### 8.5 Prefabs

```typescript
import { Prefab, Transform, Vec2 } from '@yage/core';
import { SpriteComponent } from '@yage/renderer';
import { RigidBodyComponent, ColliderComponent } from '@yage/physics';

const CoinPrefab = new Prefab('coin')
  .tag('coin', 'collectible')
  .with(Transform)
  .with(SpriteComponent, { texture: 'coin.png' })
  .with(RigidBodyComponent, { type: 'static' })
  .with(ColliderComponent, { shape: { type: 'circle', radius: 8 }, sensor: true });

// Spawn many coins
class LevelScene extends Scene {
  readonly name = 'level';

  onEnter() {
    const coinPositions = [
      new Vec2(100, 200),
      new Vec2(150, 200),
      new Vec2(200, 200),
    ];

    for (const pos of coinPositions) {
      this.spawnPrefab(CoinPrefab, {
        components: [{ cls: Transform, args: [{ position: pos }] }],
      });
    }
  }
}
```

### 8.6 Process/Tween Chaining

```typescript
import { Sequence, Tween, Process } from '@yage/core';

// Animate a door opening sequence
new Sequence()
  .call(() => console.log('Door opening...'))
  .then(Tween.to(doorTransform, 'rotation', Math.PI / 2, 500, 'easeOutQuad'))
  .wait(200)
  .parallel(
    Tween.custom(v => light.setIntensity(v), 0, 1, 300),
    Tween.custom(v => sound.setVolume(v), 0, 0.8, 300),
  )
  .call(() => console.log('Door opened!'))
  .start(scene);

// Simple tween with promise
await Tween.to(sprite, 'alpha', 0, 1000, 'easeInQuad').toPromise();
```

### 8.7 Collision Handling

```typescript
class CoinCollectionSystem extends System {
  readonly phase = Phase.Update;

  private query!: QueryResult;

  onRegister(context: EngineContext) {
    this.query = context.resolve(QueryCacheKey).register([ColliderComponent]);
  }

  update(dt: number) {
    for (const entity of this.query) {
      if (!entity.tags.has('coin')) continue;

      const collider = entity.get(ColliderComponent);
      collider.onCollision(event => {
        if (event.started && event.other.tags.has('player')) {
          // Play collect sound, add score, destroy coin
          entity.destroy();
        }
      });
    }
  }
}
```

> Note: In practice, collision listeners would be set up once (e.g., in a component's `onAdd` or a system's `onRegister`), not on every frame. The example above is simplified. A more idiomatic pattern:

```typescript
class CollectibleComponent extends Component {
  onAdd() {
    const collider = this.entity.get(ColliderComponent);
    collider.onCollision(event => {
      if (event.started && event.other.tags.has('player')) {
        this.entity.destroy();
      }
    });
  }
}
```

### 8.8 Inspector API (for Playwright Tests)

```typescript
// In-browser (debug mode)
const inspector = window.__yage__.inspector;

// Get full snapshot
const snapshot = inspector.snapshot();
console.log(snapshot.entityCount, snapshot.sceneStack);

// Check entity state
const player = inspector.getEntityByName('player');
console.log(player?.position);    // { x: 200, y: 150 }
console.log(player?.components);  // ['Transform', 'SpriteComponent', 'RigidBodyComponent', 'ColliderComponent']

// In Playwright test
test('ball falls to floor', async ({ page }) => {
  await page.goto('/examples/bouncing-ball');
  await page.waitForTimeout(2000);

  const pos = await page.evaluate(() =>
    window.__yage__.inspector.getEntityPosition('ball')
  );

  expect(pos!.y).toBeGreaterThan(400);  // Ball has fallen
});
```

### 8.9 Structured Logging

```typescript
// Engine setup
const engine = new Engine({
  debug: true,
  logger: {
    level: LogLevel.Debug,
    categories: ['physics', 'input', 'core'],
    bufferSize: 1000,
  },
});

// In a system
class EnemyAI extends System {
  update(dt: number) {
    const logger = this.context.resolve(LoggerKey);
    logger.info('ai', 'Enemy spotted player', { enemy: 'goblin_1', distance: 45.2 });
  }
}

// Read logs programmatically (Playwright)
const logs = await page.evaluate(() =>
  window.__yage__.logger.formatRecentLogs(20)
);
// Output:
// [INFO][ai] f142 Enemy spotted player {enemy:"goblin_1", distance:45.2}
// [INFO][physics] f142 Collision detected {a:"player", b:"goblin_1"}
```

---

## 9. v1 Pain Point Resolution Table

Every pain point from [PAIN_POINTS.md](../../PAIN_POINTS.md) mapped to its v2 solution.

### Architecture & Design

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 1 | **No enabled check in component lifecycle dispatch** -- disabled components still receive lifecycle calls | Components have no lifecycle update methods. Systems query and iterate; `ErrorBoundary.wrapComponent` checks `component.enabled` before invoking any callback. Disabled components are never called. |
| 2 | **Async `onAfterTick` via `setTimeout(..., 0)`** -- deferred execution causes ordering bugs | All game loop phases are synchronous. `endOfFrame` is a proper phase, not a setTimeout. No async in the game loop. |
| 3 | **`onAfterFixedTick` called inside `onFixedTick`** -- coupled lifecycle steps | Phases are distinct and scheduled by `SystemScheduler`. FixedUpdate systems complete fully before the next phase. No implicit coupling. |
| 4 | **Global mutable context via Executor** -- fragile singleton, stale refs in async | `EngineContext` DI container replaces `Executor`. No global state. Systems receive context via `onRegister()`. All access is explicit. |

### Performance

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 5 | **No query caching** -- O(n) linear scans on every `getComponentBy*` call | `QueryCache` with incremental archetype tracking. Queries update only on component add/remove. Entity.get() is a Map lookup: O(1). |
| 6 | **Process mode filtering on every lifecycle hook** -- 6 full array filters per frame | `SceneManager` handles pause semantics at the scene level. Systems only iterate entities from active scenes. No per-frame filtering. |
| 7 | **No spatial partitioning** | Not in core (out of scope for v2.0), but `PhysicsWorld.raycast()` and Rapier's own spatial queries are exposed. A spatial hash plugin is a P2 candidate. |

### Missing Features

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 8 | **No mouse/touch/gamepad input** | `@yage/input` supports keyboard, mouse, touch, and gamepad with a unified action map. `getPointerPosition()`, `getVector()`, `getGamepads()`. |
| 9 | **No camera/viewport at engine level** | `Camera` class in `@yage/renderer` with follow, deadzone, zoom, shake, and bounds clamping. `screenToWorld()`/`worldToScreen()` conversion. |
| 10 | **No audio spatialization or scene-level audio management** | `AudioManager` with named channels (sfx, music, ambient), per-channel volume/mute/pause. Global master mute. |
| 11 | **No built-in collision event routing** -- infrastructure exists but isn't wired up | `PhysicsSystem` drains Rapier's event queue every fixed step and dispatches to `ColliderComponent.onCollision()` / `onTrigger()` handlers. Complete and working. |
| 12 | **No scene stacking or layering** | `SceneManager` with push/pop/replace stack. `pauseBelow` and `transparentBelow` flags per scene for overlay/HUD support. |
| 13 | **Node system is orphaned** | Removed entirely. No orphaned code in v2. |

### Developer Experience

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 14 | **No tests exist** | 100% unit test coverage on `@yage/core` (Vitest). Playwright E2E tests per plugin. CI runs all tests on every PR. |
| 15 | **`typedoc` not installed** | API docs generated via TypeDoc (properly installed) or TSDoc comments. All public APIs documented. |
| 16 | **Private `setup()`/`teardown()` pattern is confusing** | `Component` uses clear lifecycle: `onAdd()`, `onRemove()`, `onDestroy()`. No private setup/teardown. No confusion about extension points. |
| 17 | **PixiJS v7 lock-in** | v2 uses PixiJS v8 with its modern API (WebGPU-ready, new container model). |
| 18 | **XState v4 lock-in** | XState is removed from core. State machines can be added as user-land components using any FSM library. |
| 19 | **Mixed dependency placement** | Clean monorepo with proper dependency separation. Zero runtime deps in `@yage/core`. Each plugin declares its own deps. |

### Robustness

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 20 | **No error boundaries** -- one bad component crashes the game | `ErrorBoundary` wraps all system and component execution. On throw, the offending system/component is disabled, error is logged, game loop continues. |
| 21 | **`destroy()` can cause double-removal** -- bidirectional destroy calls | `Entity.destroy()` is one-way. The scene handles removal in `endOfFrame`. `isDestroyed` flag prevents double processing. No bidirectional calls. |
| 22 | **`preventDefault()` on all key events** -- breaks browser shortcuts | `InputPlugin` accepts `preventDefaultKeys` config. Only specified keys are prevented. No global capture. |

### Ergonomics (from real example analysis)

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 23 | **Massive physics boilerplate** -- 12+ lines for a physics sprite | 4 lines: `add(Transform)`, `add(RigidBodyComponent)`, `add(ColliderComponent)`, `add(SpriteComponent)`. No `pu()`, no raw Rapier types. |
| 24 | **Physics is mandatory even when unused** | Physics is in `@yage/physics`. If you don't install it, no WASM download, no physics world. Core has zero physics knowledge. |
| 25 | **InputComponent requires `Map` instead of plain object** | Action maps are plain objects: `{ jump: ['Space', 'KeyW'] }`. |
| 26 | **Constructor-only initialization** -- no declarative composition | `Prefab` builder pattern for declarative entity templates. `scene.spawn().add()` chain for simple cases. |
| 27 | **Verbose generics with no payoff** | No gratuitous generics. `Scene` is not generic. `Entity` is not generic. Components use concrete types. |
| 28 | **Inconsistent Scene state initialization** | `Scene` has no generic state parameter. Scene-specific state is stored as regular class properties. |
| 29 | **No example discovery or runner** | Examples have a shared dev server with URL routing (`/examples/bouncing-ball`, `/examples/platformer`, etc.). Index page lists all examples. |
| 30 | **`pu()` conversion is a constant tax** | `PhysicsWorld` handles pixel-to-meter internally. All user-facing APIs work in pixels. `pu()` does not exist in v2. |

### Missing Abstractions

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 31 | **No collision layers/masks** | `CollisionLayers` with named layer definitions and bitmask API. `ColliderComponent` accepts `layers` and `mask` config. |
| 32 | **No debug rendering** | `@yage/debug` plugin renders physics shapes, entity labels, FPS, entity count, and system timing as a toggleable overlay. |
| 33 | **No prefab or template system** | `Prefab` class with builder pattern, `scene.spawnPrefab()`, and override support. |
| 34 | **No UI layout system** | `@yage/ui` plugin with flex-inspired layout, anchoring, text, buttons, and panels. |
| 35 | **No screen shake or camera effects** | `Camera.shake()`, `Camera.zoomTo()`, `Camera.follow()` with deadzone and smoothing. |
| 36 | **No entity lifecycle events** | `EventBus` emits `entity:created`, `entity:destroyed`, `component:added`, `component:removed`. |

### Missing Core Features

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 37 | **No save/load or serialization** | P2 feature. Not in v2.0 scope. Inspector's `snapshot()` provides read-only serialization as a stepping stone. |
| 38 | **No plugin or middleware system** | Full plugin system with `Plugin` interface, dependency sorting, service registration, system registration, and lifecycle hooks. See [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md). |
| 39 | **No tween chaining or sequencing** | `Sequence` class with `then()`, `wait()`, `call()`, `parallel()`, chained into a single `Process`. |
| 40 | **No built-in pathfinding** | P2 feature. Not in v2.0 scope. |
| 41 | **No networking or multiplayer** | P2 feature. Not in v2.0 scope. |

### Self-Acknowledged Issues

| # | v1 Pain Point | v2 Resolution |
|---|---|---|
| 42 | **Dialogue system is "basic and hard to customize"** | Premade systems (dialogue, loading screens) are not in v2.0 core. They may appear as community plugins or examples. |
| 43 | **`// Memoize these?` comment on queries** | `QueryCache` fully solves this. The comment is gone because the problem is gone. |
| 44 | **Collision emitter never fires** | `PhysicsSystem` completes the collision pipeline. Events are dispatched to handlers. No dead code. |

---

## References

- [PRD.md](./PRD.md) -- Product Requirements Document
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) -- Phased build roadmap
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing and debugging approach
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system specification
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- AI agent development guide
- [PAIN_POINTS.md](../../PAIN_POINTS.md) -- v1 pain points catalog

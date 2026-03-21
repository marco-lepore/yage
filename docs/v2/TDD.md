# YAGE v2 -- Technical Design Document

## Table of Contents

1. [Monorepo Structure](#1-monorepo-structure)
2. [Core Kernel (`@yage/core`)](#2-core-kernel-yagecore)
3. [Renderer Plugin (`@yage/renderer`)](#3-renderer-plugin-yagerenderer)
4. [Physics Plugin (`@yage/physics`)](#4-physics-plugin-yagephysics)
5. [Input Plugin (`@yage/input`)](#5-input-plugin-yageinput)
6. [Audio Plugin (`@yage/audio`)](#6-audio-plugin-yageaudio)
7. [Other Plugins](#7-other-plugins)
   - 7.1 [Particles](#71-particles-plugin-yageparticles)
   - 7.2 [Tilemap](#72-tilemap-plugin-yagetilemap)
   - 7.3 [UI](#73-ui-plugin-yageui)
   - 7.4 [Debug](#74-debug-plugin-yagedebug)
   - 7.5 [Asset Management](#75-asset-management-yagecore)
   - 7.6 [Blueprint System](#76-blueprint-system-yagecore)
   - 7.7 [Entity Events](#77-entity-events-yagecore)
   - 7.8 [React UI](#78-react-ui-plugin-yageui-react)
   - 7.9 [Meta-Package](#79-meta-package-yage)
8. [API Sketches](#8-api-sketches)
9. [Design Decisions Table](#9-design-decisions-table)

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
│   │   │   ├── Blueprint.ts
│   │   │   ├── Blueprint.test.ts
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
│   ├── ui-react/             # @yage/ui-react - React UI integration
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
├── @yage/ui-react      → @yage/core, @yage/renderer, @yage/ui, react, react-dom
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

`@yage/core` has **zero runtime dependencies**. It defines the hybrid OOP + ECS kernel, game loop contract, scene management, event system, and all supporting infrastructure. It runs in any JavaScript environment (browser, Node.js, workers).

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
export const EngineKey = new ServiceKey<Engine>("engine");
export const EventBusKey = new ServiceKey<EventBus>("eventBus");
export const SceneManagerKey = new ServiceKey<SceneManager>("sceneManager");
export const LoggerKey = new ServiceKey<Logger>("logger");
export const InspectorKey = new ServiceKey<Inspector>("inspector");
export const QueryCacheKey = new ServiceKey<QueryCache>("queryCache");
export const ErrorBoundaryKey = new ServiceKey<ErrorBoundary>("errorBoundary");
export const GameLoopKey = new ServiceKey<GameLoop>("gameLoop");
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
export type ComponentClass<C extends Component = Component> = new (
  ...args: any[]
) => C;
```

### 2.4 Component

Base class with lifecycle hooks and optional per-frame update methods. Components are the primary authoring model — game developers write behavior in components. The built-in `ComponentUpdateSystem` calls update/fixedUpdate methods automatically.

```typescript
export abstract class Component {
  /** Set by the engine when added to an entity. */
  entity!: Entity;

  /** Whether this component is active. Disabled components are skipped by ComponentUpdateSystem. */
  enabled: boolean = true;

  /** Access the EngineContext from the entity's scene. */
  get context(): EngineContext;

  /** Called when the component is added to an entity. */
  onAdd?(): void;

  /** Called when the component is removed from an entity. */
  onRemove?(): void;

  /** Called when the component is destroyed (entity destroyed or component removed). */
  onDestroy?(): void;

  /** Called every frame by the built-in ComponentUpdateSystem. */
  update?(dt: number): void;

  /** Called every fixed timestep by the built-in ComponentUpdateSystem. */
  fixedUpdate?(dt: number): void;
}
```

**Key design decision**: Components CAN have per-frame update methods (`update`, `fixedUpdate`). The built-in `ComponentUpdateSystem` iterates all entities in the active scene and calls these methods on enabled components. This is the primary path for game logic. Systems are still used for engine plugins (physics, rendering, audio) that need efficient cross-entity queries via QueryCache, but game developers write Components by default. Disabled components are skipped by `ComponentUpdateSystem` checking `component.enabled` before invoking update/fixedUpdate.

### 2.5 System

Systems are the workhorses. Each System runs in a specific game loop phase, queries for entities matching a component signature, and operates on them.

```typescript
export enum Phase {
  EarlyUpdate = "earlyUpdate",
  FixedUpdate = "fixedUpdate",
  Update = "update",
  LateUpdate = "lateUpdate",
  Render = "render",
  EndOfFrame = "endOfFrame",
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
  "entity:created": { entity: Entity };
  "entity:destroyed": { entity: Entity };
  "component:added": { entity: Entity; component: Component };
  "component:removed": { entity: Entity; componentClass: ComponentClass };
  "scene:pushed": { scene: Scene };
  "scene:popped": { scene: Scene };
  "scene:replaced": { oldScene: Scene; newScene: Scene };
  "engine:started": void;
  "engine:stopped": void;
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

  /** Spawn a new entity from a blueprint template (deprecated). */
  spawn<P>(blueprint: Blueprint<P>, params: P): Entity;
  spawn(blueprint: Blueprint<void>): Entity;

  /** Spawn an entity subclass with setup params. */
  spawn<E extends Entity, P>(Class: new () => E & { setup(params: P): void }, params: P): E;
  /** Spawn an entity subclass without setup params. */
  spawn<E extends Entity>(Class: new () => E): E;

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

### 2.13 Blueprint (deprecated)

Reusable entity templates defined as build callbacks. Prefer entity subclasses with `setup()` and traits for new code.

```typescript
export interface Blueprint<P = void> {
  readonly name: string;
  build(entity: Entity, params: P): void;
}

export function defineBlueprint<P = void>(
  name: string,
  build: (entity: Entity, params: P) => void,
): Blueprint<P>;

// Usage example:
const EnemyBlueprint = defineBlueprint<{ hp: number }>(
  "enemy",
  (entity, params) => {
    entity.tags.add("enemy");
    entity.tags.add("damageable");
    entity.add(new SpriteComponent("enemy.png"));
    entity.add(new RigidBodyComponent({ type: "dynamic" }));
    entity.add(new ColliderComponent({ shape: "circle", radius: 16 }));
    entity.add(new HealthComponent(params.hp));
  },
);
```

### 2.14 Trait System

Traits declare discoverable, type-safe entity capabilities. The `@trait()` decorator enforces at compile time that the decorated Entity subclass implements all trait members. Traits are queryable at runtime via `hasTrait()`.

```typescript
/** Symbol key for storing trait set on class statics. */
export const TRAITS_KEY: unique symbol;

/** Phantom-typed token representing a trait. */
export class TraitToken<T> {
  readonly name: string;
  readonly symbol: symbol;
  declare readonly _type: T;
}

/** Create a typed trait token. */
export function defineTrait<T>(name: string): TraitToken<T>;

/** Class decorator that registers a trait on an Entity subclass.
 *  The type constraint enforces that the class implements all trait members. */
export function trait<Trait>(token: TraitToken<Trait>):
  <T extends new (...args: any[]) => Entity & Trait>(target: T, context: ClassDecoratorContext) => T;

// Parent traits are inherited by subclasses via prototype chain walk.
```

**Entity integration**:

```typescript
// Entity gains hasTrait() — a type guard
class Entity {
  hasTrait<T>(token: TraitToken<T>): this is this & T;
  setup?(params: unknown): void;  // optional lifecycle, called by spawn after scene wiring
}
```

**Usage**:

```typescript
const Interactable = defineTrait<{ interact(): void; priority: number }>(
  "Interactable",
);

@trait(Interactable)
class LightEntity extends Entity {
  priority = 4;
  setup({ x, y }: { x: number; y: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
  }
  interact() { /* toggle light */ }
}

// Spawning — params typed from setup()
const light = scene.spawn(LightEntity, { x: 100, y: 200 });

// Runtime discovery
if (entity.hasTrait(Interactable)) {
  entity.interact(); // narrowed type
}
```

### 2.15 ErrorBoundary

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
  getDisabled(): {
    systems: readonly System[];
    components: readonly Component[];
  };
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
  disabledComponents: Array<{
    entity: string;
    component: string;
    error: string;
  }>;
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
  categories?: string[]; // Whitelist. Empty = all.
  bufferSize?: number; // Ring buffer size (default: 500)
  output?: (entry: LogEntry) => void; // Custom output handler
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
import { Plugin, ServiceKey, Phase } from "@yage/core";
import { Application, Container } from "pixi.js";

export const RendererKey = new ServiceKey<RendererPlugin>("renderer");
export const StageKey = new ServiceKey<Container>("stage");
export const CameraKey = new ServiceKey<Camera>("camera");

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
  readonly name = "renderer";
  readonly version = "2.0.0";

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

  constructor(options: { spritesheet: string | Spritesheet; layer?: number });

  play(
    animation: string,
    options?: {
      speed?: number;
      loop?: boolean;
      onComplete?: () => void;
    },
  ): void;

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
  follow(
    entity: Entity,
    options?: {
      deadzone?: { width: number; height: number };
      smoothing?: number; // 0-1, lower = smoother
      offset?: Vec2;
    },
  ): void;

  /** Stop following. */
  unfollow(): void;

  /** Apply screen shake. */
  shake(
    intensity: number,
    duration: number,
    options?: {
      frequency?: number;
      decay?: boolean;
    },
  ): void;

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
  readonly order: number; // Lower = drawn first (behind)
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
import { Plugin, ServiceKey, Phase } from "@yage/core";

export const PhysicsWorldKey = new ServiceKey<PhysicsWorld>("physicsWorld");

export interface PhysicsConfig {
  /** Gravity in pixels/s^2. Default: { x: 0, y: 980 } */
  gravity?: { x: number; y: number };
  /** Pixels per meter for Rapier. Users never see this. Default: 50. */
  pixelsPerMeter?: number;
}

export class PhysicsPlugin implements Plugin {
  readonly name = "physics";
  readonly version = "2.0.0";

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
  raycast(
    origin: Vec2,
    direction: Vec2,
    maxDistance: number,
    options?: {
      layers?: number;
      excludeEntity?: Entity;
    },
  ): RaycastHit | null;

  /** Set gravity in pixels/s^2. */
  setGravity(x: number, y: number): void;

  /** Internal: register a rigid body, returns the Rapier body handle. */
  createBody(entity: Entity, desc: RigidBodyConfig): number;

  /** Internal: register a collider on a body. */
  createCollider(
    entity: Entity,
    bodyHandle: number,
    desc: ColliderConfig,
  ): number;

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
export type BodyType = "dynamic" | "static" | "kinematic";

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
  | { type: "box"; width: number; height: number }
  | { type: "circle"; radius: number }
  | { type: "capsule"; halfHeight: number; radius: number }
  | { type: "polygon"; vertices: Vec2[] };

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
  started: boolean; // true = contact began, false = contact ended
  contactNormal?: Vec2; // Only present on start
  contactPoint?: Vec2; // Only present on start
}

export interface TriggerEvent {
  other: Entity;
  otherCollider: ColliderComponent;
  entered: boolean; // true = entered, false = exited
}
```

**Key design decision**: `RigidBodyComponent` and `ColliderComponent` are separate. An entity can have one `RigidBodyComponent` and multiple `ColliderComponent`s. This matches Rapier's model and allows compound colliders (e.g., a character with a body collider and a ground-check sensor).

For multiple colliders, `ColliderComponent` supports array-style usage:

```typescript
// Entity with compound colliders
const entity = scene.spawn("player");
entity.add(new Transform({ position: new Vec2(100, 200) }));
entity.add(new RigidBodyComponent({ type: "dynamic" }));
entity.add(
  new ColliderComponent({
    shape: { type: "capsule", halfHeight: 16, radius: 8 },
  }),
);
// Additional sensor for ground detection stored separately
const groundSensor = new ColliderComponent({
  shape: { type: "box", width: 12, height: 4 },
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
  readonly priority = 100; // Runs after other LateUpdate systems

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
const PLAYER = layers.define("player");
const ENEMY = layers.define("enemy");
const GROUND = layers.define("ground");
const PROJECTILE = layers.define("projectile");

// Player collides with enemy and ground
entity.add(
  new ColliderComponent({
    shape: { type: "capsule", halfHeight: 16, radius: 8 },
    layers: PLAYER,
    mask: layers.combine("enemy", "ground"),
  }),
);
```

---

## 5. Input Plugin (`@yage/input`)

### 5.1 InputPlugin

```typescript
export const InputManagerKey = new ServiceKey<InputManager>("inputManager");

export class InputPlugin implements Plugin {
  readonly name = "input";
  readonly version = "2.0.0";

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

> **Note**: Gamepad support is planned but not yet implemented. The `getGamepads()`, `GamepadState`, and gamepad-related action map bindings (`GamepadA`, `GamepadLeftStickLeft`, etc.) are defined in the API but not yet wired up.

---

## 6. Audio Plugin (`@yage/audio`)

### 6.1 AudioPlugin

```typescript
export const AudioManagerKey = new ServiceKey<AudioManager>("audioManager");

export class AudioPlugin implements Plugin {
  readonly name = "audio";
  readonly version = "2.0.0";

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
  play(
    alias: string,
    options?: {
      channel?: string; // Default: 'sfx'
      volume?: number; // Override channel volume
      loop?: boolean;
      speed?: number;
    },
  ): SoundHandle;

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

### 6.3 Asset Handle Factory

```typescript
import { AssetHandle } from "@yage/core";
import { Sound } from "@pixi/sound";

/** Create a typed asset handle for a sound file. */
export function sound(path: string): AssetHandle<Sound>;
```

Usage: Define sound handles at module scope, then include them in a scene's asset manifest for deferred loading via `AssetManager.loadAll()`.

### 6.4 SoundComponent

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
  readonly name = "particles";
  readonly dependencies = ["renderer"];
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

export class ParticlePool {
  // Allocation-free particle recycling
  acquire(): Particle | undefined;
  release(particle: Particle): void;
}
```

#### ParticlePresets

Built-in preset configurations for common effects:

```typescript
export const ParticlePresets = {
  /** Upward fire effect. Lifetime 0.4-0.8s, speed 80-160 px/s, orange tint. */
  fire(texture: Texture): EmitterConfig;

  /** Slow-rising smoke. Lifetime 1.0-2.0s, speed 20-50 px/s, gray tint. */
  smoke(texture: Texture): EmitterConfig;

  /** Fast directional sparks. Lifetime 0.2-0.5s, speed 200-400 px/s, yellow tint. */
  sparks(texture: Texture): EmitterConfig;

  /** Downward rain drops. Lifetime 0.5-1.0s, speed 300-500 px/s, cyan tint. */
  rain(texture: Texture): EmitterConfig;
} as const;
```

### 7.2 Tilemap Plugin (`@yage/tilemap`)

```typescript
export class TilemapPlugin implements Plugin {
  readonly name = "tilemap";
  readonly dependencies = ["renderer"];
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

#### Asset Handle Factory

```typescript
/** Create a typed asset handle for a Tiled JSON map. */
export function tiledMap(path: string): AssetHandle<TilemapData>;
```

#### Object Extraction Utilities

```typescript
/** Extract objects from Tiled map, grouped by class/type. */
export function extractObjects(
  map: TiledMapData,
  objectLayerName?: string,
): Record<string, TileObject[]>;

/** Get a single property value by name from a Tiled object. */
export function getProperty<T = unknown>(
  obj: HasProperties,
  name: string,
): T | undefined;

/** Get pseudo-array of properties using indexed naming (e.g., spawns[0], spawns[1]). */
export function getPropertyArray<T = unknown>(
  obj: HasProperties,
  name: string,
): T[];

/** Resolve a property of type "object" (ID reference) to the actual MapObject. */
export function resolveObjectRef(
  obj: HasProperties,
  propName: string,
  allObjects: MapObject[],
): MapObject | undefined;

/** Resolve pseudo-array of object ID references to actual MapObjects. */
export function resolveObjectRefArray(
  obj: HasProperties,
  propName: string,
  allObjects: MapObject[],
): MapObject[];
```

#### Collision Extraction

```typescript
/** Extract physics-agnostic collision shapes from object layers. */
export function extractCollisionShapes(
  map: TilemapData,
  objectLayerName?: string,
): TilemapColliderConfig[];
```

### 7.3 UI Plugin (`@yage/ui`)

```typescript
export class UIPlugin implements Plugin {
  readonly name = "ui";
  readonly dependencies = ["renderer"];
  // Registers UIContainerKey service
}
```

#### Core Components

All UI components use Yoga flex layout for positioning and support `LayoutProps` for width, height, and positioning.

```typescript
/** Layout container with Yoga flexbox. Supports background color/texture. */
export class UIPanel extends Component {
  constructor(options?: UIPanelOptions);
  addChild(child: UIElement): void;
  removeChild(child: UIElement): void;
}

/** Text rendering with PixiJS Text. */
export class UIText extends Component {
  constructor(text: string, style?: TextStyle);
  setText(text: string): void;
}

/** Interactive button with hover/press states. */
export class UIButton extends Component {
  constructor(options: UIButtonOptions);
  setLabel(label: string): void;
  setEnabled(enabled: boolean): void;
}

/** Texture display component. */
export class UIImage extends Component {
  constructor(options: UIImageOptions);
}

/** 9-slice scaled sprite for scalable UI backgrounds. */
export class UINineSlice extends Component {
  constructor(options: UINineSliceOptions);
}

/** Progress indicator bar. */
export class UIProgressBar extends Component {
  constructor(options: UIProgressBarOptions);
  setProgress(value: number): void; // 0-1
}

/** Toggle checkbox. */
export class UICheckbox extends Component {
  constructor(options: UICheckboxOptions);
  get checked(): boolean;
  setChecked(value: boolean): void;
}
```

#### @pixi/ui Wrappers

Convenience wrappers around `@pixi/ui` for advanced widget functionality:

```typescript
export class PixiFancyButton { ... }   // Animated button with scale/tint
export class PixiCheckbox { ... }       // Checkbox
export class PixiProgressBar { ... }    // Progress bar
export class PixiSlider { ... }         // Slider input
export class PixiInput { ... }          // Text input field
export class PixiScrollBox { ... }      // Scrollable container
export class PixiSelect { ... }         // Dropdown selector
export class PixiRadioGroup { ... }     // Radio button group
```

#### Background Rendering

```typescript
export type BackgroundOptions = ColorBackground | TextureBackground;

export interface ColorBackground {
  type: "color";
  color: number;
  alpha?: number;
  borderRadius?: number;
}

export interface TextureBackground {
  type: "texture";
  texture: Texture;
}
```

### 7.4 Debug Plugin (`@yage/debug`)

```typescript
export const DebugRegistryKey = new ServiceKey<DebugRegistry>("debugRegistry");

export class DebugPlugin implements Plugin {
  readonly name = "debug";
  readonly dependencies = ["renderer"];
  // Registers DebugRegistryKey service
}

export interface DebugConfig {
  /** Toggle key (default: F12). */
  toggleKey?: string;
}
```

#### Debug Registry

```typescript
/** Central registry for debug contributors with flag management. */
export class DebugRegistryImpl implements DebugRegistry {
  contributors: Map<string, DebugContributor>;
  enabled: boolean;

  register(contributor: DebugContributor): void;
  isEnabled(): boolean;
  isFlagEnabled(contributorName: string, flag: string): boolean;
  toggle(): void;
  toggleFlag(contributorName: string, flag: string): void;
  setFlag(contributorName: string, flag: string, value: boolean): void;
}
```

#### World-Space Debug Drawing

```typescript
/** World-space debug drawing via allocation-free GraphicsPool. */
export class WorldDebugApiImpl implements WorldDebugApi {
  setContributor(name: string): void;
  acquireGraphics(): DebugGraphics | undefined;
  isFlagEnabled(flag: string): boolean;
  get cameraZoom(): number;
}

/** Allocation-free pool of PixiJS Graphics objects. */
export class GraphicsPool {
  acquire(): Graphics | undefined;
  resetFrame(): void;
  destroy(): void;
}
```

#### HUD Debug Text

```typescript
/** Screen-space debug text via allocation-free TextPool. */
export class HudDebugApiImpl implements HudDebugApi {
  setContributor(name: string): void;
  addLine(text: string): void;
  isFlagEnabled(flag: string): boolean;
  get screenWidth(): number;
  get screenHeight(): number;
}

/** Allocation-free pool of PixiJS Text objects. */
export class TextPool {
  addLine(text: string): void;
  resetFrame(): void;
  destroy(): void;
}
```

#### Stats Store

```typescript
/** Rolling-window statistics with Float64Array ring buffers (120-frame window). */
export class StatsStore {
  push(key: string, value: number): void;
  average(key: string): number;
  latest(key: string): number;
  min(key: string): number;
  max(key: string): number;
}
```

### 7.5 Asset Management (`@yage/core`)

Asset management is part of `@yage/core` with pluggable loaders registered by plugin packages.

```typescript
export const AssetManagerKey = new ServiceKey<AssetManager>("assetManager");

/** Phantom-typed handle for type-safe deferred asset loading. */
export class AssetHandle<T> {
  readonly type: string;
  readonly path: string;
  constructor(type: string, path: string);
}

/** Interface for pluggable asset loaders. */
export interface AssetLoader<T = unknown> {
  load(path: string): Promise<T>;
  unload?(path: string, asset: T): void;
}

/** Central orchestrator for asset loading. */
export class AssetManager {
  /** Register a loader for an asset type. */
  registerLoader(type: string, loader: AssetLoader): void;

  /** Retrieve a loaded asset. Throws if not yet loaded. */
  get<T>(handle: AssetHandle<T>): T;

  /** Check if an asset is loaded. */
  has(handle: AssetHandle<unknown>): boolean;

  /** Load multiple assets with optional progress callback (0→1). */
  async loadAll(
    handles: AssetHandle<unknown>[],
    onProgress?: (progress: number) => void,
  ): Promise<void>;

  /** Unload a single asset. */
  unload(handle: AssetHandle<unknown>): void;

  /** Unload all cached assets. */
  clear(): void;
}
```

**Pattern**: Handles are created at module scope, loaded in scene `assets` manifest:

```typescript
// Define handles at module scope
const heroTexture = texture("hero.png");
const jumpSound = sound("jump.wav");
const level1Map = tiledMap("level1.json");

// Load in scene onEnter
class GameScene extends Scene {
  async onEnter() {
    const assets = this.context.resolve(AssetManagerKey);
    await assets.loadAll([heroTexture, jumpSound, level1Map]);

    const player = this.spawn("player");
    player.add(new SpriteComponent({ texture: assets.get(heroTexture) }));
  }
}
```

#### Factory Helpers

Each plugin that registers an asset loader also exports a factory function:

| Factory          | Package          | Returns                    |
| ---------------- | ---------------- | -------------------------- |
| `texture(path)`  | `@yage/renderer` | `AssetHandle<Texture>`     |
| `sound(path)`    | `@yage/audio`    | `AssetHandle<Sound>`       |
| `tiledMap(path)` | `@yage/tilemap`  | `AssetHandle<TilemapData>` |

### 7.6 Entity Subclasses & Traits (`@yage/core`)

Entities support two usage styles, and both can coexist in the same project:

- **Data containers (ECS-style)**: Use entities as plain ID + component bags. Systems or other actors query and manipulate components directly. Best for bulk processing (physics bodies, particles, tiles).
- **Game object API layer**: Use entity subclasses with methods that internally interact with components, exposing a clean public API. Add `@trait()` for shared behaviors that are discoverable at runtime. Best for gameplay objects with rich interactions (NPCs, items, doors).

Entity subclasses with `setup()` are the primary way to define entity types. Traits add discoverable capabilities. Blueprints are deprecated but still supported.

**Entity subclass with traits**:

```typescript
const Damageable = defineTrait<{ damage(amount: number): void }>(
  "Damageable",
);

@trait(Damageable)
class Enemy extends Entity {
  setup({ hp, speed }: { hp: number; speed: number }) {
    this.add(new Transform());
    this.add(new RigidBodyComponent({ type: "dynamic" }));
    this.add(new ColliderComponent({ shape: { type: "circle", radius: 16 } }));
    this.add(new HealthComponent(hp));

    const gfx = this.add(new GraphicsComponent());
    gfx.draw((g) => g.circle(0, 0, 16).fill(0xff0000));
  }

  damage(amount: number) {
    this.get(HealthComponent).hp -= amount;
  }
}

// Usage in a scene
const enemy = scene.spawn(Enemy, { hp: 50, speed: 100 });

// Generic trait-based interaction
for (const entity of scene.getEntities()) {
  if (entity.hasTrait(Damageable)) {
    entity.damage(10); // type-safe
  }
}
```

**Entity subclass without traits** (for entities that don't need runtime discovery):

```typescript
class Wall extends Entity {
  setup({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(new ColliderComponent({ shape: { type: "box", width: w, height: h } }));
  }
}

const wall = scene.spawn(Wall, { x: 0, y: 0, w: 100, h: 10 });
```

**Why `setup()` instead of constructor**: `scene.spawn(Class, params)` creates the entity, wires it to the scene, emits `entity:created`, then calls `setup(params)`. This ensures `onAdd` hooks and service resolution work inside `setup()`.

### 7.6.1 Blueprint System (deprecated)

Blueprints still work but entity subclasses are preferred for new code.

```typescript
const EnemyBlueprint = defineBlueprint<{ hp: number; speed: number }>(
  "enemy",
  (entity, { hp, speed }) => {
    entity.add(new Transform());
    entity.add(new HealthComponent(hp));
  },
);

const enemy = scene.spawn(EnemyBlueprint, { hp: 50, speed: 100 });
```

### 7.7 Entity Events (`@yage/core`)

Per-entity pub/sub using typed event tokens. Complements the global `EventBus` with entity-scoped events.

```typescript
/** Phantom-typed token for entity-level events. */
export class EventToken<T = void> {
  readonly name: string;
  constructor(name: string);
}

/** Create a typed event token. */
export function defineEvent<T = void>(name: string): EventToken<T>;
```

**Usage**:

```typescript
// Define events at module scope
const DamageEvent = defineEvent<{ amount: number; source: Entity }>("damage");
const DeathEvent = defineEvent("death");

// Subscribe on an entity
entity.on(DamageEvent, ({ amount, source }) => {
  console.log(`${entity.name} took ${amount} damage from ${source.name}`);
});

entity.once(DeathEvent, () => {
  console.log(`${entity.name} died`);
});

// Emit from anywhere with a reference to the entity
entity.emit(DamageEvent, { amount: 25, source: playerEntity });
entity.emit(DeathEvent);
```

**How it differs from EventBus**:

- `EventBus` is global (engine-wide). Use for engine lifecycle events, cross-system communication.
- `EventToken` / `entity.on()` / `entity.emit()` is entity-scoped. Use for game logic events tied to specific entities (damage, collection, state changes).

### 7.8 React UI Plugin (`@yage/ui-react`)

Custom React reconciler for rendering game UI with familiar React patterns over Yoga + PixiJS.

```typescript
export class UIRoot extends Component {
  constructor(opts?: UIRootOptions);
  render(element: ReactElement): void;
  update(): void; // Automatic via ComponentUpdateSystem
}

export interface UIRootOptions {
  anchor?: Anchor;
  offset?: { x: number; y: number };
}
```

#### React Hooks

```typescript
/** Access the EngineContext from React components. */
export function useEngine(): EngineContext;

/** Access the current YAGE Scene. */
export function useScene(): Scene;

/** Read from a reactive Store with optional selector. */
export function useStore<T extends Record<string, unknown>, R = T>(
  store: Store<T>,
  selector?: (state: T) => R,
  isEqual?: (a: R, b: R) => boolean,
): R;

/** Run an ECS query and map results through a selector. Frame-polled. */
export function useQuery<R>(
  filter: ComponentClass[],
  selector: (result: QueryResult) => R,
  isEqual?: (a: R, b: R) => boolean,
): R;

/** Run arbitrary selector against current scene each frame. Escape hatch. */
export function useSceneSelector<R>(
  selector: (scene: Scene) => R,
  isEqual?: (a: R, b: R) => boolean,
): R;
```

#### Reactive Store

```typescript
export interface Store<T extends Record<string, unknown>> {
  get(): Readonly<T>;
  set(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends Record<string, unknown>>(
  initial: T,
): Store<T>;
```

#### JSX Components

Wraps `@yage/ui` components as JSX elements:

```typescript
// From @yage/ui
<Panel width={200} height={100} background={{ type: 'color', color: 0x333333 }}>
  <Text text="Hello" style={{ fill: 0xffffff }} />
  <Button label="Click Me" onClick={() => { ... }} />
  <Image texture={myTexture} />
  <NineSlice texture={panelTexture} leftWidth={8} rightWidth={8} topHeight={8} bottomHeight={8} />
  <ProgressBar progress={0.75} />
  <Checkbox checked={true} onChange={(v) => { ... }} />
</Panel>

// From @pixi/ui (advanced widgets)
<PixiFancyButton label="Fancy" />
<PixiSlider min={0} max={100} value={50} />
<PixiInput placeholder="Enter name..." />
<PixiScrollBox width={300} height={200}>...</PixiScrollBox>
<PixiSelect options={['Option A', 'Option B']} />
<PixiRadioGroup options={['A', 'B', 'C']} />
```

#### Example Usage

```tsx
import {
  createStore,
  UIRoot,
  useStore,
  useQuery,
  Panel,
  Text,
  Button,
} from "@yage/ui-react";
import { Transform } from "@yage/core";

const gameStore = createStore({ score: 0, lives: 3 });

function HUD() {
  const { score, lives } = useStore(gameStore);

  return (
    <Panel direction="row" gap={20}>
      <Text text={`Score: ${score}`} style={{ fill: 0xffffff }} />
      <Text text={`Lives: ${lives}`} style={{ fill: 0xff0000 }} />
    </Panel>
  );
}

// In a scene
class GameScene extends Scene {
  onEnter() {
    const uiEntity = this.spawn("hud");
    const uiRoot = uiEntity.add(new UIRoot({ anchor: Anchor.TopLeft }));
    uiRoot.render(<HUD />);
  }
}
```

### 7.9 Meta-Package (`yage`)

The `yage` package re-exports all official packages and provides an ergonomic factory API.

```typescript
export interface CreateGameOptions {
  width?: number; // Default: 800
  height?: number; // Default: 600
  virtualWidth?: number; // Default: width
  virtualHeight?: number; // Default: height
  backgroundColor?: number;
  container?: HTMLElement | string;
  canvas?: HTMLCanvasElement;
  renderer?: Partial<RendererConfig>;

  physics?: boolean | PhysicsConfig;
  input?: boolean | InputConfig;
  audio?: boolean | AudioConfig;
  particles?: boolean;
  tilemap?: boolean;
  ui?: boolean;
  debug?: boolean | DebugConfig;

  plugins?: Plugin[];
  engine?: Omit<EngineConfig, "debug">;
  scene?: Scene | InlineSceneSetup;
}

/** Pre-resolved services passed to inline scene callbacks. */
export interface SceneServices {
  camera: Camera; // always present (renderer always registered)
  assets: AssetManager; // always present (core)
  input?: InputManager; // only if input plugin registered
  physics?: PhysicsWorld; // only if physics plugin registered
  audio?: AudioManager; // only if audio plugin registered
}

/** Callback for inline scene definition via defineInlineScene(). */
export type InlineSceneSetup = (scene: Scene, services: SceneServices) => void;

export interface GameHandle {
  /** The underlying engine instance. Use engine.context to resolve services inside scenes. */
  engine: Engine;
  /** Push a scene (or inline setup) onto the scene stack. */
  pushScene(scene: Scene | InlineSceneSetup): Promise<void>;
  /** Destroy the engine and clean up all resources. */
  destroy(): void;
}

/** One-call game bootstrap. */
export async function createGame(
  options?: CreateGameOptions,
): Promise<GameHandle>;

/** Create an inline scene without subclassing. */
export function defineInlineScene(name: string, setup: InlineSceneSetup): Scene;
```

#### Scene Approaches

|                      | Class-based (`extends Scene`)                               | Inline (`defineInlineScene`)          |
| -------------------- | ----------------------------------------------------------- | ------------------------------------- |
| **Best for**         | Structured games, complex scenes                            | Quick prototypes, simple scenes       |
| **Service access**   | `this.service(Key)` — lazy proxy, field-declarable          | Destructure from `services` arg       |
| **Lifecycle hooks**  | Full: `onEnter`, `onExit`, `onPause`, `onResume`, `preload` | `onEnter` only (the callback)         |
| **Asset preloading** | `preload` array on class                                    | Must call `assets.loadAll()` manually |
| **Reusability**      | Importable class, testable in isolation                     | Tied to definition site               |

**How it maps to manual setup**:

```typescript
// With createGame (convenience)
const game = await createGame({
  width: 800,
  height: 600,
  physics: { gravity: { x: 0, y: 980 } },
  input: { actions: { jump: ["Space"] } },
  debug: true,
  scene: defineInlineScene("game", (scene, { camera, input }) => {
    camera.follow(scene.spawn("player"));
  }),
});

// Equivalent manual setup
const engine = new Engine({ debug: true });
engine.use(new RendererPlugin({ width: 800, height: 600 }));
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));
engine.use(new InputPlugin({ actions: { jump: ["Space"] } }));
engine.use(new DebugPlugin());
await engine.start();
engine.scenes.push(new GameScene());
```

---

## 8. API Sketches

### 8.1 Creating an Engine and Loading a Scene

```typescript
import { Engine, Scene, Transform, Vec2 } from "@yage/core";
import { RendererPlugin, SpriteComponent } from "@yage/renderer";
import { InputPlugin } from "@yage/input";

// Create engine with plugins
const engine = new Engine({ debug: true });

engine
  .use(
    new RendererPlugin({
      width: 800,
      height: 600,
      virtualWidth: 400,
      virtualHeight: 300,
      backgroundColor: 0x1a1a2e,
    }),
  )
  .use(
    new InputPlugin({
      actions: {
        moveLeft: ["KeyA", "ArrowLeft"],
        moveRight: ["KeyD", "ArrowRight"],
        jump: ["Space", "KeyW", "ArrowUp"],
      },
    }),
  );

// Define a scene
class GameScene extends Scene {
  readonly name = "game";

  onEnter() {
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(200, 150) }));
    player.add(new SpriteComponent({ texture: "hero.png" }));
  }
}

// Start
await engine.start();
engine.scenes.push(new GameScene());
```

### 8.2 Bouncing Ball (Complete Example, <10 Lines of User Code)

```typescript
import { Engine, Scene, Transform, Vec2 } from "@yage/core";
import { RendererPlugin, GraphicsComponent } from "@yage/renderer";
import {
  PhysicsPlugin,
  RigidBodyComponent,
  ColliderComponent,
} from "@yage/physics";

const engine = new Engine();
engine.use(
  new RendererPlugin({ width: 800, height: 600, backgroundColor: 0x1a1a2e }),
);
engine.use(new PhysicsPlugin({ gravity: { x: 0, y: 980 } }));

class BounceScene extends Scene {
  readonly name = "bounce";

  onEnter() {
    // Ball
    const ball = this.spawn("ball");
    ball.add(new Transform({ position: new Vec2(400, 100) }));
    ball.add(new RigidBodyComponent({ type: "dynamic" }));
    ball.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 20 },
        restitution: 0.8,
      }),
    );
    ball
      .add(new GraphicsComponent())
      .draw((g) => g.circle(0, 0, 20).fill(0xffffff));

    // Floor
    const floor = this.spawn("floor");
    floor.add(new Transform({ position: new Vec2(400, 580) }));
    floor.add(new RigidBodyComponent({ type: "static" }));
    floor.add(
      new ColliderComponent({ shape: { type: "box", width: 800, height: 40 } }),
    );
    floor
      .add(new GraphicsComponent())
      .draw((g) => g.rect(-400, -20, 800, 40).fill(0x333333));
  }
}

await engine.start();
engine.scenes.push(new BounceScene());
```

Compare this to the v1 equivalent which required `pu()` conversion, `RigidBodyDesc`/`ColliderDesc` from Rapier directly, `Executor.execute()`, a `Game` wrapper, `GraphicComponent` with linked transforms, and `Vector2` imports from Rapier.

### 8.3 Custom System

```typescript
import { System, Phase, Entity, Transform, Vec2 } from "@yage/core";
import { InputManagerKey } from "@yage/input";
import { RigidBodyComponent } from "@yage/physics";

class PlayerMovementSystem extends System {
  readonly phase = Phase.FixedUpdate;
  readonly priority = 10;

  private query!: QueryResult;
  private input!: InputManager;

  onRegister(context: EngineContext) {
    this.query = context
      .resolve(QueryCacheKey)
      .register([Transform, RigidBodyComponent]);
    this.input = context.resolve(InputManagerKey);
  }

  update(dt: number) {
    for (const entity of this.query) {
      if (!entity.tags.has("player")) continue;

      const body = entity.get(RigidBodyComponent);
      const moveX =
        this.input.getAxis("moveRight") - this.input.getAxis("moveLeft");

      body.setVelocity(new Vec2(moveX * 200, body.getVelocity().y));

      if (this.input.isJustPressed("jump")) {
        body.applyImpulse(new Vec2(0, -300));
      }
    }
  }
}
```

### 8.4 Scene Stacking (HUD Overlay)

```typescript
class GameScene extends Scene {
  readonly name = "game";
  readonly pauseBelow = true;

  onEnter() {
    // ... spawn game entities
  }
}

class HUDScene extends Scene {
  readonly name = "hud";
  readonly pauseBelow = false; // Game scene keeps running
  readonly transparentBelow = true; // Game scene still renders

  onEnter() {
    const scoreText = this.spawn("score");
    scoreText.add(new Transform({ position: new Vec2(10, 10) }));
    scoreText.add(
      new UITextElement("Score: 0", { fill: 0xffffff, fontSize: 24 }),
    );
  }
}

class PauseScene extends Scene {
  readonly name = "pause";
  readonly pauseBelow = true; // Game freezes
  readonly transparentBelow = true; // Game still visible behind

  onEnter() {
    const label = this.spawn("pauseLabel");
    label.add(new Transform({ position: new Vec2(200, 150) }));
    label.add(new UITextElement("PAUSED", { fill: 0xffffff, fontSize: 48 }));
  }
}

// Usage:
engine.scenes.push(new GameScene()); // Stack: [Game]
engine.scenes.push(new HUDScene()); // Stack: [Game, HUD] -- both run, both render
engine.scenes.push(new PauseScene()); // Stack: [Game, HUD, Pause] -- Game+HUD paused but visible
engine.scenes.pop(); // Stack: [Game, HUD] -- Game+HUD resume
```

### 8.5 Blueprint Templates

```typescript
import { defineBlueprint, Transform, Vec2 } from "@yage/core";
import { SpriteComponent } from "@yage/renderer";
import { RigidBodyComponent, ColliderComponent } from "@yage/physics";

const CoinBlueprint = defineBlueprint<{ position: Vec2 }>(
  "coin",
  (entity, params) => {
    entity.tags.add("coin");
    entity.tags.add("collectible");
    entity.add(new Transform({ position: params.position }));
    entity.add(new SpriteComponent({ texture: "coin.png" }));
    entity.add(new RigidBodyComponent({ type: "static" }));
    entity.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 8 },
        sensor: true,
      }),
    );
  },
);

// Spawn many coins
class LevelScene extends Scene {
  readonly name = "level";

  onEnter() {
    const coinPositions = [
      new Vec2(100, 200),
      new Vec2(150, 200),
      new Vec2(200, 200),
    ];

    for (const position of coinPositions) {
      this.spawn(CoinBlueprint, { position });
    }
  }
}
```

### 8.6 Process/Tween Chaining

```typescript
import { Sequence, Tween, Process } from "@yage/core";

// Animate a door opening sequence
new Sequence()
  .call(() => console.log("Door opening..."))
  .then(Tween.to(doorTransform, "rotation", Math.PI / 2, 500, "easeOutQuad"))
  .wait(200)
  .parallel(
    Tween.custom((v) => light.setIntensity(v), 0, 1, 300),
    Tween.custom((v) => sound.setVolume(v), 0, 0.8, 300),
  )
  .call(() => console.log("Door opened!"))
  .start(scene);

// Simple tween with promise
await Tween.to(sprite, "alpha", 0, 1000, "easeInQuad").toPromise();
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
      if (!entity.tags.has("coin")) continue;

      const collider = entity.get(ColliderComponent);
      collider.onCollision((event) => {
        if (event.started && event.other.tags.has("player")) {
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
    collider.onCollision((event) => {
      if (event.started && event.other.tags.has("player")) {
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
const player = inspector.getEntityByName("player");
console.log(player?.position); // { x: 200, y: 150 }
console.log(player?.components); // ['Transform', 'SpriteComponent', 'RigidBodyComponent', 'ColliderComponent']

// In Playwright test
test("ball falls to floor", async ({ page }) => {
  await page.goto("/examples/bouncing-ball");
  await page.waitForTimeout(2000);

  const pos = await page.evaluate(() =>
    window.__yage__.inspector.getEntityPosition("ball"),
  );

  expect(pos!.y).toBeGreaterThan(400); // Ball has fallen
});
```

### 8.9 Structured Logging

```typescript
// Engine setup
const engine = new Engine({
  debug: true,
  logger: {
    level: LogLevel.Debug,
    categories: ["physics", "input", "core"],
    bufferSize: 1000,
  },
});

// In a system
class EnemyAI extends System {
  update(dt: number) {
    const logger = this.context.resolve(LoggerKey);
    logger.info("ai", "Enemy spotted player", {
      enemy: "goblin_1",
      distance: 45.2,
    });
  }
}

// Read logs programmatically (Playwright)
const logs = await page.evaluate(() =>
  window.__yage__.logger.formatRecentLogs(20),
);
// Output:
// [INFO][ai] f142 Enemy spotted player {enemy:"goblin_1", distance:45.2}
// [INFO][physics] f142 Collision detected {a:"player", b:"goblin_1"}
```

---

## 9. Design Decisions Table

Key design decisions and their rationale.

### Architecture & Design

| #   | Problem                                                                                                   | Solution                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No enabled check in component lifecycle dispatch** -- disabled components still receive lifecycle calls | The built-in `ComponentUpdateSystem` checks `component.enabled` before calling `update()`/`fixedUpdate()`. `ErrorBoundary.wrapComponent` wraps each call — on error, the component is disabled. Disabled components are never ticked. |
| 2   | **Async `onAfterTick` via `setTimeout(..., 0)`** -- deferred execution causes ordering bugs               | All game loop phases are synchronous. `endOfFrame` is a proper phase, not a setTimeout. No async in the game loop.                                                                                                                    |
| 3   | **`onAfterFixedTick` called inside `onFixedTick`** -- coupled lifecycle steps                             | Phases are distinct and scheduled by `SystemScheduler`. FixedUpdate systems complete fully before the next phase. No implicit coupling.                                                                                               |
| 4   | **Global mutable context via Executor** -- fragile singleton, stale refs in async                         | `EngineContext` DI container replaces `Executor`. No global state. Systems receive context via `onRegister()`. All access is explicit.                                                                                                |

### Performance

| #   | Problem                                                                              | Solution                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **No query caching** -- O(n) linear scans on every `getComponentBy*` call            | `QueryCache` with incremental archetype tracking. Queries update only on component add/remove. Entity.get() is a Map lookup: O(1).                       |
| 6   | **Process mode filtering on every lifecycle hook** -- 6 full array filters per frame | `SceneManager` handles pause semantics at the scene level. Systems only iterate entities from active scenes. No per-frame filtering.                     |
| 7   | **No spatial partitioning**                                                          | Not in core (out of scope for v2.0), but `PhysicsWorld.raycast()` and Rapier's own spatial queries are exposed. A spatial hash plugin is a P2 candidate. |

### Missing Features

| #   | Problem                                                                             | Solution                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | **No mouse/touch/gamepad input**                                                    | `@yage/input` supports keyboard, mouse, touch, and gamepad with a unified action map. `getPointerPosition()`, `getVector()`, `getGamepads()`.                    |
| 9   | **No camera/viewport at engine level**                                              | `Camera` class in `@yage/renderer` with follow, deadzone, zoom, shake, and bounds clamping. `screenToWorld()`/`worldToScreen()` conversion.                      |
| 10  | **No audio spatialization or scene-level audio management**                         | `AudioManager` with named channels (sfx, music, ambient), per-channel volume/mute/pause. Global master mute.                                                     |
| 11  | **No built-in collision event routing** -- infrastructure exists but isn't wired up | `PhysicsSystem` drains Rapier's event queue every fixed step and dispatches to `ColliderComponent.onCollision()` / `onTrigger()` handlers. Complete and working. |
| 12  | **No scene stacking or layering**                                                   | `SceneManager` with push/pop/replace stack. `pauseBelow` and `transparentBelow` flags per scene for overlay/HUD support.                                         |
| 13  | **Node system is orphaned**                                                         | Removed entirely. No orphaned code in v2.                                                                                                                        |

### Developer Experience

| #   | Problem                                                 | Solution                                                                                                                                  |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | **No tests exist**                                      | 100% unit test coverage on `@yage/core` (Vitest). Playwright E2E tests per plugin. CI runs all tests on every PR.                         |
| 15  | **`typedoc` not installed**                             | API docs generated via TypeDoc (properly installed) or TSDoc comments. All public APIs documented.                                        |
| 16  | **Private `setup()`/`teardown()` pattern is confusing** | `Component` uses clear lifecycle: `onAdd()`, `onRemove()`, `onDestroy()`. No private setup/teardown. No confusion about extension points. |
| 17  | **PixiJS v7 lock-in**                                   | v2 uses PixiJS v8 with its modern API (WebGPU-ready, new container model).                                                                |
| 18  | **XState v4 lock-in**                                   | XState is removed from core. State machines can be added as user-land components using any FSM library.                                   |
| 19  | **Mixed dependency placement**                          | Clean monorepo with proper dependency separation. Zero runtime deps in `@yage/core`. Each plugin declares its own deps.                   |

### Robustness

| #   | Problem                                                                 | Solution                                                                                                                                              |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20  | **No error boundaries** -- one bad component crashes the game           | `ErrorBoundary` wraps all system and component execution. On throw, the offending system/component is disabled, error is logged, game loop continues. |
| 21  | **`destroy()` can cause double-removal** -- bidirectional destroy calls | `Entity.destroy()` is one-way. The scene handles removal in `endOfFrame`. `isDestroyed` flag prevents double processing. No bidirectional calls.      |
| 22  | **`preventDefault()` on all key events** -- breaks browser shortcuts    | `InputPlugin` accepts `preventDefaultKeys` config. Only specified keys are prevented. No global capture.                                              |

### Ergonomics (from real example analysis)

| #   | Problem                                                           | Solution                                                                                                                                           |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23  | **Massive physics boilerplate** -- 12+ lines for a physics sprite | 4 lines: `add(Transform)`, `add(RigidBodyComponent)`, `add(ColliderComponent)`, `add(SpriteComponent)`. No `pu()`, no raw Rapier types.            |
| 24  | **Physics is mandatory even when unused**                         | Physics is in `@yage/physics`. If you don't install it, no WASM download, no physics world. Core has zero physics knowledge.                       |
| 25  | **InputComponent requires `Map` instead of plain object**         | Action maps are plain objects: `{ jump: ['Space', 'KeyW'] }`.                                                                                      |
| 26  | **Constructor-only initialization** -- no declarative composition | Entity subclasses with `setup()` + `scene.spawn(Class, params)`. Traits for discoverable capabilities. Blueprints deprecated. |
| 27  | **Verbose generics with no payoff**                               | No gratuitous generics. `Scene` is not generic. `Entity` is not generic. Components use concrete types.                                            |
| 28  | **Inconsistent Scene state initialization**                       | `Scene` has no generic state parameter. Scene-specific state is stored as regular class properties.                                                |
| 29  | **No example discovery or runner**                                | Examples have a shared dev server with URL routing (`/examples/bouncing-ball`, `/examples/platformer`, etc.). Index page lists all examples.       |
| 30  | **`pu()` conversion is a constant tax**                           | `PhysicsWorld` handles pixel-to-meter internally. All user-facing APIs work in pixels. `pu()` does not exist in v2.                                |

### Missing Abstractions

| #   | Problem                               | Solution                                                                                                                  |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 31  | **No collision layers/masks**         | `CollisionLayers` with named layer definitions and bitmask API. `ColliderComponent` accepts `layers` and `mask` config.   |
| 32  | **No debug rendering**                | `@yage/debug` plugin renders physics shapes, entity labels, FPS, entity count, and system timing as a toggleable overlay. |
| 33  | **No prefab or template system**      | Entity subclasses with `setup()` and `scene.spawn(Class, params)`. Traits for discoverable capabilities. Blueprints still supported but deprecated. |
| 34  | **No UI layout system**               | `@yage/ui` plugin with flex-inspired layout, anchoring, text, buttons, and panels.                                        |
| 35  | **No screen shake or camera effects** | `Camera.shake()`, `Camera.zoomTo()`, `Camera.follow()` with deadzone and smoothing.                                       |
| 36  | **No entity lifecycle events**        | `EventBus` emits `entity:created`, `entity:destroyed`, `component:added`, `component:removed`.                            |

### Missing Core Features

| #   | Problem                             | Solution                                                                                                                                                                                |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 37  | **No save/load or serialization**   | P2 feature. Not in v2.0 scope. Inspector's `snapshot()` provides read-only serialization as a stepping stone.                                                                           |
| 38  | **No plugin or middleware system**  | Full plugin system with `Plugin` interface, dependency sorting, service registration, system registration, and lifecycle hooks. See [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md). |
| 39  | **No tween chaining or sequencing** | `Sequence` class with `then()`, `wait()`, `call()`, `parallel()`, chained into a single `Process`.                                                                                      |
| 40  | **No built-in pathfinding**         | P2 feature. Not in v2.0 scope.                                                                                                                                                          |
| 41  | **No networking or multiplayer**    | P2 feature. Not in v2.0 scope.                                                                                                                                                          |

### Self-Acknowledged Issues

| #   | Problem                                              | Solution                                                                                                            |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 42  | **Dialogue system is "basic and hard to customize"** | Premade systems (dialogue, loading screens) are not in v2.0 core. They may appear as community plugins or examples. |
| 43  | **`// Memoize these?` comment on queries**           | `QueryCache` fully solves this. The comment is gone because the problem is gone.                                    |
| 44  | **Collision emitter never fires**                    | `PhysicsSystem` completes the collision pipeline. Events are dispatched to handlers. No dead code.                  |

---

## References

- [PRD.md](./PRD.md) -- Product Requirements Document
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) -- Phased build roadmap
- [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) -- Testing and debugging approach
- [PLUGIN_ARCHITECTURE.md](./PLUGIN_ARCHITECTURE.md) -- Plugin system specification
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) -- AI agent development guide
- [RECIPES_PLAN.md](./RECIPES_PLAN.md) -- Planned recipes, signatures, and implementation approach

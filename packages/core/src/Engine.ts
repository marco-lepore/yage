import {
  EngineContext,
  EngineKey,
  EventBusKey,
  SceneManagerKey,
  LoggerKey,
  InspectorKey,
  QueryCacheKey,
  ErrorBoundaryKey,
  GameLoopKey,
  SystemSchedulerKey,
  ProcessSystemKey,
  AssetManagerKey,
} from "./EngineContext.js";
import { AssetManager } from "./AssetManager.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { Logger } from "./Logger.js";
import type { LoggerConfig } from "./Logger.js";
import { QueryCache } from "./QueryCache.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { GameLoop } from "./GameLoop.js";
import { SceneManager } from "./SceneManager.js";
import { SystemScheduler } from "./SystemScheduler.js";
import { Inspector } from "./Inspector.js";
import {
  ComponentUpdateSystem,
  ComponentFixedUpdateSystem,
} from "./ComponentUpdateSystem.js";
import { ProcessSystem } from "./ProcessSystem.js";
import { Phase } from "./types.js";
import type { Plugin } from "./types.js";
import { SceneHookRegistry, SceneHookRegistryKey } from "./SceneHooks.js";
import type { SceneHooks } from "./SceneHooks.js";
import { RandomKey } from "./Random.js";
import { SceneTime, SceneTimeKey } from "./SceneTime.js";

/** Engine configuration. */
export interface EngineConfig {
  /** Enable debug mode (Inspector API, debug logging). */
  debug?: boolean;
  /** Fixed timestep in seconds (default: 1/60). */
  fixedTimestep?: number;
  /** Max fixed steps per frame to prevent spiral of death (default: 5). */
  maxFixedStepsPerFrame?: number;
  /** Logger configuration. */
  logger?: LoggerConfig;
}

/**
 * The top-level entry point. Owns the plugin registry, game loop,
 * scene manager, and DI container.
 */
export class Engine {
  /** The dependency injection container. */
  readonly context: EngineContext;
  /** The scene manager. */
  readonly scenes: SceneManager;
  /** The event bus. */
  readonly events: EventBus<EngineEvents>;
  /** The game loop. */
  readonly loop: GameLoop;
  /** The logger. */
  readonly logger: Logger;
  /** The inspector (debug queries). */
  readonly inspector: Inspector;

  private readonly scheduler: SystemScheduler;
  private readonly errorBoundary: ErrorBoundary;
  private readonly queryCache: QueryCache;
  private readonly sceneHooks: SceneHookRegistry;
  /** The asset manager. */
  readonly assets: AssetManager;

  private readonly plugins: Map<string, Plugin> = new Map();
  private sortedPlugins: Plugin[] = [];
  private started = false;
  private destroyed = false;
  private readonly debug: boolean;

  constructor(config?: EngineConfig) {
    this.debug = config?.debug ?? false;

    // Create core services
    this.context = new EngineContext();
    this.events = new EventBus<EngineEvents>();
    this.logger = new Logger(config?.logger);
    this.queryCache = new QueryCache();
    this.loop = new GameLoop(config);
    this.errorBoundary = new ErrorBoundary(this.logger);
    this.scenes = new SceneManager();
    this.scheduler = new SystemScheduler();
    this.inspector = new Inspector(this);
    this.assets = new AssetManager();
    this.sceneHooks = new SceneHookRegistry();

    // EventBus and SceneHookRegistry are constructed directly rather than
    // resolved through EngineContext, so they can't reach the boundary the
    // way a Component/System does — wire it once here.
    this.events._setErrorBoundary(this.errorBoundary);
    this.sceneHooks._setErrorBoundary(this.errorBoundary);

    // Wire up the scheduler with error boundary
    this.scheduler.setErrorBoundary(this.errorBoundary);

    // Register all well-known services
    this.context.register(EngineKey, this);
    this.context.register(EventBusKey, this.events);
    this.context.register(SceneManagerKey, this.scenes);
    this.context.register(LoggerKey, this.logger);
    this.context.register(QueryCacheKey, this.queryCache);
    this.context.register(ErrorBoundaryKey, this.errorBoundary);
    this.context.register(GameLoopKey, this.loop);
    this.context.register(InspectorKey, this.inspector);
    this.context.register(SystemSchedulerKey, this.scheduler);
    this.context.register(AssetManagerKey, this.assets);
    this.context.register(SceneHookRegistryKey, this.sceneHooks);

    this.sceneHooks.register({
      beforeEnter: (scene) => {
        scene._registerScoped(RandomKey, this.inspector.createSceneRandom());
        scene._registerScoped(SceneTimeKey, new SceneTime(scene));
        this.inspector.attachSceneEventObserver(scene);
      },
      afterExit: (scene) => {
        // Entities are already destroyed at this point, so entity-owned
        // teardown (component onDestroy) has released its own requests;
        // this catches the rest.
        scene.tryResolveScoped(SceneTimeKey)?._releaseAll();
        this.inspector.detachSceneEventObserver(scene);
      },
    });

    // Wire scene manager with context
    this.scenes._setContext(this.context);

    // Register built-in ComponentUpdateSystem (bridge between OOP and ECS)
    this.registerBuiltInSystems();

    // Wire game loop callbacks
    this.loop.setCallbacks({
      earlyUpdate: (dt) => {
        this.logger.setFrame(this.loop.frameCount);
        // Age SceneTime request timers on raw frame time before any
        // transition or system code runs — a request created later in the
        // frame is first aged next frame, so it never loses its creation
        // frame's dt. The activeScenes snapshot keeps scene-stack mutations
        // out of this pass.
        for (const scene of [...this.scenes.activeScenes]) {
          scene.tryResolveScoped(SceneTimeKey)?._tick(dt);
        }
        this.scenes._tickTransition(dt);
        this.scheduler.run(Phase.EarlyUpdate, dt);
      },
      fixedUpdate: (dt) => this.scheduler.run(Phase.FixedUpdate, dt),
      update: (dt) => this.scheduler.run(Phase.Update, dt),
      lateUpdate: (dt) => this.scheduler.run(Phase.LateUpdate, dt),
      render: (dt) => this.scheduler.run(Phase.Render, dt),
      endOfFrame: (dt) => {
        this.scheduler.run(Phase.EndOfFrame, dt);
        this.scenes._flushDestroyQueues();
      },
    });
  }

  /**
   * Register scene lifecycle hooks. The returned function unregisters the
   * hooks. Infrastructure plugins (renderer, physics, debug) register hooks
   * in their `install` or `onStart` to set up and tear down per-scene state.
   */
  registerSceneHooks(hooks: SceneHooks): () => void {
    return this.sceneHooks.register(hooks);
  }

  /** Register a plugin. Must be called before start(). */
  use(plugin: Plugin): this {
    if (this.destroyed) {
      throw new Error("Cannot register plugins on a destroyed engine.");
    }
    if (this.started) {
      throw new Error("Cannot register plugins after engine has started.");
    }
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered.`);
    }
    this.plugins.set(plugin.name, plugin);
    return this;
  }

  /**
   * Start the engine. Installs plugins in topological order, starts the game
   * loop. Calling it again while running is a no-op.
   *
   * An engine instance is single-use: `start()` throws once `destroy()` has
   * run. Plugin `install()` registers services into a container that rejects
   * duplicate keys, and `onDestroy()` releases resources the plugin cannot
   * rebuild, so a second pass over the same instance cannot produce a working
   * engine.
   */
  async start(): Promise<void> {
    if (this.destroyed) {
      throw new Error(
        "Engine.start() cannot be called after destroy() — an engine instance is " +
          "single-use. Construct a new Engine to run again. To restart gameplay " +
          "without tearing the engine down, reset the scene stack instead " +
          "(scenes.replace(new GameScene()) or scenes.popAll() then scenes.push()).",
      );
    }
    if (this.started) return;
    this.started = true;

    // Topological sort of plugins (cached for reverse teardown)
    this.sortedPlugins = this.topologicalSort();
    const sorted = this.sortedPlugins;

    // Install each plugin
    for (const plugin of sorted) {
      await plugin.install?.(this.context);
    }

    // Register systems from each plugin
    for (const plugin of sorted) {
      plugin.registerSystems?.(this.scheduler);
    }

    // Initialize systems; systems added after this point register in add()
    this.scheduler._start(this.context);

    // Start the game loop
    this.loop.start();

    // Expose debug API in browser before plugin onStart hooks run so plugins
    // can safely augment the debug surface.
    if (this.debug && typeof globalThis !== "undefined") {
      (globalThis as Record<string, unknown>)["__yage__"] = {
        inspector: this.inspector,
        logger: this.logger,
      };
    }

    // Notify plugins. Awaited so users can reliably call scenes.push()
    // right after `await engine.start()` without racing plugin init
    // (e.g. DebugPlugin mounts a detached debug scene in onStart).
    for (const plugin of sorted) {
      await plugin.onStart?.();
    }

    // Emit engine started event
    this.events.emit("engine:started", undefined);
  }

  /**
   * Stop the engine. Destroys all scenes, plugins, and the game loop. One-way:
   * the instance cannot be started again. Repeat calls are a no-op, so a host
   * that tears down defensively (hot reload, component unmount) can call it
   * without tracking whether it already did.
   */
  destroy(): void {
    if (this.destroyed) return;
    // Set before teardown runs: a plugin onDestroy or scene onExit that calls
    // destroy() again re-enters here, and must not tear everything down twice.
    this.destroyed = true;

    // Emit stop event
    this.events.emit("engine:stopped", undefined);

    // Stop the loop
    this.loop.stop();

    // Tear down scenes synchronously; also short-circuits any queued async work.
    this.scenes._destroy();

    // Unregister all systems (reverse order for clean teardown)
    this.scheduler._destroy();

    // Destroy plugins in reverse topological order (dependents first)
    for (let i = this.sortedPlugins.length - 1; i >= 0; i--) {
      const plugin = this.sortedPlugins[i];
      if (plugin) plugin.onDestroy?.();
    }

    // Clean up debug API
    if (
      this.debug &&
      typeof globalThis !== "undefined" &&
      "__yage__" in globalThis
    ) {
      delete (globalThis as Record<string, unknown>)["__yage__"];
    }

    this.inspector.dispose();
    this.events.clear();
  }

  private registerBuiltInSystems(): void {
    const fixedUpdate = new ComponentFixedUpdateSystem();
    const update = new ComponentUpdateSystem();
    const processSystem = new ProcessSystem();
    this.scheduler.add(fixedUpdate);
    this.scheduler.add(update);
    this.scheduler.add(processSystem);
    this.context.register(ProcessSystemKey, processSystem);
  }

  /**
   * Topological sort of plugins using Kahn's algorithm.
   * Errors on missing dependencies, circular dependencies, and duplicates.
   */
  private topologicalSort(): Plugin[] {
    const plugins = [...this.plugins.values()];
    const nameMap = new Map<string, Plugin>();
    const inDegree = new Map<string, number>();
    const edges = new Map<string, string[]>(); // dep → dependents

    for (const p of plugins) {
      nameMap.set(p.name, p);
      inDegree.set(p.name, 0);
      edges.set(p.name, []);
    }

    for (const p of plugins) {
      for (const dep of p.dependencies ?? []) {
        if (!nameMap.has(dep)) {
          throw new Error(
            `Plugin "${p.name}" depends on "${dep}", which is not registered.`,
          );
        }
        const depEdges = edges.get(dep);
        if (depEdges) depEdges.push(p.name);
        inDegree.set(p.name, (inDegree.get(p.name) ?? 0) + 1);
      }
    }

    // Queue: all nodes with in-degree 0
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const result: Plugin[] = [];
    while (queue.length > 0) {
      const name = queue.shift();
      if (name === undefined) break;
      const plugin = nameMap.get(name);
      if (!plugin) continue;
      result.push(plugin);
      for (const dependent of edges.get(name) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (result.length !== plugins.length) {
      throw new Error("Circular dependency detected among plugins.");
    }

    return result;
  }
}

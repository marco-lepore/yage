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
import { ProcessSystem, ProcessFixedUpdateSystem } from "./ProcessSystem.js";
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
  /**
   * Where the instance is in its one and only lifecycle. `"failed"` and
   * `"destroyed"` are both terminal: plugins that installed before the engine
   * stopped hold services the container will not accept a second time, so no
   * later `start()` can produce a working engine from either state.
   */
  private lifecycle: "idle" | "running" | "failed" | "destroyed" = "idle";
  private readonly debug: boolean;

  /**
   * Read through a getter rather than comparing the field directly. `start()`
   * assigns `"running"` before it awaits, and the compiler keeps that narrowing
   * across the await, so an inline comparison against `"destroyed"` reads as
   * impossible — while `destroy()` can in fact land during the await.
   */
  private get isDestroyed(): boolean {
    return this.lifecycle === "destroyed";
  }

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
      fixedUpdate: (dt) => {
        // Accrue fixed-timestep scene time before the phase runs, so a system
        // reading it inside a step counts that step.
        for (const scene of this.scenes.activeScenes) {
          scene.tryResolveScoped(SceneTimeKey)?._tickFixed(dt);
        }
        this.scheduler.run(Phase.FixedUpdate, dt);
      },
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
    if (this.lifecycle === "destroyed") {
      throw new Error("Cannot register plugins on a destroyed engine.");
    }
    if (this.lifecycle === "failed") {
      throw new Error(
        "Cannot register plugins after start() failed on this instance. Call " +
          "destroy() to release what did install, then construct a new Engine.",
      );
    }
    if (this.lifecycle !== "idle") {
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
   * An engine instance is single-use, so `start()` throws once the instance
   * has reached a terminal state — `destroy()` has run, or an earlier
   * `start()` rejected. Plugin `install()` registers services into a container
   * that rejects duplicate keys, and `onDestroy()` releases resources the
   * plugin cannot rebuild, so a second pass over the same instance cannot
   * produce a working engine.
   *
   * `destroy()` called while startup is still awaiting a plugin abandons the
   * rest of the sequence: the loop never starts and no further hook runs.
   */
  async start(): Promise<void> {
    if (this.lifecycle === "destroyed") {
      throw new Error(
        "Engine.start() cannot be called after destroy() — an engine instance is " +
          "single-use. Construct a new Engine to run again. To restart gameplay " +
          "without tearing the engine down, reset the scene stack instead " +
          "(scenes.replace(new GameScene()) or scenes.popAll() then scenes.push()).",
      );
    }
    if (this.lifecycle === "failed") {
      throw new Error(
        "Engine.start() already failed on this instance and cannot be retried — " +
          "plugins installed before the failure hold services that cannot be " +
          "registered twice. Call destroy() to release them, then construct a " +
          "new Engine.",
      );
    }
    if (this.lifecycle === "running") return;
    this.lifecycle = "running";

    try {
      // Topological sort of plugins (cached for reverse teardown)
      this.sortedPlugins = this.topologicalSort();
      const sorted = this.sortedPlugins;

      // Install each plugin
      for (const plugin of sorted) {
        await plugin.install?.(this.context);
        // A host can tear the engine down mid-startup (hot reload, a component
        // unmounting). Teardown has already run by the time this resumes, so
        // abandon the sequence rather than installing plugins nothing would
        // release and starting a loop over torn-down state.
        if (this.isDestroyed) return;
      }

      // Register systems from each plugin
      for (const plugin of sorted) {
        plugin.registerSystems?.(this.scheduler);
      }

      // Initialize systems; systems added after this point register in add()
      this.scheduler._start(this.context);

      // Covers a synchronous destroy() from registerSystems or onRegister,
      // which reaches here without an await to be caught by.
      if (this.isDestroyed) return;

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
        if (this.isDestroyed) return;
      }

      // Emit engine started event
      this.events.emit("engine:started", undefined);
    } catch (err: unknown) {
      // Startup left plugins partly installed, holding services the container
      // will not accept again. Mark the instance terminal so a retry says so
      // instead of returning as though the engine were running.
      if (this.lifecycle === "running") this.lifecycle = "failed";
      throw err;
    }
  }

  /**
   * Stop the engine. Destroys all scenes, plugins, and the game loop. One-way:
   * the instance cannot be started again. Repeat calls are a no-op, so a host
   * that tears down defensively (hot reload, component unmount) can call it
   * without tracking whether it already did.
   *
   * Scene teardown, system unregistration and plugin `onDestroy` are
   * independent stages: a throw in one still lets the others run, so a failing
   * scene `onExit` cannot leave a plugin holding its GPU context. The first
   * error is rethrown once teardown has finished, and the rest are reported
   * through {@link Logger}.
   */
  destroy(): void {
    if (this.lifecycle === "destroyed") return;
    // Set before teardown runs: a plugin onDestroy or scene onExit that calls
    // destroy() again re-enters here, and must not tear everything down twice.
    this.lifecycle = "destroyed";

    const errors: unknown[] = [];
    const step = (work: () => void): void => {
      try {
        work();
      } catch (err: unknown) {
        errors.push(err);
      }
    };

    // Emit stop event
    step(() => this.events.emit("engine:stopped", undefined));

    // Stop the loop
    step(() => this.loop.stop());

    // Tear down scenes synchronously; also short-circuits any queued async work.
    step(() => this.scenes._destroy());

    // Unregister all systems (reverse order for clean teardown)
    step(() => this.scheduler._destroy());

    // Destroy plugins in reverse topological order (dependents first)
    for (let i = this.sortedPlugins.length - 1; i >= 0; i--) {
      const plugin = this.sortedPlugins[i];
      if (plugin) step(() => plugin.onDestroy?.());
    }

    // Clean up debug API
    if (
      this.debug &&
      typeof globalThis !== "undefined" &&
      "__yage__" in globalThis
    ) {
      delete (globalThis as Record<string, unknown>)["__yage__"];
    }

    step(() => this.inspector.dispose());
    step(() => this.events.clear());

    if (errors.length === 0) return;
    for (const err of errors.slice(1)) {
      this.logger.error(
        "Engine",
        `Teardown error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    throw errors[0];
  }

  private registerBuiltInSystems(): void {
    const fixedUpdate = new ComponentFixedUpdateSystem();
    const update = new ComponentUpdateSystem();
    const processSystem = new ProcessSystem();
    this.scheduler.add(fixedUpdate);
    this.scheduler.add(update);
    this.scheduler.add(processSystem);
    this.scheduler.add(new ProcessFixedUpdateSystem(processSystem));
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

import { Transform } from "./Transform.js";
import type { Entity } from "./Entity.js";
import { Component } from "./Component.js";
import type { Scene } from "./Scene.js";
import type { SceneManager } from "./SceneManager.js";
import type { GameLoop } from "./GameLoop.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
import type { CallbackErrorRecord } from "./ErrorBoundary.js";
import {
  EngineContext,
  ErrorBoundaryKey,
  ServiceKey,
  SystemSchedulerKey,
} from "./EngineContext.js";
import {
  RandomKey,
  createDefaultRandomSeed,
  createRandomService,
  normalizeSeed,
  type InternalRandomService,
  type RandomService,
} from "./Random.js";
import { SceneTimeKey } from "./SceneTime.js";

// Duplicate service keys locally to avoid runtime deps on optional packages.
const InputManagerRuntimeKey = new ServiceKey<InputManagerLike>("inputManager");
const PhysicsWorldManagerRuntimeKey = new ServiceKey<PhysicsWorldManagerLike>(
  "physicsWorldManager",
);
const RendererRuntimeKey = new ServiceKey<RendererLike>("renderer");

/**
 * Mirrors `GamepadAxisKey` from `@yagejs/input` as a local union so the
 * Inspector contract gets compile-time literal checking without taking a
 * runtime dependency on the input package.
 */
type InspectorGamepadAxisKey =
  | "leftX"
  | "leftY"
  | "rightX"
  | "rightY"
  | "leftTrigger"
  | "rightTrigger";

/**
 * Options for synthetic pointer injection. Pass `id` / `type` / `isPrimary`
 * to drive a non-primary, touch, or pen pointer in deterministic tests. All
 * fields are optional and default to a primary mouse pointer with `id: 1`.
 */
interface InspectorPointerOpts {
  id?: number;
  type?: "mouse" | "pen" | "touch";
  isPrimary?: boolean;
}

interface InputManagerLike {
  fireKeyDown(code: string): void;
  fireKeyUp(code: string): void;
  firePointerMove(x: number, y: number, opts?: InspectorPointerOpts): void;
  firePointerDown(button?: 0 | 1 | 2, opts?: InspectorPointerOpts): void;
  firePointerUp(button?: 0 | 1 | 2, opts?: { id?: number }): void;
  /** `code` is a gamepad code string (e.g. `"GamepadA"`, `"GamepadLT"`). */
  fireGamepadButton(code: string, pressed: boolean): void;
  fireGamepadAxis(side: InspectorGamepadAxisKey, value: number): void;
  fireAction(name: string): void;
  clearAll(): void;
  snapshotState(): InputStateSnapshot;
}

interface PhysicsWorldManagerLike {
  getContext(scene: Scene): { world: PhysicsWorldLike } | undefined;
}

interface PhysicsWorldLike {
  snapshot(): PhysicsSnapshot;
}

interface RendererLike {
  application: {
    stage: unknown;
    renderer: {
      extract: {
        canvas(stage: unknown): HTMLCanvasElement;
      };
    };
  };
}

interface CameraComponentLike {
  enabled: boolean;
  position: { x: number; y: number };
  zoom: number;
  rotation: number;
  priority?: number;
  cameraName?: string;
}

interface UIElementLike {
  constructor: { name: string };
  children?: readonly UIElementLike[];
  yogaNode?: {
    getComputedLayout(): {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  };
}

/** Backward-compatible summary snapshot returned by query helpers. */
export interface EntitySnapshot {
  id: number;
  name: string;
  tags: string[];
  components: string[];
  position?: { x: number; y: number };
  /**
   * `entity.isActive` — own activeness AND every ancestor's. `getEntities()`
   * lists dormant entities; the name-based lookups do not, so this is how a
   * caller tells "asleep and reusable" from "gone".
   */
  active: boolean;
}

/** Backward-compatible scene stack summary. */
export interface SceneSnapshot {
  /** Inspector-assigned scene id — same value as `WorldSceneSnapshot.id`. */
  id: string;
  name: string;
  entityCount: number;
  paused: boolean;
}

/** Snapshot of a registered system. */
export interface SystemSnapshot {
  name: string;
  phase: string;
  priority: number;
  enabled: boolean;
}

/** Snapshot of error boundary state. */
export interface ErrorSnapshot {
  /**
   * Failures recorded via the error boundary, most recent last: system and
   * component update failures, plus developer callbacks (collision/event/
   * input/process handlers, scene lifecycle hooks, ...).
   */
  callbackErrors: CallbackErrorRecord[];
}

export interface ComponentStateSnapshot {
  type: string;
  state: unknown | null;
  /**
   * Namespaced, derived facets contributed by registered
   * {@link InspectorFacetContributor}s — e.g. the renderer publishes a `render`
   * facet (world-space bounds + visibility). Present only when at least one
   * contributor produced a facet for this component. Always computed live, never
   * from `serialize()`.
   */
  facets?: InspectorFacets;
}

/**
 * Open, augmentable map of namespaced Inspector facets. Core declares only the
 * index signature and stays agnostic of what any namespace means; a plugin that
 * registers an {@link InspectorFacetContributor} augments this interface via
 * `declare module "@yagejs/core"` to type its own key (the renderer adds
 * `render`, typed as its own `RenderFacetSnapshot`).
 */
export interface InspectorFacets {
  [namespace: string]: unknown;
}

/**
 * A plugin-registered contributor that augments component (and optionally
 * entity) snapshots with a namespaced facet derived from live, non-serialized
 * state — the seam that lets the renderer publish rendered geometry without
 * core taking a dependency on, or knowing anything about, the renderer.
 *
 * Register via {@link Inspector.registerFacetContributor}. Mirrors the
 * contributor pattern used elsewhere in the engine (`DebugContributor`,
 * save's `SnapshotContributor`): the owning plugin pushes capability in, rather
 * than core reaching out to grab it.
 */
export interface InspectorFacetContributor {
  /** Stable key the facet is attached under (e.g. `"render"`). */
  readonly namespace: string;
  /**
   * Facet for a single component, or `undefined`/`null` to contribute nothing.
   * Called once per component per snapshot. Throwing is tolerated (the facet is
   * simply omitted), but returning `undefined` is preferred.
   */
  inspectComponent(component: Component): unknown;
  /**
   * Optional entity-level facet, derived from the per-component facets this
   * contributor produced for the entity, in `add()` insertion order (including
   * `undefined` gaps for components that contributed nothing). Lets the owning
   * plugin decide how to surface one representative facet at the entity level —
   * e.g. the renderer picks the first painted component. Return
   * `undefined`/`null` to contribute no entity-level facet.
   */
  inspectEntity?(componentFacets: readonly unknown[]): unknown;
}

export interface WorldEntitySnapshot {
  id: string;
  type: string;
  parent: string | null;
  /**
   * `entity.isActive` — own activeness AND every ancestor's. Dormant entities
   * stay in the snapshot; they are out of queries and stop updating.
   */
  active: boolean;
  transform: {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  components: ComponentStateSnapshot[];
  /**
   * Entity-level namespaced facets, each surfaced by the contributor that owns
   * the namespace (see {@link InspectorFacetContributor.inspectEntity}). For the
   * renderer's `render` namespace this is the first painted component's facet —
   * a convenience for the common single-sprite/text case. Read the per-component
   * facets on {@link ComponentStateSnapshot.facets} to inspect the rest.
   */
  facets?: InspectorFacets;
}

export interface UINodeSnapshot {
  id: string;
  type: string;
  layout: { x: number; y: number; width: number; height: number };
  children: UINodeSnapshot[];
  state: unknown | null;
}

export interface UITreeSnapshot {
  root: UINodeSnapshot;
}

export interface PhysicsSnapshot {
  bodies: Array<{
    entityId: string;
    type: "dynamic" | "kinematic" | "static";
    position: { x: number; y: number };
    rotation: number;
    linvel: { x: number; y: number };
    angvel: number;
  }>;
  contacts: Array<{ a: string; b: string }>;
}

export interface EventLogEntry {
  frame: number;
  source: "bus" | "entity";
  type: string;
  targetId?: string;
  payload: unknown | null;
}

export interface WorldSceneSnapshot {
  id: string;
  name: string;
  paused: boolean;
  timeScale: number;
  /**
   * `scene.timeScale` composed with active `SceneTime` requests
   * (freeze/slow-mo) — the default scale for non-excluded updates and
   * scene-wide consumers such as physics.
   */
  effectiveTimeScale: number;
  /** True while the effective scale is 0 (hitstop/freeze frame in force). */
  frozen: boolean;
  seed: number;
  entities: WorldEntitySnapshot[];
  ui: UITreeSnapshot | null;
  physics: PhysicsSnapshot;
  events: EventLogEntry[];
}

export interface CameraSnapshot {
  sceneId: string;
  sceneName: string;
  name: string | null;
  priority: number;
  position: { x: number; y: number };
  zoom: number;
  rotation: number;
}

/**
 * Per-pointer entry in {@link InputStateSnapshot.pointers}. Mirrors the runtime
 * `PointerInfo` shape from `@yagejs/input`. Touch pointers vanish from the
 * array once their last button releases; mouse pointers persist.
 */
export interface PointerSnapshot {
  /** `PointerEvent.pointerId`, or the synthetic id passed via `firePointer*`. */
  id: number;
  x: number;
  y: number;
  type: "mouse" | "pen" | "touch";
  isPrimary: boolean;
  buttons: number[];
  down: boolean;
}

export interface InputStateSnapshot {
  keys: string[];
  actions: string[];
  /**
   * Aggregate / primary-pointer view, retained for back-compat. `x` / `y` track
   * the primary pointer's screen position; `buttons` / `down` reflect the
   * any-pointer aggregate that drives the `MouseLeft`/`Middle`/`Right` action codes.
   *
   * For multi-touch state, read {@link InputStateSnapshot.pointers}.
   */
  mouse: {
    x: number;
    y: number;
    buttons: number[];
    down: boolean;
  };
  /** All currently-tracked pointers (one per active mouse, pen, or finger). */
  pointers: PointerSnapshot[];
  gamepad: {
    /** Currently-held gamepad codes (e.g. `"GamepadA"`, `"GamepadLT"`). */
    buttons: string[];
    /**
     * Axis state keyed by `${padIndex}:${axisName}` (axisName is a
     * `GamepadAxisKey` from `@yagejs/input`).
     */
    axes: Array<{ key: string; value: number }>;
  };
}

/** Full deterministic inspector snapshot. */
export interface EngineSnapshot {
  version: 1;
  frame: number;
  sceneStack: SceneSnapshot[];
  entityCount: number;
  systemCount: number;
  errors: ErrorSnapshot;
  scenes: WorldSceneSnapshot[];
  camera: CameraSnapshot | null;
  input: InputStateSnapshot;
}

export interface InspectorTimeController {
  readonly isFrozen: boolean;
  freeze(): void;
  thaw(): void;
  /** `dtMs` overrides the configured per-frame delta for this call only. */
  stepFrames(count: number, dtMs?: number): void;
  setDelta(ms: number): void;
  getFrame(): number;
}

interface LoggedEvent {
  entry: EventLogEntry;
  sceneId: string | undefined;
}

interface EventWaiter {
  pattern: string | RegExp;
  source: "bus" | "entity" | undefined;
  withinFrames: number | undefined;
  deadlineFrame: number | undefined;
  resolve: (entry: EventLogEntry) => void;
  reject: (error: Error) => void;
}

/** Internal engine reference to avoid circular dependency with Engine class. */
interface EngineRef {
  readonly context: EngineContext;
  readonly scenes: SceneManager;
  readonly loop: GameLoop;
  readonly events?: EventBus<EngineEvents>;
}

/**
 * Programmatic runtime control and state queries for testing and debugging.
 * Exposed on `window.__yage__` in debug mode.
 */
export class Inspector {
  private readonly engine: EngineRef;
  private readonly extensions = new Map<string, object>();
  private readonly facetContributors = new Map<
    string,
    InspectorFacetContributor
  >();
  private readonly sceneIds = new WeakMap<Scene, string>();
  private nextSceneId = 0;
  private defaultSceneSeed: number | undefined;
  private sceneSeedOverride: number | undefined;
  private timeController: InspectorTimeController | null = null;
  private eventLogEnabled = false;
  private eventCapacity = 500;
  /**
   * Ring buffer of recent events. `eventLogHead` points at the oldest slot;
   * a full ring contains exactly `eventCapacity` entries. We avoid `splice` to
   * keep `appendEvent` O(1) — the previous shift-on-overflow approach was
   * O(n) per event once the buffer was full.
   */
  private eventLog: LoggedEvent[] = [];
  private eventLogHead = 0;
  private eventWaiters = new Set<EventWaiter>();
  private detachBusTap: (() => void) | null = null;
  private readonly busEventObserver = (
    event: keyof EngineEvents,
    data: EngineEvents[keyof EngineEvents],
  ): void => {
    this.recordBusEvent(String(event), data);
  };
  private readonly sceneEventObserver = (
    eventName: string,
    data: unknown,
    entity: Entity,
  ): void => {
    this.recordEntityEvent(eventName, data, entity);
  };

  readonly time = {
    freeze: (): void => {
      this.requireTimeController().freeze();
    },
    thaw: (): void => {
      this.requireTimeController().thaw();
    },
    step: (frames = 1): void => {
      this.assertNonNegativeInteger(frames, "Inspector.time.step(frames)");
      if (frames === 0) return;
      this.requireTimeController().stepFrames(frames);
      // Event matching happens inside appendEvent during the step. A trailing
      // pass here only needs to expire deadline waiters whose time ran out.
      this.expireDeadlineWaiters();
    },
    setDelta: (ms: number): void => {
      this.assertPositiveDelta(ms, "Inspector.time.setDelta(ms)");
      this.requireTimeController().setDelta(ms);
    },
    isFrozen: (): boolean => this.timeController?.isFrozen ?? false,
    getFrame: (): number =>
      this.timeController?.getFrame() ?? this.engine.loop.frameCount,
    /**
     * True if a real `GameLoop.tick()` happened within the last `withinMs`
     * (default 250) milliseconds of wall-clock time. Independent of
     * `isFrozen()`: a frozen clock that isn't being stepped reads `false`
     * (nothing is ticking), but a manual `step`/`stepUntil`/`stepAsync` fires a
     * real tick, so this reads `true` for `withinMs` after one. A
     * stalled-but-not-frozen game — a hung `await`, a runaway synchronous loop —
     * also reads `false`, the case this method exists to tell apart from
     * "frozen on purpose".
     */
    isAdvancing: (withinMs = 250): boolean => {
      const lastTickAt = this.engine.loop.lastTickAt;
      if (lastTickAt === 0) return false;
      return performance.now() - lastTickAt <= withinMs;
    },
    /**
     * Advance frame-by-frame until `predicate()` returns true, yielding a real
     * macrotask between frames so async work parked on the microtask queue —
     * a scene transition's `await`, a dialogue runner's promise chain — gets a
     * chance to settle before the next frame steps. Checks `predicate` before
     * the first frame (resolves `0` if already satisfied) and after each
     * subsequent frame. Throws if `predicate` is still false after
     * `opts.maxFrames` (default 600, i.e. 10s at 60fps).
     */
    stepUntil: async (
      predicate: () => boolean,
      opts?: { maxFrames?: number; dtMs?: number },
    ): Promise<number> => {
      if (predicate()) return 0;
      const maxFrames = opts?.maxFrames ?? 600;
      this.assertNonNegativeInteger(
        maxFrames,
        "Inspector.time.stepUntil(maxFrames)",
      );
      if (opts?.dtMs !== undefined) {
        this.assertPositiveDelta(opts.dtMs, "Inspector.time.stepUntil(dtMs)");
      }
      const controller = this.requireTimeController();
      for (let frame = 1; frame <= maxFrames; frame++) {
        controller.stepFrames(1, opts?.dtMs);
        this.expireDeadlineWaiters();
        await yieldMacrotask();
        if (predicate()) return frame;
      }
      throw new Error(
        `Inspector.time.stepUntil(): predicate still false after ${maxFrames} frames.`,
      );
    },
    /**
     * Advance a fixed number of frames, yielding a real macrotask between each
     * so the same async draining as {@link stepUntil} applies — for call sites
     * that already know how many frames they need.
     */
    stepAsync: async (
      frames = 1,
      opts?: { dtMs?: number },
    ): Promise<void> => {
      this.assertNonNegativeInteger(frames, "Inspector.time.stepAsync(frames)");
      if (opts?.dtMs !== undefined) {
        this.assertPositiveDelta(opts.dtMs, "Inspector.time.stepAsync(dtMs)");
      }
      const controller = this.requireTimeController();
      for (let i = 0; i < frames; i++) {
        controller.stepFrames(1, opts?.dtMs);
        this.expireDeadlineWaiters();
        await yieldMacrotask();
      }
    },
  };

  readonly input = {
    keyDown: (code: string): void => {
      this.requireInputManager().fireKeyDown(code);
    },
    keyUp: (code: string): void => {
      this.requireInputManager().fireKeyUp(code);
    },
    mouseMove: (x: number, y: number): void => {
      this.requireInputManager().firePointerMove(x, y);
    },
    mouseDown: (button: 0 | 1 | 2 = 0): void => {
      this.requireInputManager().firePointerDown(button);
    },
    mouseUp: (button: 0 | 1 | 2 = 0): void => {
      this.requireInputManager().firePointerUp(button);
    },
    /**
     * Inject a synthetic pointer-move with full pointer addressing. Pass `opts`
     * with `id` / `type: "touch"` to drive a specific finger; defaults match
     * the primary mouse pointer (same as `mouseMove`).
     */
    pointerMove: (
      x: number,
      y: number,
      opts?: InspectorPointerOpts,
    ): void => {
      this.requireInputManager().firePointerMove(x, y, opts);
    },
    /**
     * Inject a synthetic pointer-down. With `opts.id` and `opts.type: "touch"`
     * this drives a multi-touch contact, exercising `getPointers()`,
     * per-pointer event hooks, and the any-pointer aggregate for `MouseLeft`.
     */
    pointerDown: (
      button: 0 | 1 | 2 = 0,
      opts?: InspectorPointerOpts,
    ): void => {
      this.requireInputManager().firePointerDown(button, opts);
    },
    pointerUp: (
      button: 0 | 1 | 2 = 0,
      opts?: { id?: number },
    ): void => {
      this.requireInputManager().firePointerUp(button, opts);
    },
    gamepadButton: (code: string, pressed: boolean): void => {
      this.requireInputManager().fireGamepadButton(code, pressed);
    },
    gamepadAxis: (
      side: InspectorGamepadAxisKey,
      value: number,
    ): void => {
      this.requireInputManager().fireGamepadAxis(side, value);
    },
    tap: (code: string, frames = 1): void => {
      this.assertNonNegativeInteger(frames, "Inspector.input.tap(frames)");
      const input = this.requireInputManager();
      input.fireKeyDown(code);
      try {
        this.time.step(frames);
      } finally {
        input.fireKeyUp(code);
      }
    },
    hold: (code: string, frames: number): void => {
      this.assertNonNegativeInteger(frames, "Inspector.input.hold(frames)");
      const input = this.requireInputManager();
      input.fireKeyDown(code);
      try {
        this.time.step(frames);
      } finally {
        input.fireKeyUp(code);
      }
    },
    fireAction: (name: string, frames = 1): void => {
      this.assertNonNegativeInteger(
        frames,
        "Inspector.input.fireAction(frames)",
      );
      const input = this.requireInputManager();
      for (let i = 0; i < frames; i++) {
        input.fireAction(name);
        this.time.step(1);
      }
    },
    clearAll: (): void => {
      this.requireInputManager().clearAll();
    },
  };

  readonly events = {
    getLog: (): EventLogEntry[] =>
      this.iterateLog().map(({ entry }) => ({ ...entry })),
    clearLog: (): void => {
      this.eventLog.length = 0;
      this.eventLogHead = 0;
    },
    /**
     * Turn event-log recording on/off at runtime. Off means zero per-event
     * allocation: the EventBus tap detaches and `recordBusEvent` is never
     * called. `DebugConfig.eventLog` controls the startup default; this is
     * the runtime switch for toggling mid-session.
     */
    setEnabled: (enabled: boolean): void => {
      this.setEventLogEnabled(enabled);
    },
    isEnabled: (): boolean => this.eventLogEnabled,
    setCapacity: (n: number): void => {
      this.assertNonNegativeInteger(
        n,
        "Inspector.events.setCapacity(capacity)",
      );
      // `slice(-0)` is `slice(0)` (returns the whole array), so guard zero
      // explicitly — otherwise setCapacity(0) would leave stale entries.
      const ordered = n === 0 ? [] : this.iterateLog().slice(-n);
      this.eventCapacity = n;
      this.eventLog = ordered;
      this.eventLogHead = 0;
    },
    waitFor: (
      pattern: string | RegExp,
      options?: {
        withinFrames?: number;
        source?: "bus" | "entity";
      },
    ): Promise<EventLogEntry> => {
      const existing = this.findMatchingEvent(pattern, options?.source);
      if (existing) return Promise.resolve(existing);

      const withinFrames = options?.withinFrames;
      if (
        withinFrames !== undefined &&
        (!Number.isInteger(withinFrames) || withinFrames < 0)
      ) {
        throw new Error(
          "Inspector.events.waitFor(withinFrames) requires a non-negative integer.",
        );
      }

      return new Promise<EventLogEntry>((resolve, reject) => {
        const waiter: EventWaiter = {
          pattern,
          source: options?.source,
          withinFrames,
          deadlineFrame:
            withinFrames !== undefined
              ? this.time.getFrame() + withinFrames
              : undefined,
          resolve,
          reject,
        };
        this.eventWaiters.add(waiter);
      });
    },
  };

  readonly capture = {
    png: async (): Promise<Uint8Array> => {
      const base64 = await this.capture.pngBase64();
      return decodeBase64(base64);
    },
    dataURL: async (): Promise<string> => {
      const renderer = this.engine.context.tryResolve(RendererRuntimeKey);
      if (!renderer) {
        throw new Error(
          "Inspector.capture requires RendererPlugin to be active.",
        );
      }
      const canvas = renderer.application.renderer.extract.canvas(
        renderer.application.stage,
      );
      return canvas.toDataURL("image/png");
    },
    pngBase64: async (): Promise<string> => {
      const dataUrl = await this.capture.dataURL();
      const comma = dataUrl.indexOf(",");
      return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
    },
  };

  constructor(engine: EngineRef) {
    this.engine = engine;
  }

  /** Register a namespaced extension API for plugin-specific debug helpers. */
  addExtension<T extends object>(namespace: string, api: T): T {
    this.assertNonEmptyString(
      namespace,
      "Inspector.addExtension(namespace)",
    );
    if (!api || typeof api !== "object") {
      throw new Error("Inspector.addExtension(api) requires an object.");
    }
    if (this.extensions.has(namespace)) {
      throw new Error(
        `Inspector.addExtension(): namespace "${namespace}" is already registered.`,
      );
    }
    this.extensions.set(namespace, api);
    return api;
  }

  /** Look up a previously registered extension API by namespace. */
  getExtension<T extends object>(namespace: string): T | undefined {
    this.assertNonEmptyString(
      namespace,
      "Inspector.getExtension(namespace)",
    );
    return this.extensions.get(namespace) as T | undefined;
  }

  /** Remove a previously registered extension namespace. */
  removeExtension(namespace: string): void {
    this.assertNonEmptyString(
      namespace,
      "Inspector.removeExtension(namespace)",
    );
    this.extensions.delete(namespace);
  }

  /**
   * Register an {@link InspectorFacetContributor} so a plugin can augment
   * component/entity snapshots with a namespaced facet (e.g. the renderer's
   * `render` geometry). Returns an unregister function; call it on plugin
   * teardown. Re-registering a namespace replaces the prior contributor
   * (mirrors save's `registerSnapshotExtra`).
   */
  registerFacetContributor(contributor: InspectorFacetContributor): () => void {
    this.assertNonEmptyString(
      contributor.namespace,
      "Inspector.registerFacetContributor(namespace)",
    );
    this.facetContributors.set(contributor.namespace, contributor);
    return () => {
      if (this.facetContributors.get(contributor.namespace) === contributor) {
        this.facetContributors.delete(contributor.namespace);
      }
    };
  }

  /** Full deterministic state snapshot (stable ordering, serializable). */
  snapshot(): EngineSnapshot {
    const scenes = this.engine.scenes.all.map((scene) =>
      this.sceneToWorldSnapshot(scene),
    );
    return {
      version: 1,
      frame: this.time.getFrame(),
      sceneStack: this.getSceneStack(),
      entityCount: this.countEntities(),
      systemCount: this.getSystems().length,
      errors: this.getErrors(),
      scenes,
      camera: this.buildCameraSnapshot(),
      input: this.buildInputSnapshot(),
    };
  }

  /** Stable JSON form of {@link snapshot}. */
  snapshotJSON(): string {
    return stableStringify(this.snapshot());
  }

  /**
   * Snapshot one scene by its public `scene.name` or its inspector-assigned
   * id (`snapshot().scenes[].id`). Name is tried first. If more than one
   * active scene shares that name, throws rather than guessing — pass the id
   * instead. Falls back to an id match when no scene has that name.
   */
  snapshotScene(nameOrId: string): WorldSceneSnapshot {
    const byName = this.engine.scenes.all.filter(
      (candidate) => candidate.name === nameOrId,
    );
    if (byName.length > 1) {
      throw new Error(
        `Inspector.snapshotScene(): "${nameOrId}" matches ${byName.length} active scenes; ` +
          `use the scene id from snapshot().scenes[].id instead.`,
      );
    }
    const scene =
      byName[0] ??
      this.engine.scenes.all.find(
        (candidate) => this.getSceneId(candidate) === nameOrId,
      );
    if (!scene) {
      throw new Error(
        `Inspector.snapshotScene(): unknown scene name or id "${nameOrId}".`,
      );
    }
    return this.sceneToWorldSnapshot(scene);
  }

  /** Find entity by name in the active scene. */
  getEntityByName(name: string): EntitySnapshot | undefined {
    const entity = this.findActiveEntity(name);
    if (!entity) return undefined;
    return this.entityToQuerySnapshot(entity);
  }

  /** Get entity position (from Transform component). */
  getEntityPosition(name: string): { x: number; y: number } | undefined {
    const entity = this.findActiveEntity(name);
    if (!entity) return undefined;
    const transform = this.getTransform(entity);
    if (!transform) return undefined;
    return { x: transform.position.x, y: transform.position.y };
  }

  /** Check if an entity has a component by class name string. */
  hasComponent(entityName: string, componentClass: string): boolean {
    return this.findComponentByName(entityName, componentClass) !== undefined;
  }

  /** Get component data (serializable subset) by class name string. */
  getComponentData(entityName: string, componentClass: string): unknown {
    const comp = this.findComponentByName(entityName, componentClass);
    if (!comp) return undefined;
    return this.reflectComponentState(comp);
  }

  /** Get all entities in the active scene as lightweight snapshots. */
  getEntities(): EntitySnapshot[] {
    const scene = this.engine.scenes.active;
    if (!scene) return [];
    const result: EntitySnapshot[] = [];
    for (const entity of scene.getEntities()) {
      if (!entity.isDestroyed) {
        result.push(this.entityToQuerySnapshot(entity));
      }
    }
    return result;
  }

  /** Get scene stack info. */
  getSceneStack(): SceneSnapshot[] {
    return this.engine.scenes.all.map((scene) => ({
      id: this.getSceneId(scene),
      name: scene.name,
      entityCount: scene.getEntities().size,
      paused: scene.isPaused,
    }));
  }

  /** Get active system info. */
  getSystems(): SystemSnapshot[] {
    const scheduler = this.engine.context.tryResolve(SystemSchedulerKey);
    if (!scheduler) return [];
    return scheduler.getAllSystems().map((sys) => ({
      name: sys.constructor.name,
      phase: sys.phase,
      priority: sys.priority,
      enabled: sys.enabled,
    }));
  }

  /** Get recorded failures from the error boundary. */
  getErrors(): ErrorSnapshot {
    const boundary = this.engine.context.tryResolve(ErrorBoundaryKey);
    if (!boundary) return { callbackErrors: [] };
    return { callbackErrors: [...boundary.getCallbackErrors()] };
  }

  /** Create a new scene-scoped RNG instance using the current inspector seed policy. */
  createSceneRandom(): RandomService {
    const seed =
      this.sceneSeedOverride ?? this.defaultSceneSeed ?? createDefaultRandomSeed();
    return createRandomService(seed);
  }

  /** Force every current and future scene RNG to the provided seed. */
  setSeed(seed: number): void {
    const normalized = normalizeSeed(seed);
    this.sceneSeedOverride = normalized;
    for (const scene of this.engine.scenes.all) {
      this.resolveInternalRandom(scene)?.setSeed(normalized);
    }
  }

  /** @internal DebugPlugin installs a deterministic default seed through this hook. */
  setDefaultSceneSeed(seed: number | undefined): void {
    this.defaultSceneSeed =
      seed === undefined ? undefined : normalizeSeed(seed);
    if (this.sceneSeedOverride !== undefined || this.defaultSceneSeed === undefined) {
      return;
    }
    for (const scene of this.engine.scenes.all) {
      this.resolveInternalRandom(scene)?.setSeed(this.defaultSceneSeed);
    }
  }

  private resolveInternalRandom(scene: Scene): InternalRandomService | undefined {
    return scene._resolveScoped(RandomKey) as
      | InternalRandomService
      | undefined;
  }

  /** @internal DebugPlugin attaches the frozen-time controller through this hook. */
  attachTimeController(controller: InspectorTimeController): void {
    this.timeController = controller;
  }

  /** @internal Clear a previously attached time controller. */
  detachTimeController(controller?: InspectorTimeController): void {
    if (!controller || this.timeController === controller) {
      this.timeController = null;
    }
  }

  /** @internal Enable or disable event log recording. */
  setEventLogEnabled(enabled: boolean): void {
    if (this.eventLogEnabled === enabled) return;
    this.eventLogEnabled = enabled;

    if (enabled) {
      if (!this.detachBusTap && this.engine.events?.tap) {
        this.detachBusTap = this.engine.events.tap(this.busEventObserver);
      }
    } else {
      this.detachBusTap?.();
      this.detachBusTap = null;
    }

    for (const scene of this.engine.scenes.all) {
      if (enabled) {
        this.attachSceneEventObserver(scene);
      } else {
        this.detachSceneEventObserver(scene);
      }
    }
  }

  /** @internal Install entity-event observation for one scene. No-op if disabled. */
  attachSceneEventObserver(scene: Scene): void {
    if (!this.eventLogEnabled) return;
    scene._setEntityEventObserver(this.sceneEventObserver);
  }

  /** @internal Clear entity-event observation for one scene. */
  detachSceneEventObserver(scene: Scene): void {
    scene._setEntityEventObserver(undefined);
  }

  /** @internal Scene hooks forward entity events through this method. */
  recordEntityEvent(eventName: string, data: unknown, entity: Entity): void {
    if (!this.eventLogEnabled) return;
    const scene = entity.tryScene;
    this.appendEvent(
      {
        frame: this.time.getFrame(),
        source: "entity",
        type: eventName,
        targetId: String(entity.id),
        payload: serializeEventPayload(data),
      },
      scene ? this.getSceneId(scene) : undefined,
    );
  }

  /** @internal Engine teardown releases the event-bus tap through this hook. */
  dispose(): void {
    this.detachBusTap?.();
    this.detachBusTap = null;
    for (const scene of this.engine.scenes.all) {
      scene._setEntityEventObserver(undefined);
    }
    this.extensions.clear();
    this.facetContributors.clear();
  }

  private requireTimeController(): InspectorTimeController {
    if (!this.timeController) {
      throw new Error(
        "Inspector.time requires DebugPlugin to be active.",
      );
    }
    return this.timeController;
  }

  private requireInputManager(): InputManagerLike {
    const input = this.engine.context.tryResolve(InputManagerRuntimeKey);
    if (!input) {
      throw new Error(
        "Inspector.input requires InputPlugin to be active.",
      );
    }
    return input;
  }

  private recordBusEvent(type: string, data: unknown): void {
    if (!this.eventLogEnabled) return;
    this.appendEvent(
      {
        frame: this.time.getFrame(),
        source: "bus",
        type,
        payload: serializeEventPayload(data),
      },
      this.inferSceneIdFromPayload(data),
    );
  }

  private appendEvent(entry: EventLogEntry, sceneId: string | undefined): void {
    if (this.eventCapacity === 0) {
      this.flushMatchingWaiter(entry);
      return;
    }
    const logged: LoggedEvent = { entry, sceneId };
    if (this.eventLog.length < this.eventCapacity) {
      this.eventLog.push(logged);
    } else {
      // Ring full: overwrite the oldest slot in O(1) and advance the head.
      this.eventLog[this.eventLogHead] = logged;
      this.eventLogHead =
        (this.eventLogHead + 1) % this.eventCapacity;
    }
    this.flushMatchingWaiter(entry);
  }

  /** Resolve waiters whose deadline has passed without a match. */
  private expireDeadlineWaiters(): void {
    if (this.eventWaiters.size === 0) return;
    const frame = this.time.getFrame();
    for (const waiter of [...this.eventWaiters]) {
      if (
        waiter.deadlineFrame !== undefined &&
        frame > waiter.deadlineFrame
      ) {
        this.eventWaiters.delete(waiter);
        waiter.reject(
          new Error(
            `Inspector.events.waitFor() timed out after ${waiter.withinFrames} frames.`,
          ),
        );
      }
    }
  }

  /** Resolve any waiter that matches the just-appended entry. */
  private flushMatchingWaiter(entry: EventLogEntry): void {
    if (this.eventWaiters.size === 0) return;
    for (const waiter of [...this.eventWaiters]) {
      if (this.eventMatches(entry, waiter.pattern, waiter.source)) {
        this.eventWaiters.delete(waiter);
        waiter.resolve(entry);
      }
    }
  }

  /**
   * Walk the ring buffer in chronological order. We avoid materializing the
   * ordered array on every event append; instead, every consumer that needs
   * order calls this helper.
   */
  private iterateLog(): LoggedEvent[] {
    if (this.eventLog.length < this.eventCapacity || this.eventLogHead === 0) {
      return this.eventLog;
    }
    return [
      ...this.eventLog.slice(this.eventLogHead),
      ...this.eventLog.slice(0, this.eventLogHead),
    ];
  }

  private findMatchingEvent(
    pattern: string | RegExp,
    source: "bus" | "entity" | undefined,
  ): EventLogEntry | undefined {
    for (const { entry } of this.iterateLog()) {
      if (this.eventMatches(entry, pattern, source)) {
        return { ...entry };
      }
    }
    return undefined;
  }

  private eventMatches(
    entry: EventLogEntry,
    pattern: string | RegExp,
    source: "bus" | "entity" | undefined,
  ): boolean {
    if (source && entry.source !== source) return false;
    return typeof pattern === "string"
      ? entry.type === pattern
      : pattern.test(entry.type);
  }

  private sceneToWorldSnapshot(scene: Scene): WorldSceneSnapshot {
    const random = scene._resolveScoped(RandomKey);
    const time = scene.tryResolveScoped(SceneTimeKey);
    const physicsManager = this.engine.context.tryResolve(
      PhysicsWorldManagerRuntimeKey,
    );
    return {
      id: this.getSceneId(scene),
      name: scene.name,
      paused: scene.isPaused,
      timeScale: scene.timeScale,
      effectiveTimeScale: time?.effectiveScale ?? scene.timeScale,
      frozen: time?.isFrozen ?? scene.timeScale === 0,
      seed: random?.getSeed() ?? 0,
      entities: this.getSceneEntities(scene),
      ui: this.buildUISnapshot(scene),
      physics:
        physicsManager?.getContext(scene)?.world.snapshot() ?? {
          bodies: [],
          contacts: [],
        },
      events: this.getSceneEvents(scene),
    };
  }

  private getSceneEntities(scene: Scene): WorldEntitySnapshot[] {
    return [...scene.getEntities()]
      .filter((entity) => !entity.isDestroyed)
      .sort((a, b) => a.id - b.id)
      .map((entity) => this.entityToWorldSnapshot(entity));
  }

  private entityToWorldSnapshot(entity: Entity): WorldEntitySnapshot {
    const transform = entity.has(Transform) ? entity.get(Transform) : undefined;
    const worldPosition = transform?.worldPosition;
    const worldScale = transform?.worldScale;
    const contributors = [...this.facetContributors.values()];
    // Per-namespace, ordered list of the facets each contributor produced for
    // this entity's components — fed to `inspectEntity` so the owning plugin can
    // surface one representative facet at the entity level. Built in component
    // insertion order (the order the entity `add()`ed them).
    const facetsByNamespace = new Map<string, unknown[]>();
    // Snapshot components in their insertion order first, then sort a copy for
    // stable output. Entity-level facets are derived from the insertion-order
    // pass below so a contributor's "first such component" pick is deliberate,
    // not an accident of where the class name happens to sort.
    const insertionOrder = [...entity.getAll()].map((component) =>
      this.componentToSnapshot(component, contributors, facetsByNamespace),
    );
    const components = [...insertionOrder].sort((a, b) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
    );

    const snapshot: WorldEntitySnapshot = {
      id: String(entity.id),
      type: entity.constructor.name,
      parent: entity.parent ? String(entity.parent.id) : null,
      active: entity.isActive,
      transform: {
        x: worldPosition?.x ?? 0,
        y: worldPosition?.y ?? 0,
        rotation: transform?.worldRotation ?? 0,
        scaleX: worldScale?.x ?? 1,
        scaleY: worldScale?.y ?? 1,
      },
      components,
    };
    const entityFacets = this.collectEntityFacets(
      contributors,
      facetsByNamespace,
    );
    if (entityFacets) snapshot.facets = entityFacets;
    return snapshot;
  }

  private componentToSnapshot(
    component: Component,
    contributors: readonly InspectorFacetContributor[],
    facetsByNamespace: Map<string, unknown[]>,
  ): ComponentStateSnapshot {
    const snapshot: ComponentStateSnapshot = {
      type: component.constructor.name,
      state: this.reflectComponentState(component),
    };
    let facets: Record<string, unknown> | undefined;
    for (const contributor of contributors) {
      const facet = tryInspectComponentFacet(contributor, component);
      let list = facetsByNamespace.get(contributor.namespace);
      if (!list) {
        list = [];
        facetsByNamespace.set(contributor.namespace, list);
      }
      list.push(facet);
      if (facet !== undefined) {
        (facets ??= {})[contributor.namespace] = facet;
      }
    }
    if (facets) snapshot.facets = facets;
    return snapshot;
  }

  /**
   * A component's `serialize()` result if it defines one, else its reflected
   * public state (own properties + getters — see
   * {@link serializeComponentOwnProperties}) so a component reports something
   * useful in a snapshot without opting in. The reflected object is routed
   * through `safeClone` for cycle-safety: `isSerializableValue` only checks
   * that a value's *own* shape is a plain object/array, not that everything
   * nested inside it is acyclic.
   */
  private reflectComponentState(component: Component): unknown {
    if (typeof component.serialize === "function") {
      return trySerialize(component) ?? null;
    }
    return safeClone(this.serializeComponentOwnProperties(component)) ?? null;
  }

  /**
   * Ask each contributor with an `inspectEntity` hook for its entity-level
   * facet, derived from the per-component facets gathered during the component
   * pass. Returns `undefined` when no contributor surfaced anything.
   */
  private collectEntityFacets(
    contributors: readonly InspectorFacetContributor[],
    facetsByNamespace: Map<string, unknown[]>,
  ): Record<string, unknown> | undefined {
    let facets: Record<string, unknown> | undefined;
    for (const contributor of contributors) {
      if (!contributor.inspectEntity) continue;
      const list = facetsByNamespace.get(contributor.namespace) ?? [];
      let facet: unknown;
      try {
        facet = contributor.inspectEntity(list);
      } catch {
        facet = undefined;
      }
      if (facet !== undefined && facet !== null) {
        (facets ??= {})[contributor.namespace] = facet;
      }
    }
    return facets;
  }

  private buildUISnapshot(scene: Scene): UITreeSnapshot | null {
    const roots = [...scene.getEntities()]
      .filter((entity) => !entity.isDestroyed)
      .flatMap((entity) =>
        [...entity.getAll()]
          .filter(
            (component) =>
              component.constructor.name === "UISurface" &&
              "root" in (component as object),
          )
          .map((component, index) =>
            this.buildUINodeSnapshot(
              (component as Component & { root: UIElementLike }).root,
              `entity-${entity.id}:UISurface:${index}`,
            ),
          ),
      );

    if (roots.length === 0) return null;
    if (roots.length === 1) {
      return { root: roots[0]! };
    }

    return {
      root: {
        id: `scene-${this.getSceneId(scene)}:ui`,
        type: "UIRoot",
        layout: { x: 0, y: 0, width: 0, height: 0 },
        children: roots,
        state: null,
      },
    };
  }

  private buildUINodeSnapshot(
    node: UIElementLike,
    id: string,
  ): UINodeSnapshot {
    const layout = node.yogaNode?.getComputedLayout();
    const children = (node.children ?? []).map((child, index) =>
      this.buildUINodeSnapshot(child, `${id}/${index}`),
    );
    return {
      id,
      type: node.constructor.name,
      layout: {
        x: layout?.left ?? 0,
        y: layout?.top ?? 0,
        width: layout?.width ?? 0,
        height: layout?.height ?? 0,
      },
      children,
      state: null,
    };
  }

  private buildCameraSnapshot(): CameraSnapshot | null {
    const match = this.findTopmostCamera();
    if (!match) return null;
    const { scene, camera } = match;
    return {
      sceneId: this.getSceneId(scene),
      sceneName: scene.name,
      name: camera.cameraName ?? null,
      priority: camera.priority ?? 0,
      position: {
        x: camera.position.x,
        y: camera.position.y,
      },
      zoom: camera.zoom,
      rotation: camera.rotation,
    };
  }

  private findTopmostCamera():
    | { scene: Scene; camera: CameraComponentLike }
    | undefined {
    const stack = this.engine.scenes.all;
    for (let i = stack.length - 1; i >= 0; i--) {
      const scene = stack[i];
      if (!scene) continue;

      let highest: CameraComponentLike | undefined;
      for (const entity of scene.getEntities()) {
        // Matches DisplaySystem, which reaches cameras through a query and so
        // never sees a dormant one.
        if (entity.isDestroyed || !entity.isActive) continue;
        for (const component of entity.getAll()) {
          if (component.constructor.name !== "CameraComponent") continue;
          const camera = component as unknown as CameraComponentLike;
          if (
            camera.enabled &&
            (!highest || (camera.priority ?? 0) > (highest.priority ?? 0))
          ) {
            highest = camera;
          }
        }
      }

      if (highest) {
        return { scene, camera: highest };
      }
    }

    return undefined;
  }

  private buildInputSnapshot(): InputStateSnapshot {
    const input = this.engine.context.tryResolve(InputManagerRuntimeKey);
    return (
      input?.snapshotState() ?? {
        keys: [],
        actions: [],
        mouse: { x: 0, y: 0, buttons: [], down: false },
        pointers: [],
        gamepad: { buttons: [], axes: [] },
      }
    );
  }

  private getSceneEvents(scene: Scene): EventLogEntry[] {
    const sceneId = this.getSceneId(scene);
    return this.iterateLog()
      .filter((entry) => entry.sceneId === sceneId)
      .map(({ entry }) => ({ ...entry }));
  }

  private inferSceneIdFromPayload(data: unknown): string | undefined {
    if (!data || typeof data !== "object") return undefined;
    const record = data as Record<string, unknown>;

    const scene =
      this.extractScene(record["scene"]) ??
      this.extractSceneFromEntity(record["entity"]) ??
      this.extractSceneFromEntity(record["oldScene"]) ??
      this.extractSceneFromEntity(record["newScene"]);

    return scene ? this.getSceneId(scene) : undefined;
  }

  private extractScene(value: unknown): Scene | undefined {
    if (!value || typeof value !== "object") return undefined;
    return this.engine.scenes.all.find((scene) => scene === value);
  }

  private extractSceneFromEntity(value: unknown): Scene | undefined {
    if (!value || typeof value !== "object") return undefined;
    const maybeEntity = value as { tryScene?: Scene | null };
    return maybeEntity.tryScene ?? this.extractScene(value);
  }

  /**
   * Name lookup for the query helpers. `findEntity` skips dormant entities,
   * so a deactivated entity reads as absent here — `getEntities()` is where
   * its `active: false` entry shows up.
   */
  private findActiveEntity(name: string): Entity | undefined {
    return this.engine.scenes.active?.findEntity(name);
  }

  private findComponentByName(
    entityName: string,
    componentClass: string,
  ): Component | undefined {
    const entity = this.findActiveEntity(entityName);
    if (!entity) return undefined;
    for (const comp of entity.getAll()) {
      if (comp.constructor.name === componentClass) return comp;
    }
    return undefined;
  }

  private entityToQuerySnapshot(entity: Entity): EntitySnapshot {
    const transform = this.getTransform(entity);
    const snapshot: EntitySnapshot = {
      id: entity.id,
      name: entity.name,
      tags: [...entity.tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      components: [...entity.getAll()]
        .map((component) => component.constructor.name)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      active: entity.isActive,
    };
    if (transform) {
      snapshot.position = {
        x: transform.position.x,
        y: transform.position.y,
      };
    }
    return snapshot;
  }

  private getTransform(entity: Entity): Transform | undefined {
    return entity.has(Transform) ? entity.get(Transform) : undefined;
  }

  /**
   * Reflect a component's own enumerable fields plus its public prototype
   * getters — the zero-config fallback when a component defines no
   * `serialize()`. Getters make derived read-only state (`get isOnCooldown()`,
   * `get health()`) visible without the component author writing a
   * `serialize()` just to expose them.
   */
  private serializeComponentOwnProperties(comp: Component): unknown {
    // `enabled` lives on Component.prototype as an accessor, so neither loop
    // below reaches it — but it is the one base-class field worth reporting.
    const result: Record<string, unknown> = { enabled: comp.enabled };
    for (const key of Object.getOwnPropertyNames(comp)) {
      if (key === "entity") continue;
      // Skip private-by-convention fields. Components hold pixi/rapier handles
      // (e.g. _body) on underscore-prefixed slots; exposing them in
      // snapshots would either crash JSON.stringify on cycles or leak
      // meaningless object identities.
      if (key.startsWith("_")) continue;
      let value: unknown;
      try {
        value = (comp as unknown as Record<string, unknown>)[key];
      } catch {
        // Own accessor property whose getter threw — skip it, same as a
        // prototype getter below, rather than blank the whole snapshot.
        continue;
      }
      if (!isSerializableValue(value)) continue;
      result[key] = value;
    }
    for (const key of this.collectGetterNames(comp)) {
      if (key in result) continue;
      let value: unknown;
      try {
        value = (comp as unknown as Record<string, unknown>)[key];
      } catch {
        // Getter threw (e.g. reads a sibling that isn't attached yet) — skip
        // it rather than let one bad getter blank the whole snapshot.
        continue;
      }
      if (!isSerializableValue(value)) continue;
      result[key] = value;
    }
    return result;
  }

  /**
   * Public getter names declared anywhere from `comp`'s own prototype up to
   * (excluding) `Component.prototype` — so a subclass's `get isOnCooldown()`
   * is reflected, but the base class's own getters (`scene`, `context`) never
   * are, since those resolve entity/DI wiring rather than component state.
   */
  private collectGetterNames(comp: Component): string[] {
    const names = new Set<string>();
    let proto: object | null = Object.getPrototypeOf(comp) as object | null;
    while (proto && proto !== Component.prototype) {
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(proto),
      )) {
        if (key === "constructor" || key.startsWith("_")) continue;
        if (typeof descriptor.get === "function") names.add(key);
      }
      proto = Object.getPrototypeOf(proto) as object | null;
    }
    return [...names];
  }

  private countEntities(): number {
    let count = 0;
    for (const scene of this.engine.scenes.all) {
      for (const entity of scene.getEntities()) {
        if (!entity.isDestroyed) count++;
      }
    }
    return count;
  }

  private getSceneId(scene: Scene): string {
    let id = this.sceneIds.get(scene);
    if (!id) {
      this.nextSceneId++;
      id = `scene-${this.nextSceneId}`;
      this.sceneIds.set(scene, id);
    }
    return id;
  }

  private assertNonNegativeInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} requires a non-negative integer.`);
    }
  }

  private assertPositiveDelta(ms: number, name: string): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error(`${name} requires a positive number.`);
    }
  }

  private assertNonEmptyString(value: string, name: string): void {
    if (value.trim().length === 0) {
      throw new Error(`${name} requires a non-empty string.`);
    }
  }
}

function isSerializableValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const t = typeof value;
  if (t === "function") return false;
  if (t !== "object") return true;
  if (Array.isArray(value)) return true;
  // Plain objects pass; class instances (Pixi, Rapier, Yoga, etc.) don't.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Yield to a real macrotask (not just a microtask/`Promise.resolve()`), so
 * any microtask chain queued during the synchronous `stepFrames()` call above
 * it — a scene transition's `await`, a dialogue runner's promise chain — gets
 * to fully drain before the next frame steps. Posting through a
 * `MessageChannel` schedules a genuine macrotask in both browsers and Node,
 * without `setTimeout`'s minimum-delay clamping.
 */
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

function safeClone(value: unknown): unknown | undefined {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

function trySerialize(component: Component): unknown | undefined {
  try {
    return safeClone(component.serialize?.());
  } catch {
    return undefined;
  }
}

/**
 * Invoke a contributor's `inspectComponent` hook, tolerating one that throws
 * (mid-teardown, no parent yet, etc.) — mirroring {@link trySerialize}.
 * Normalises a `null`/`undefined` result to `undefined` so the caller can omit
 * the namespace entirely.
 */
function tryInspectComponentFacet(
  contributor: InspectorFacetContributor,
  component: Component,
): unknown {
  try {
    const facet = contributor.inspectComponent(component);
    return facet === undefined || facet === null ? undefined : facet;
  } catch {
    return undefined;
  }
}

function serializeEventPayload(payload: unknown): unknown | null {
  if (payload === undefined) return null;
  const cloned = safeClone(payload);
  return cloned === undefined ? { _unserializable: true } : cloned;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );
    const result: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      result[key] = sortJsonValue(child);
    }
    return result;
  }

  return value;
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const bufferCtor = (globalThis as {
    Buffer?: {
      from(value: string, encoding: "base64"): Uint8Array;
    };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(base64, "base64");
  }

  throw new Error("Inspector.capture.png() is not supported in this environment.");
}

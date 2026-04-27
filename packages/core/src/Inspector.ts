import { Transform } from "./Transform.js";
import type { Entity } from "./Entity.js";
import type { Component } from "./Component.js";
import type { Scene } from "./Scene.js";
import type { SceneManager } from "./SceneManager.js";
import type { GameLoop } from "./GameLoop.js";
import type { EventBus, EngineEvents } from "./EventBus.js";
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

// Duplicate service keys locally to avoid runtime deps on optional packages.
const InputManagerRuntimeKey = new ServiceKey<InputManagerLike>("inputManager");
const PhysicsWorldManagerRuntimeKey = new ServiceKey<PhysicsWorldManagerLike>(
  "physicsWorldManager",
);
const RendererRuntimeKey = new ServiceKey<RendererLike>("renderer");

interface InputManagerLike {
  fireKeyDown(code: string): void;
  fireKeyUp(code: string): void;
  firePointerMove(x: number, y: number): void;
  firePointerDown(button?: 0 | 1 | 2): void;
  firePointerUp(button?: 0 | 1 | 2): void;
  fireGamepadButton(idx: number, pressed: boolean): void;
  fireGamepadAxis(idx: number, value: number): void;
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
}

/** Backward-compatible scene stack summary. */
export interface SceneSnapshot {
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
  disabledSystems: string[];
  disabledComponents: Array<{
    entity: string;
    component: string;
    error: string;
  }>;
}

export interface ComponentStateSnapshot {
  type: string;
  state: unknown | null;
}

export interface WorldEntitySnapshot {
  id: string;
  type: string;
  parent: string | null;
  transform: {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  components: ComponentStateSnapshot[];
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

export interface InputStateSnapshot {
  keys: string[];
  actions: string[];
  mouse: {
    x: number;
    y: number;
    buttons: number[];
    down: boolean;
  };
  gamepad: {
    buttons: number[];
    axes: Array<{ index: number; value: number }>;
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
  stepFrames(count: number): void;
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
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error("Inspector.time.setDelta(ms) requires a positive number.");
      }
      this.requireTimeController().setDelta(ms);
    },
    isFrozen: (): boolean => this.timeController?.isFrozen ?? false,
    getFrame: (): number =>
      this.timeController?.getFrame() ?? this.engine.loop.frameCount,
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
    gamepadButton: (idx: number, pressed: boolean): void => {
      this.requireInputManager().fireGamepadButton(idx, pressed);
    },
    gamepadAxis: (idx: number, value: number): void => {
      this.requireInputManager().fireGamepadAxis(idx, value);
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

  /** Snapshot one scene by inspector scene id. */
  snapshotScene(id: string): WorldSceneSnapshot {
    const scene = this.engine.scenes.all.find(
      (candidate) => this.getSceneId(candidate) === id,
    );
    if (!scene) {
      throw new Error(`Inspector.snapshotScene(): unknown scene id "${id}".`);
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
    if (typeof comp.serialize === "function") {
      const data = trySerialize(comp);
      if (data !== undefined) return data;
    }
    return this.serializeComponentOwnProperties(comp);
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

  /** Get disabled components/systems from error boundary. */
  getErrors(): ErrorSnapshot {
    const boundary = this.engine.context.tryResolve(ErrorBoundaryKey);
    if (!boundary) return { disabledSystems: [], disabledComponents: [] };
    const disabled = boundary.getDisabled();
    return {
      disabledSystems: disabled.systems.map(
        (s) => s.system.constructor.name,
      ),
      disabledComponents: disabled.components.map((c) => ({
        entity: c.component.entity?.name ?? "unknown",
        component: c.component.constructor.name,
        error: c.error,
      })),
    };
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
    const physicsManager = this.engine.context.tryResolve(
      PhysicsWorldManagerRuntimeKey,
    );
    return {
      id: this.getSceneId(scene),
      name: scene.name,
      paused: scene.isPaused,
      timeScale: scene.timeScale,
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
    const components = [...entity.getAll()]
      .map((component) => this.componentToSnapshot(component))
      .sort((a, b) => a.type.localeCompare(b.type));

    return {
      id: String(entity.id),
      type: entity.constructor.name,
      parent: entity.parent ? String(entity.parent.id) : null,
      transform: {
        x: worldPosition?.x ?? 0,
        y: worldPosition?.y ?? 0,
        rotation: transform?.worldRotation ?? 0,
        scaleX: worldScale?.x ?? 1,
        scaleY: worldScale?.y ?? 1,
      },
      components,
    };
  }

  private componentToSnapshot(component: Component): ComponentStateSnapshot {
    return {
      type: component.constructor.name,
      state:
        typeof component.serialize === "function"
          ? trySerialize(component) ?? null
          : null,
    };
  }

  private buildUISnapshot(scene: Scene): UITreeSnapshot | null {
    const roots = [...scene.getEntities()]
      .filter((entity) => !entity.isDestroyed)
      .flatMap((entity) =>
        [...entity.getAll()]
          .filter(
            (component) =>
              component.constructor.name === "UIPanel" &&
              "_node" in (component as object),
          )
          .map((component, index) =>
            this.buildUINodeSnapshot(
              (component as Component & { _node: UIElementLike })._node,
              `entity-${entity.id}:UIPanel:${index}`,
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
        if (entity.isDestroyed) continue;
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
      tags: [...entity.tags].sort((a, b) => a.localeCompare(b)),
      components: [...entity.getAll()]
        .map((component) => component.constructor.name)
        .sort((a, b) => a.localeCompare(b)),
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

  private serializeComponentOwnProperties(comp: Component): unknown {
    const result: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(comp)) {
      if (key === "entity") continue;
      // Skip private-by-convention fields. Components hold pixi/rapier handles
      // (e.g. _node, _body) on underscore-prefixed slots; exposing them in
      // snapshots would either crash JSON.stringify on cycles or leak
      // meaningless object identities.
      if (key.startsWith("_")) continue;
      const value = (comp as unknown as Record<string, unknown>)[key];
      if (!isSerializableValue(value)) continue;
      result[key] = value;
    }
    return result;
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
      ([left], [right]) => left.localeCompare(right),
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

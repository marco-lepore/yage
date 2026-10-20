import { prepareSnapshot } from "./core/snapshot.js";
import {
  Component,
  ErrorBoundaryKey,
  SceneTimeKey,
  Transform,
  defineEvent,
} from "@yagejs/core";
import type { Entity, EntityHandle, Vec2Like } from "@yagejs/core";
import { PerceptionMemory } from "./core/PerceptionMemory.js";
import { perceptionGeometry } from "./core/geometry.js";
import { finite, identifier, point, resolveConfig } from "./core/validation.js";
import type {
  PerceptionConfig,
  PerceptionObservation,
  PerceptionSample,
  PerceptionSnapshot,
  PerceptionTransition,
  ResolvedPerceptionConfig,
} from "./core/types.js";

export interface PerceptionContext {
  readonly observer: Entity;
  readonly target: Entity;
  readonly origin: Readonly<Vec2Like>;
  readonly position: Readonly<Vec2Like>;
  readonly distance: number;
  readonly angle: number;
}
export interface PerceptionSensorOptions extends PerceptionConfig {
  /** Default: active entities tagged "perceptible" in the observer's scene. */
  candidates?: (observer: Entity) => Iterable<Entity>;
  /** Stable save identity when needed. Default: runtime id and life generation. */
  identify?: (target: Entity) => string;
  /** World-pixel sample point. Default: target Transform.worldPosition. */
  position?: (target: Entity) => Vec2Like;
  /** null accepts; a nonempty string explains rejection. Default accepts all. */
  eligible?: (context: PerceptionContext) => string | null;
  /** True when unobstructed. Omit to sense through walls. */
  lineOfSight?: (context: PerceptionContext) => boolean;
  /** Visibility in [0, 1], e.g. camouflage or lighting. Default 1. */
  visibility?: (context: PerceptionContext) => number;
  /** Default true. False lets the host call sense() on its own schedule. */
  autoUpdate?: boolean;
  enabled?: boolean;
  /** A custom memory implementation can subclass the headless model. Its duration takes precedence. */
  memory?: PerceptionMemory<EntityHandle>;
}

export interface PerceptionEvaluation {
  readonly id: string;
  readonly entityId: number;
  readonly entityName: string;
  readonly distance: number;
  readonly angle: number;
  readonly visibility: number;
  readonly reason: string | null;
}
export interface PerceptionEvent {
  readonly sensor: PerceptionSensor;
  readonly observation: PerceptionObservation<EntityHandle>;
}
export const PerceptionDetectedEvent = defineEvent<PerceptionEvent>(
  "perception:detected",
);
export const PerceptionLostEvent =
  defineEvent<PerceptionEvent>("perception:lost");
export const PerceptionForgottenEvent = defineEvent<PerceptionEvent>(
  "perception:forgotten",
);

/** Per-observer sight and memory. Forward follows world rotation; no plugin is required. */
export class PerceptionSensor extends Component {
  static inspectExclude = [
    "memory",
    "options",
    "transform",
    "observations",
    "detected",
  ];
  readonly config: ResolvedPerceptionConfig;
  readonly memory: PerceptionMemory<EntityHandle>;
  readonly autoUpdate: boolean;
  private readonly options: Readonly<PerceptionSensorOptions>;
  private readonly transform = this.sibling(Transform);
  private _evaluations: readonly PerceptionEvaluation[] = [];
  private _sensing = false;
  private _restoring = false;

  constructor(options: PerceptionSensorOptions = {}) {
    super();
    const config = resolveConfig(options);
    this.memory = options.memory ?? new PerceptionMemory(config.memoryDuration);
    this.config = Object.freeze({
      ...config,
      memoryDuration: this.memory.memoryDuration,
    });
    this.options = Object.freeze({ ...options });
    this.autoUpdate = options.autoUpdate ?? true;
    this.enabled = options.enabled ?? true;
  }
  get observations(): readonly PerceptionObservation<EntityHandle>[] {
    return this.memory.observations;
  }
  /** Last sampled detections whose entity life is still active. */
  get detected(): readonly PerceptionObservation<EntityHandle>[] {
    return this.memory.detected.filter(
      (observation) => observation.target.current?.isActive,
    );
  }
  get evaluations(): readonly PerceptionEvaluation[] {
    return this._evaluations;
  }
  get sampledAt(): number {
    return this.memory.sampledAt;
  }
  /** Inspector-readable data derived from the same observations game code reads. */
  get diagnostics() {
    const now = this.entity?.tryScene ? this.now() : this.sampledAt;
    return this.observations.map((observation) => ({
      id: observation.id,
      entityId: observation.target.current?.id ?? null,
      visible: observation.visible,
      alive: observation.target.current !== undefined,
      active: observation.target.current?.isActive ?? false,
      reason: observation.reason,
      firstSeenAt: observation.firstSeenAt,
      lastSeenAt: observation.lastSeenAt,
      lostAt: observation.lostAt,
      age: now - observation.lastSeenAt,
      lastPosition: observation.lastPosition,
      visibility: observation.visibility,
    }));
  }
  onAdd(): void {
    if (!this.entity.has(Transform))
      throw new Error(
        `PerceptionSensor.onAdd: observer "${this.entity.name}" requires Transform`,
      );
  }
  update(dt: number): void {
    if (this.autoUpdate && dt > 0) this.sense();
  }
  onDisable(): void {
    this.clear("disabled");
  }

  /** Sample once, atomically install facts, then emit transitions. Does nothing while disabled. */
  sense(): void {
    if (!this.effectiveEnabled) return;
    if (this._sensing || this._restoring)
      throw new Error(
        "PerceptionSensor.sense: recursive sampling is not supported",
      );
    this._sensing = true;
    try {
      const now = this.now();
      const version = this.memory.version;
      const origin = point(
        this.transform.worldPosition,
        "PerceptionSensor.sense origin",
      );
      const rotation = this.transform.worldRotation;
      const candidates = this.invoke("candidates", () => [
        ...(this.options.candidates?.(this.entity) ??
          this.scene.findEntitiesByTag("perceptible")),
      ]);
      const samples: PerceptionSample<EntityHandle>[] = [];
      const evaluations: PerceptionEvaluation[] = [];
      const visited = new Set<Entity>();
      for (const target of candidates) {
        if (target === this.entity || visited.has(target)) continue;
        visited.add(target);
        if (!target.isActive || target.tryScene !== this.scene) continue;
        if (!target.has(Transform) && !this.options.position) continue;
        const handle = target.handle();
        const id = this.identify(target);
        const position = point(
          this.invoke(
            "position",
            () =>
              this.options.position?.(target) ??
              target.get(Transform).worldPosition,
          ),
          "PerceptionSensor.position",
        );
        const geometry = perceptionGeometry(origin, rotation, position);
        finite(geometry.distance, "PerceptionSensor.sense distance", 0);
        finite(geometry.angle, "PerceptionSensor.sense angle", 0, Math.PI);
        const context: PerceptionContext = Object.freeze({
          observer: this.entity,
          target,
          origin,
          position,
          ...geometry,
        });
        const old = this.memory.get(id);
        const sameLife = old?.target.current === target;
        let reason = this.invoke(
          "eligible",
          () => this.options.eligible?.(context) ?? null,
        );
        if (reason !== null)
          identifier(reason, "PerceptionSensor.eligible reason");
        const range =
          sameLife && old.visible ? this.config.loseRange : this.config.range;
        if (reason === null && geometry.distance > range)
          reason = "out-of-range";
        if (reason === null && geometry.angle > this.config.fieldOfView / 2)
          reason = "outside-field-of-view";
        if (
          reason === null &&
          !this.invoke(
            "lineOfSight",
            () => this.options.lineOfSight?.(context) ?? true,
          )
        )
          reason = "occluded";
        let visibility = 0;
        if (reason === null) {
          visibility = finite(
            this.invoke(
              "visibility",
              () => this.options.visibility?.(context) ?? 1,
            ),
            "PerceptionSensor.visibility",
            0,
            1,
          );
          if (visibility < this.config.visibilityThreshold)
            reason = "below-visibility-threshold";
        }
        // Policies may deactivate a host or target synchronously.
        if (!this.effectiveEnabled || version !== this.memory.version) return;
        if (handle.current !== target) continue;
        if (!target.isActive || target.tryScene !== this.scene) continue;
        samples.push({
          id,
          target: sameLife ? old.target : handle,
          position,
          visibility,
          reason,
        });
        evaluations.push(
          Object.freeze({
            id,
            entityId: target.id,
            entityName: target.name,
            ...geometry,
            visibility,
            reason,
          }),
        );
      }
      if (!this.effectiveEnabled || version !== this.memory.version) return;
      const live = samples.filter((sample) => {
        const target = sample.target.current;
        return target?.isActive && target.tryScene === this.scene;
      });
      const transitions = this.memory.update(now, live);
      this._evaluations = Object.freeze(evaluations);
      this.emit(transitions);
    } finally {
      // Only the recursion guard is released; failed callbacks stop the operation.
      this._sensing = false;
    }
  }

  clear(reason = "cleared"): void {
    const transitions = this.memory.clear(this.now(), reason);
    this._evaluations = [];
    this.emit(transitions);
  }
  snapshot(): PerceptionSnapshot {
    return this.memory.snapshot(this.now());
  }

  /** Restore data as remembered observations. Resolver must return current, same-scene entities with matching ids. */
  restore(
    snapshot: PerceptionSnapshot,
    resolve: (id: string) => Entity | undefined,
  ): void {
    if (!this.effectiveEnabled)
      throw new Error(
        "PerceptionSensor.restore: sensor must be enabled and attached",
      );
    if (this._restoring)
      throw new Error(
        "PerceptionSensor.restore: recursive restoration is not supported",
      );
    const prepared = prepareSnapshot(snapshot);
    const version = this.memory.version;
    const bindings: { id: string; target: EntityHandle }[] = [];
    this._restoring = true;
    try {
      for (const record of prepared.records) {
        const target = this.invoke("restore.resolve", () => resolve(record.id));
        if (!this.effectiveEnabled || this.memory.version !== version) return;
        if (!target || !target.isActive || target.tryScene !== this.scene)
          continue;
        const handle = target.handle();
        if (this.identify(target) !== record.id)
          throw new Error(
            `PerceptionSensor.restore: resolver identity does not match ${record.id}`,
          );
        if (!this.effectiveEnabled || this.memory.version !== version) return;
        bindings.push({ id: record.id, target: handle });
      }
      const live = bindings.filter((binding) => {
        const target = binding.target.current;
        return target?.isActive && target.tryScene === this.scene;
      });
      this.memory.restore(prepared, this.now(), live);
      this._evaluations = [];
    } finally {
      this._restoring = false;
    }
  }

  private identify(target: Entity): string {
    const id = this.invoke(
      "identify",
      () =>
        this.options.identify?.(target) ?? `${target.id}:${target.generation}`,
    );
    identifier(id, "PerceptionSensor.identify");
    return id;
  }
  private now(): number {
    return this.use(SceneTimeKey).elapsed;
  }
  private invoke<T>(name: string, callback: () => T): T {
    const boundary = this.context.tryResolve(ErrorBoundaryKey);
    if (!boundary) return callback();
    let value!: T;
    boundary.wrapCallback(
      () => {
        value = callback();
      },
      {
        kind: `PerceptionSensor.${name}`,
        entity: this.entity.name,
        scene: this.scene.name,
      },
    );
    return value;
  }
  private emit(
    transitions: readonly PerceptionTransition<EntityHandle>[],
  ): void {
    const version = this.memory.version;
    for (const transition of transitions) {
      if (version !== this.memory.version) return;
      const token =
        transition.type === "detected"
          ? PerceptionDetectedEvent
          : transition.type === "lost"
            ? PerceptionLostEvent
            : PerceptionForgottenEvent;
      this.entity.emit(token, {
        sensor: this,
        observation: transition.observation,
      });
    }
  }
}

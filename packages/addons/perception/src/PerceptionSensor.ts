import {
  Component,
  ErrorBoundaryKey,
  SceneTimeKey,
  Transform,
} from "@yagejs/core";
import type { Entity, EntityHandle, Vec2Like } from "@yagejs/core";
import { PerceptionMemory } from "./core/PerceptionMemory.js";
import { perceptionGeometry } from "./core/geometry.js";
import { prepareSnapshot } from "./core/snapshot.js";
import { finite, nonempty, point, resolveConfig } from "./core/validation.js";
import type {
  PerceptionConfig,
  PerceptionObservation,
  PerceptionSample,
  PerceptionSnapshot,
  PerceptionTransition,
  ResolvedPerceptionConfig,
} from "./core/types.js";
import {
  PerceptionDetectedEvent,
  PerceptionForgottenEvent,
  PerceptionLostEvent,
} from "./events.js";

/** Tag the default candidate query looks for on targets. */
export const PERCEPTIBLE_TAG = "perceptible";

/** What `eligible`, `lineOfSight` and `visibility` receive for one observer-target pair. */
export interface PerceptionContext {
  readonly observer: Entity;
  readonly target: Entity;
  /** Observer world position. */
  readonly origin: Readonly<Vec2Like>;
  /** Sampled target world position. */
  readonly position: Readonly<Vec2Like>;
  readonly distance: number;
  /** Absolute angle between the facing direction and the target, 0 to π. */
  readonly angle: number;
}

export interface PerceptionSensorOptions extends PerceptionConfig {
  /** Targets to evaluate. Default: active scene entities tagged `PERCEPTIBLE_TAG`. */
  candidates?: (observer: Entity) => Iterable<Entity>;
  /** World-pixel sample point. Default: the target's Transform world position. */
  position?: (target: Entity) => Vec2Like;
  /** World angle in radians the observer looks along. Default: its Transform world rotation. */
  facing?: (observer: Entity) => number;
  /** null accepts; a nonempty string rejects with that reason. Default accepts all. */
  eligible?: (context: PerceptionContext) => string | null;
  /** True when the path is clear. Omit to sense through walls. */
  lineOfSight?: (context: PerceptionContext) => boolean;
  /** Visibility in [0, 1], e.g. camouflage or lighting. Default 1. */
  visibility?: (context: PerceptionContext) => number;
  /** Default true. False leaves sampling to explicit `sense()` calls. */
  autoUpdate?: boolean;
  enabled?: boolean;
  /** Model to host instead of a new one. Set its duration through its constructor, not `memoryDuration`. */
  memory?: PerceptionMemory<EntityHandle>;
}

/** One candidate from the latest sample, including rejected ones. */
export interface PerceptionEvaluation {
  readonly id: string;
  readonly entityId: number;
  readonly entityName: string;
  readonly distance: number;
  readonly angle: number;
  /** 0 when an earlier check rejected the target before the visibility check ran. */
  readonly visibility: number;
  readonly reason: string | null;
}

const EVENTS = {
  detected: PerceptionDetectedEvent,
  lost: PerceptionLostEvent,
  forgotten: PerceptionForgottenEvent,
} as const;

/** Memory id for one life of an entity; a pooled entity's next life gets a new id. */
function lifeId(entity: Entity): string {
  return `${entity.id}:${entity.generation}`;
}

/** Per-observer sight and last-seen memory. No plugin is required. */
export class PerceptionSensor extends Component {
  static inspectExclude = ["memory", "options", "observations", "detected"];
  readonly config: ResolvedPerceptionConfig;
  readonly memory: PerceptionMemory<EntityHandle>;
  readonly autoUpdate: boolean;
  private readonly options: Readonly<PerceptionSensorOptions>;
  private readonly transform = this.sibling(Transform);
  private readonly boundary = this.service(ErrorBoundaryKey);
  private _evaluations: readonly PerceptionEvaluation[] = [];
  private _sampling = false;
  /** Delivery queue of the batch in progress, including transitions listeners add; null between batches. */
  private _queued: PerceptionTransition<EntityHandle>[] | null = null;

  constructor(options: PerceptionSensorOptions = {}) {
    super();
    if (options.memory && options.memoryDuration !== undefined)
      throw new Error(
        "PerceptionSensor: pass memoryDuration to the PerceptionMemory constructor when supplying memory",
      );
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

  /** Every retained observation, visible or remembered. */
  get observations(): readonly PerceptionObservation<EntityHandle>[] {
    return this.memory.observations;
  }
  /** Visible observations from the latest sample whose target is still active. */
  get detected(): readonly PerceptionObservation<EntityHandle>[] {
    return this.memory.detected.filter(
      (observation) => observation.target.current?.isActive,
    );
  }
  /** Every candidate from the latest sample, with its rejection reason. */
  get evaluations(): readonly PerceptionEvaluation[] {
    return this._evaluations;
  }
  /** Scene time of the latest sample, clear, or restore. */
  get sampledAt(): number {
    return this.memory.sampledAt;
  }
  /** Inspector-readable copy of `observations`, with ages and target liveness. */
  get diagnostics() {
    const now = this.now();
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

  /** The observation of `target`'s current life, visible or remembered. */
  observationOf(
    target: Entity,
  ): PerceptionObservation<EntityHandle> | undefined {
    return this.memory.get(lifeId(target));
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

  /** Sample every candidate, install the results, then emit transitions. Does nothing while disabled. */
  sense(): void {
    if (!this.effectiveEnabled) return;
    if (this._sampling)
      throw new Error(
        "PerceptionSensor.sense: called from a sensor callback; callbacks must only read state",
      );
    const now = this.now();
    const version = this.memory.version;
    let results: readonly {
      sample: PerceptionSample<EntityHandle>;
      evaluation: PerceptionEvaluation;
    }[];
    this._sampling = true;
    try {
      results = this.evaluateCandidates();
    } finally {
      // Releases only the recursion guard; a throwing callback still ends the sample.
      this._sampling = false;
    }
    if (this.memory.version !== version)
      throw new Error(
        "PerceptionSensor.sense: memory changed while sensor callbacks ran; callbacks must only read state",
      );
    const transitions = this.memory.update(
      now,
      results.map((result) => result.sample),
    );
    this._evaluations = Object.freeze(
      results.map((result) => result.evaluation),
    );
    this.emit(transitions);
  }

  /** Drop every observation, emitting loss and forgetting with `reason`. */
  clear(reason = "cleared"): void {
    const transitions = this.memory.clear(this.now(), reason);
    this._evaluations = [];
    this.emit(transitions);
  }

  /** Data-only memory of targets spawned with a key, recorded under that key. */
  snapshot(): PerceptionSnapshot {
    const saved = this.memory.snapshot(this.now());
    return {
      version: 1,
      records: saved.records.flatMap((record) => {
        const key = this.memory.get(record.id)?.target.current?.key;
        return key === undefined ? [] : [{ ...record, id: key }];
      }),
    };
  }

  /**
   * Replace memory with saved observations, finding each target by entity key
   * in this scene. Restored observations are remembered, not visible; missing
   * or inactive targets are omitted. Emits no events.
   */
  restore(snapshot: PerceptionSnapshot): void {
    if (!this.effectiveEnabled)
      throw new Error(
        "PerceptionSensor.restore: sensor must be enabled and attached",
      );
    const prepared = prepareSnapshot(snapshot);
    const targets = new Map<string, EntityHandle>();
    const records: PerceptionSnapshot["records"][number][] = [];
    for (const record of prepared.records) {
      const target = this.scene.findByKey(record.id);
      if (!target?.isActive || target === this.entity) continue;
      const id = lifeId(target);
      targets.set(id, target.handle());
      records.push({ ...record, id });
    }
    this.memory.restore({ version: 1, records }, this.now(), (id) =>
      targets.get(id),
    );
    this._evaluations = [];
  }

  private evaluateCandidates(): {
    sample: PerceptionSample<EntityHandle>;
    evaluation: PerceptionEvaluation;
  }[] {
    const origin = this.transform.worldPosition;
    const facing = this.facing();
    const visited = new Set<Entity>();
    const results = [];
    for (const target of this.candidates()) {
      if (target === this.entity || visited.has(target)) continue;
      visited.add(target);
      if (!target.isActive || target.tryScene !== this.scene) continue;
      results.push(this.evaluate(target, origin, facing));
    }
    return results;
  }

  private evaluate(
    target: Entity,
    origin: Readonly<Vec2Like>,
    facing: number,
  ): {
    sample: PerceptionSample<EntityHandle>;
    evaluation: PerceptionEvaluation;
  } {
    const id = lifeId(target);
    const position = this.targetPosition(target);
    const geometry = perceptionGeometry(origin, facing, position);
    const context: PerceptionContext = Object.freeze({
      observer: this.entity,
      target,
      origin,
      position,
      ...geometry,
    });
    const previous = this.memory.get(id);
    const { reason, visibility } = this.check(
      context,
      previous?.visible ?? false,
    );
    return {
      sample: {
        id,
        target: previous?.target ?? target.handle(),
        position,
        visibility,
        reason,
      },
      evaluation: Object.freeze({
        id,
        entityId: target.id,
        entityName: target.name,
        ...geometry,
        visibility,
        reason,
      }),
    };
  }

  /** Eligibility, range, field of view, line of sight, then visibility; the first failure wins. */
  private check(
    context: PerceptionContext,
    visible: boolean,
  ): { reason: string | null; visibility: number } {
    const { eligible, lineOfSight, visibility } = this.options;
    if (eligible) {
      const reason = this.call("eligible", () => eligible(context));
      if (reason !== null)
        return {
          reason: nonempty(reason, "PerceptionSensor.eligible"),
          visibility: 0,
        };
    }
    const range = visible ? this.config.loseRange : this.config.range;
    if (context.distance > range)
      return { reason: "out-of-range", visibility: 0 };
    if (context.angle > this.config.fieldOfView / 2)
      return { reason: "outside-field-of-view", visibility: 0 };
    if (lineOfSight && !this.call("lineOfSight", () => lineOfSight(context)))
      return { reason: "occluded", visibility: 0 };
    const score = visibility
      ? finite(
          this.call("visibility", () => visibility(context)),
          "PerceptionSensor.visibility",
          0,
          1,
        )
      : 1;
    return {
      reason:
        score < this.config.visibilityThreshold
          ? "below-visibility-threshold"
          : null,
      visibility: score,
    };
  }

  private candidates(): readonly Entity[] {
    const candidates = this.options.candidates;
    if (!candidates) return this.scene.findEntitiesByTag(PERCEPTIBLE_TAG);
    return this.call("candidates", () => [...candidates(this.entity)]);
  }

  private facing(): number {
    const facing = this.options.facing;
    if (!facing) return this.transform.worldRotation;
    return finite(
      this.call("facing", () => facing(this.entity)),
      "PerceptionSensor.facing",
    );
  }

  private targetPosition(target: Entity): Readonly<Vec2Like> {
    const position = this.options.position;
    if (position)
      return point(
        this.call("position", () => position(target)),
        "PerceptionSensor.position",
      );
    const transform = target.tryGet(Transform);
    if (!transform)
      throw new Error(
        `PerceptionSensor.sense: target "${target.name}" has no Transform; add one or pass a position option`,
      );
    return transform.worldPosition;
  }

  private now(): number {
    return this.use(SceneTimeKey).elapsed;
  }

  /** Run one option callback under the ErrorBoundary so a throw names the option. */
  private call<T>(option: string, callback: () => T): T {
    let result!: T;
    this.boundary.wrapCallback(
      () => {
        result = callback();
      },
      {
        kind: `PerceptionSensor.${option}`,
        entity: this.entity.name,
        scene: this.scene.name,
      },
    );
    return result;
  }

  /**
   * Deliver transitions in order. Transitions from a listener that clears,
   * samples, or disables the sensor wait behind the batch being delivered.
   */
  private emit(
    transitions: readonly PerceptionTransition<EntityHandle>[],
  ): void {
    if (this._queued) {
      this._queued.push(...transitions);
      return;
    }
    const queue = [...transitions];
    this._queued = queue;
    try {
      // for-of also visits transitions pushed during delivery.
      for (const { type, observation } of queue) {
        this.entity.emit(EVENTS[type], { sensor: this, observation });
      }
    } finally {
      // Releases only the queue; a throwing listener still ends delivery.
      this._queued = null;
    }
  }
}

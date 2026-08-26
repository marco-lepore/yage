import type { Entity } from "./Entity.js";
import type { Scene } from "./Scene.js";
import { ServiceKey } from "./EngineContext.js";

/**
 * Handle returned by a {@link SceneTime} scale or freeze request. Each call
 * owns exactly one request entry; the handle releases that entry and nothing
 * else.
 */
export interface TimeEffectHandle {
  /**
   * True while the request holds an entry — including while a newer request
   * in the same channel masks it. Turns false on `release()` or, for timed
   * requests, when the duration expires.
   */
  readonly active: boolean;
  /**
   * Remove the request. Idempotent. Releasing a masked (non-winning) entry
   * removes it silently without changing the effective scale.
   */
  release(): void;
}

/** Options for {@link SceneTime.scaleBy}. */
export interface SceneTimeScaleOptions {
  /**
   * Real-time duration in seconds after which the request auto-releases.
   * Aged on raw frame time — unaffected by any time scaling — but only while
   * the owning scene is active (a stack-paused scene holds its effects).
   * `0` returns an already-inactive handle without adding a request.
   * Omit for a request that lasts until `release()`.
   */
  for?: number;
  /**
   * Channel name. Within a channel the latest active request wins (with
   * show-through: when it ends, the previous still-active request applies
   * again); across channels the winning factors multiply. Omit for an
   * anonymous channel private to this call.
   */
  key?: string;
  /**
   * Entities this request does not apply to. For an excluded entity the
   * request's channel contributes factor 1 to
   * {@link SceneTime.effectiveScaleForUpdates} — the channel's masked older
   * entries do not step in. Exclusion covers component updates, the entity's
   * `ProcessComponent`, and its particle emitters. Physics is NOT excluded:
   * the entity's rigid body still integrates at world speed, and
   * physics-writing components under exclusion push forces at the excluded
   * rate into a slowed world.
   */
  excludeUpdates?: readonly Entity[];
  /** Display-only name for debugging. Defaults to `key`. */
  label?: string;
}

/** Options for {@link SceneTime.freezeFor}. */
export interface SceneTimeFreezeOptions {
  /** Channel name — same semantics as {@link SceneTimeScaleOptions.key}. */
  key?: string;
  /**
   * Entities whose updates continue while this request freezes the scene.
   * Physics remains frozen because the scene has one shared physics world.
   * The exclusion covers the same consumers as
   * {@link SceneTimeScaleOptions.excludeUpdates}.
   */
  excludeUpdates?: readonly Entity[];
  /** Display-only name for debugging. Defaults to `key`. */
  label?: string;
}

/** Options for one entity-scoped time request. */
export interface EntityTimeScaleOptions {
  /**
   * Real-time duration in seconds after which the request auto-releases.
   * Omit for a request that lasts until {@link TimeEffectHandle.release}.
   */
  for?: number;
  /** Channel name with the same latest-request-wins behavior as scene requests. */
  key?: string;
  /** Display-only name for debugging. Defaults to `key`. */
  label?: string;
}

/** One scale request. Owned by exactly one handle. */
interface TimeRequest {
  factor: number;
  /** Real-time seconds left, or `null` for until-released requests. */
  remaining: number | null;
  exclude: Set<Entity> | null;
  label: string;
  released: boolean;
}

const INACTIVE_HANDLE: TimeEffectHandle = Object.freeze({
  active: false,
  release(): void {},
});

/**
 * Scene-wide and entity-scoped time-effect arbitration: hitstop, slow motion,
 * freeze frames, and speed-ups that would corrupt each other if every caller
 * wrote base time-scale properties directly.
 *
 * Resolved via the scene-scoped {@link SceneTimeKey}; the engine registers one
 * instance per scene.
 *
 * ```ts
 * const time = this.use(SceneTimeKey);
 * time.freezeFor(0.08);                            // hitstop
 * const slow = time.scaleBy(0.25, { key: "slowmo" }); // bullet time
 * slow.release();
 * ```
 *
 * Composition: each `key` is a channel. Within a channel the latest active
 * request wins (a newer request masks an older still-active one and reveals
 * it again on expiry); across channels the winning factors multiply. A freeze
 * is a ×0 factor, so it dominates arithmetically. `scene.timeScale` stays the
 * game's persistent speed knob — this service reads it as an input and never
 * writes it:
 * `effectiveScale = scene.timeScale × Π(scene channel winners)`. Entity
 * requests multiply into {@link SceneTime.effectiveScaleForUpdates} after the
 * scene result and never affect physics.
 *
 * Request timers age on raw frame time, before any systems run, and only
 * while the scene is active — a stack-paused scene holds its effects (note:
 * that means pause-menu time does not consume a hitstop). Effects are
 * transient: they release on scene exit and are not saved; games re-issue
 * them after loading a snapshot.
 */
export class SceneTime {
  private readonly scene: Scene;
  private readonly channels = new Map<string | symbol, TimeRequest[]>();
  private readonly entityChannels = new Map<
    Entity,
    Map<string | symbol, TimeRequest[]>
  >();
  private elapsedSeconds = 0;
  private fixedElapsedSeconds = 0;
  /** Cached product of channel winners (excludes `scene.timeScale`). */
  private channelProduct = 1;
  /**
   * Per-entity winner products for entities excluded by at least one channel
   * winner (excludes `scene.timeScale`). `null` while nothing is excluded —
   * the unexcluded fast path.
   */
  private exclusionProducts: Map<Entity, number> | null = null;
  /** Cached products of entity-scoped channel winners. */
  private entityProducts: Map<Entity, number> | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * The scale every non-excluded consumer runs at:
   * `scene.timeScale × Π(channel winners)`. Physics always steps under this
   * full value (exclusions never apply to the shared world).
   */
  get effectiveScale(): number {
    return this.scene.timeScale * this.channelProduct;
  }

  /**
   * Simulation seconds elapsed in this scene: raw frame time scaled by
   * {@link SceneTime.effectiveScale}, accrued once per rendered frame and only
   * while the scene is active. A stack-paused scene, a `timeScale` of 0, and an
   * active freeze all hold it. Starts at 0 each time the scene is entered and
   * is not saved. {@link SceneTime.fixedElapsed} is the fixed-timestep reading.
   */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /**
   * Simulation seconds elapsed in this scene on the fixed timestep: one
   * `fixedTimestep ×` {@link SceneTime.effectiveScale} increment per fixed step
   * the loop runs, accrued only while the scene is active.
   *
   * Stamp a gameplay time from fixed-step code against this reading and compare
   * it there. {@link SceneTime.elapsed} moves with the rendered frame, so the
   * same window spans a different number of simulation steps run to run.
   *
   * Holds under the same conditions as {@link SceneTime.elapsed}: stack pause,
   * a `timeScale` of 0, and an active freeze. Starts at 0 each time the scene
   * is entered and is not saved.
   *
   * This reading and `elapsed` advance on different cadences, so at any moment
   * they can differ by one or more fixed steps in either direction. The loop's
   * fixed-step accumulator is engine-wide: a scene entered mid-run starts
   * counting against the time already in it. A frame that hits
   * `maxFixedStepsPerFrame` leaves its unrun steps for the following frames.
   * Time waiting in the accumulator is converted at the scale in force when its
   * step runs, not at the scale of the frame it arrived in. Stamp and compare
   * against the same reading — subtracting one from the other does not give a
   * meaningful lag.
   *
   * The increment uses the whole-scene {@link SceneTime.effectiveScale}, so it
   * does not follow `entity.timeScale` or an `excludeUpdates` exclusion. An
   * entity running at its own rate should time itself against its
   * `ProcessComponent`, which composes both.
   */
  get fixedElapsed(): number {
    return this.fixedElapsedSeconds;
  }

  /** True while {@link SceneTime.effectiveScale} is 0. */
  get isFrozen(): boolean {
    return this.effectiveScale === 0;
  }

  /** Display labels of all active scene and entity requests. */
  get activeLabels(): readonly string[] {
    const labels: string[] = [];
    for (const entries of this.channels.values()) {
      for (const entry of entries) labels.push(entry.label);
    }
    for (const channels of this.entityChannels.values()) {
      for (const entries of channels.values()) {
        for (const entry of entries) labels.push(entry.label);
      }
    }
    return labels;
  }

  /**
   * The scale `entity`'s component updates, `ProcessComponent`, and particle
   * emitters run at: like {@link SceneTime.effectiveScale}, but a scene channel
   * whose winner excludes the entity contributes 1, and entity-scoped channel
   * winners multiply on top. `entity.timeScale` is not included — the update
   * pipeline composes it last.
   */
  effectiveScaleForUpdates(entity: Entity): number {
    const adjusted = this.exclusionProducts?.get(entity);
    const entityProduct = this.entityProducts?.get(entity) ?? 1;
    return (
      this.scene.timeScale * (adjusted ?? this.channelProduct) * entityProduct
    );
  }

  /**
   * Add a scale request. `factor` must be finite and > 0 (freezing goes
   * through {@link SceneTime.freezeFor}); factors above 1 speed the scene up
   * — physics catch-up is capped at ~8 sub-steps per frame.
   */
  scaleBy(factor: number, options?: SceneTimeScaleOptions): TimeEffectHandle {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `SceneTime.scaleBy: factor must be finite and > 0, got ${factor}. ` +
          `Use freezeFor() to freeze the scene.`,
      );
    }
    const duration = options?.for ?? null;
    if (duration !== null && (!Number.isFinite(duration) || duration < 0)) {
      throw new Error(
        `SceneTime.scaleBy: "for" must be a finite duration >= 0 in seconds, got ${duration}.`,
      );
    }
    const exclude = options?.excludeUpdates?.length
      ? new Set(options.excludeUpdates)
      : null;
    return this.addRequest(this.channels, factor, duration, exclude, options);
  }

  /**
   * Freeze the scene (a ×0 factor) for `duration` real-time seconds. Returns
   * the same handle shape as `scaleBy` for an early release. Freezes are
   * scene-wide for physics. `excludeUpdates` can keep selected entities'
   * components, processes, and particle emitters running during the freeze.
   */
  freezeFor(
    duration: number,
    options?: SceneTimeFreezeOptions,
  ): TimeEffectHandle {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(
        `SceneTime.freezeFor: duration must be a finite number >= 0 in seconds, got ${duration}.`,
      );
    }
    const exclude = options?.excludeUpdates?.length
      ? new Set(options.excludeUpdates)
      : null;
    return this.addRequest(this.channels, 0, duration, exclude, options);
  }

  /**
   * Scale one entity's component updates, `ProcessComponent`, and particle
   * emitters without changing the scene or the entity's rigid body. The
   * request composes with scene requests and the entity's base `timeScale`.
   */
  scaleEntityBy(
    entity: Entity,
    factor: number,
    options?: EntityTimeScaleOptions,
  ): TimeEffectHandle {
    this.assertEntity(entity, "scaleEntityBy");
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        `SceneTime.scaleEntityBy: factor must be finite and > 0, got ${factor}. ` +
          `Use freezeEntityFor() to freeze an entity's updates.`,
      );
    }
    const duration = options?.for ?? null;
    this.assertDuration(duration, "SceneTime.scaleEntityBy", '"for"');
    if (duration === 0) return INACTIVE_HANDLE;
    const channels = this.getEntityChannels(entity);
    return this.addRequest(channels, factor, duration, null, options);
  }

  /**
   * Freeze one entity's component updates, `ProcessComponent`, and particle
   * emitters for a real-time duration. The entity's rigid body keeps
   * simulating with the scene's shared physics world.
   */
  freezeEntityFor(
    entity: Entity,
    duration: number,
    options?: Omit<EntityTimeScaleOptions, "for">,
  ): TimeEffectHandle {
    this.assertEntity(entity, "freezeEntityFor");
    this.assertDuration(duration, "SceneTime.freezeEntityFor", "duration");
    if (duration === 0) return INACTIVE_HANDLE;
    const channels = this.getEntityChannels(entity);
    return this.addRequest(channels, 0, duration, null, options);
  }

  private addRequest(
    channels: Map<string | symbol, TimeRequest[]>,
    factor: number,
    duration: number | null,
    exclude: Set<Entity> | null,
    options?: { key?: string; label?: string },
  ): TimeEffectHandle {
    if (duration === 0) return INACTIVE_HANDLE;
    const entry: TimeRequest = {
      factor,
      remaining: duration,
      exclude,
      label: options?.label ?? options?.key ?? "anonymous",
      released: false,
    };
    const channelKey: string | symbol =
      options?.key ?? Symbol("sceneTime.anonymous");
    let entries = channels.get(channelKey);
    if (!entries) {
      entries = [];
      channels.set(channelKey, entries);
    }
    entries.push(entry);
    this.recompute();
    return {
      get active(): boolean {
        return !entry.released;
      },
      release: () => this.removeRequest(channels, channelKey, entry),
    };
  }

  private removeRequest(
    channels: Map<string | symbol, TimeRequest[]>,
    channelKey: string | symbol,
    entry: TimeRequest,
  ): void {
    if (entry.released) return;
    entry.released = true;
    const entries = channels.get(channelKey);
    if (entries) {
      const idx = entries.indexOf(entry);
      if (idx !== -1) entries.splice(idx, 1);
      if (entries.length === 0) channels.delete(channelKey);
    }
    this.removeEmptyEntityChannels(channels);
    this.recompute();
  }

  /**
   * Age request timers by raw frame time. Called by the engine at the start
   * of `earlyUpdate` for each active scene, so a request created later in the
   * frame is not aged until the next frame. Masked entries keep aging. Also
   * prunes destroyed entities from exclusion sets.
   * @internal
   */
  _tick(dt: number): void {
    let dirty = this.tickChannels(this.channels, dt, true);
    for (const [entity, channels] of [...this.entityChannels]) {
      if (entity.isDestroyed) {
        this.releaseChannels(channels);
        this.entityChannels.delete(entity);
        dirty = true;
        continue;
      }
      if (this.tickChannels(channels, dt, false)) dirty = true;
      if (channels.size === 0) this.entityChannels.delete(entity);
    }
    if (dirty) this.recompute();

    // Physics reads the post-aging scale later this frame, so elapsed uses it too.
    this.elapsedSeconds += dt * this.effectiveScale;
  }

  /**
   * Accrue one fixed step of simulation time. Called by the engine once per
   * fixed step for each active scene. Request timers age once per frame in
   * `_tick`, never here.
   * @internal
   */
  _tickFixed(fixedDt: number): void {
    this.fixedElapsedSeconds += fixedDt * this.effectiveScale;
  }

  /**
   * Release every request. Called by the engine on scene exit.
   * @internal
   */
  _releaseAll(): void {
    this.releaseChannels(this.channels);
    for (const channels of this.entityChannels.values()) {
      this.releaseChannels(channels);
    }
    this.channels.clear();
    this.entityChannels.clear();
    this.recompute();
  }

  private recompute(): void {
    let product = 1;
    const winners: TimeRequest[] = [];
    for (const entries of this.channels.values()) {
      const winner = entries[entries.length - 1];
      if (!winner) continue;
      winners.push(winner);
      product *= winner.factor;
    }
    this.channelProduct = product;

    let excluded: Set<Entity> | null = null;
    for (const winner of winners) {
      if (!winner.exclude) continue;
      for (const entity of winner.exclude) {
        if (entity.isDestroyed) continue;
        excluded ??= new Set();
        excluded.add(entity);
      }
    }
    if (!excluded) {
      this.exclusionProducts = null;
    } else {
      const products = new Map<Entity, number>();
      for (const entity of excluded) {
        let entityProduct = 1;
        for (const winner of winners) {
          if (!winner.exclude?.has(entity)) entityProduct *= winner.factor;
        }
        products.set(entity, entityProduct);
      }
      this.exclusionProducts = products;
    }

    const entityProducts = new Map<Entity, number>();
    for (const [entity, channels] of this.entityChannels) {
      if (entity.isDestroyed) continue;
      let entityProduct = 1;
      for (const entries of channels.values()) {
        const winner = entries[entries.length - 1];
        if (winner) entityProduct *= winner.factor;
      }
      entityProducts.set(entity, entityProduct);
    }
    this.entityProducts = entityProducts.size > 0 ? entityProducts : null;
  }

  private getEntityChannels(
    entity: Entity,
  ): Map<string | symbol, TimeRequest[]> {
    let channels = this.entityChannels.get(entity);
    if (!channels) {
      channels = new Map();
      this.entityChannels.set(entity, channels);
    }
    return channels;
  }

  private assertEntity(entity: Entity, method: string): void {
    if (entity.isDestroyed || entity.tryScene !== this.scene) {
      throw new Error(
        `SceneTime.${method}: entity must belong to the owning scene.`,
      );
    }
  }

  private removeEmptyEntityChannels(
    channels: Map<string | symbol, TimeRequest[]>,
  ): void {
    if (channels.size > 0 || channels === this.channels) return;
    for (const [entity, entityChannels] of this.entityChannels) {
      if (entityChannels === channels) {
        this.entityChannels.delete(entity);
        return;
      }
    }
  }

  private assertDuration(
    duration: number | null,
    method: string,
    label: string,
  ): void {
    if (duration !== null && (!Number.isFinite(duration) || duration < 0)) {
      throw new Error(
        `${method}: ${label} must be a finite duration >= 0 in seconds, got ${duration}.`,
      );
    }
  }

  private tickChannels(
    channels: Map<string | symbol, TimeRequest[]>,
    dt: number,
    pruneExclusions: boolean,
  ): boolean {
    let dirty = false;
    for (const [channelKey, entries] of [...channels]) {
      for (const entry of [...entries]) {
        if (pruneExclusions && entry.exclude) {
          for (const excluded of entry.exclude) {
            if (excluded.isDestroyed) {
              entry.exclude.delete(excluded);
              dirty = true;
            }
          }
        }
        if (entry.remaining !== null) {
          entry.remaining -= dt;
          if (entry.remaining <= 0) {
            entry.released = true;
            const index = entries.indexOf(entry);
            if (index !== -1) entries.splice(index, 1);
            dirty = true;
          }
        }
      }
      if (entries.length === 0) channels.delete(channelKey);
    }
    return dirty;
  }

  private releaseChannels(channels: Map<string | symbol, TimeRequest[]>): void {
    for (const entries of channels.values()) {
      for (const entry of entries) entry.released = true;
    }
  }
}

/**
 * Scene-scoped key for the per-scene {@link SceneTime} service. Registered by
 * the engine for every scene; resolve via `Component.use(SceneTimeKey)` /
 * `Scene.use(SceneTimeKey)`, or `scene.tryResolveScoped(SceneTimeKey)` from
 * systems.
 */
export const SceneTimeKey = new ServiceKey<SceneTime>("sceneTime", {
  scope: "scene",
});

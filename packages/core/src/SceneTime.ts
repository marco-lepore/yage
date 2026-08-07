import type { Entity } from "./Entity.js";
import type { Scene } from "./Scene.js";
import { ServiceKey } from "./EngineContext.js";

/**
 * Handle returned by {@link SceneTime.scaleBy} and {@link SceneTime.freezeFor}.
 * Each call owns exactly one request entry; the handle releases that entry and
 * nothing else.
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
 * Per-scene time-effect arbitration: hitstop, slow motion / bullet time,
 * freeze frames, and speed-ups that would corrupt each other if every caller
 * wrote `scene.timeScale` directly (the "restore to what?" bug).
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
 * `effectiveScale = scene.timeScale × Π(channel winners)`.
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
  private elapsedSeconds = 0;
  /** Cached product of channel winners (excludes `scene.timeScale`). */
  private channelProduct = 1;
  /**
   * Per-entity winner products for entities excluded by at least one channel
   * winner (excludes `scene.timeScale`). `null` while nothing is excluded —
   * the unexcluded fast path.
   */
  private exclusionProducts: Map<Entity, number> | null = null;

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
   * {@link SceneTime.effectiveScale}, accrued only while the scene is active. A
   * stack-paused scene, a `timeScale` of 0, and an active freeze all hold it.
   * Starts at 0 each time the scene is entered and is not saved.
   */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /** True while {@link SceneTime.effectiveScale} is 0. */
  get isFrozen(): boolean {
    return this.effectiveScale === 0;
  }

  /** Display labels of all active requests, in creation order per channel. */
  get activeLabels(): readonly string[] {
    const labels: string[] = [];
    for (const entries of this.channels.values()) {
      for (const entry of entries) labels.push(entry.label);
    }
    return labels;
  }

  /**
   * The scale `entity`'s component updates, `ProcessComponent`, and particle
   * emitters run at: like {@link SceneTime.effectiveScale}, but a channel
   * whose winner excludes the entity contributes 1. `entity.timeScale` is not
   * included — the update pipeline composes it on top.
   */
  effectiveScaleForUpdates(entity: Entity): number {
    const adjusted = this.exclusionProducts?.get(entity);
    return this.scene.timeScale * (adjusted ?? this.channelProduct);
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
    return this.addRequest(factor, duration, exclude, options);
  }

  /**
   * Freeze the scene (a ×0 factor) for `duration` real-time seconds. Returns
   * the same handle shape as `scaleBy` for an early release. Freezes are
   * whole-scene by design — a shared physics world has no per-entity time, so
   * freeze requests take no `excludeUpdates`.
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
    return this.addRequest(0, duration, null, options);
  }

  private addRequest(
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
    let entries = this.channels.get(channelKey);
    if (!entries) {
      entries = [];
      this.channels.set(channelKey, entries);
    }
    entries.push(entry);
    this.recompute();
    return {
      get active(): boolean {
        return !entry.released;
      },
      release: () => this.removeRequest(channelKey, entry),
    };
  }

  private removeRequest(
    channelKey: string | symbol,
    entry: TimeRequest,
  ): void {
    if (entry.released) return;
    entry.released = true;
    const entries = this.channels.get(channelKey);
    if (entries) {
      const idx = entries.indexOf(entry);
      if (idx !== -1) entries.splice(idx, 1);
      if (entries.length === 0) this.channels.delete(channelKey);
    }
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
    if (this.channels.size > 0) {
      let dirty = false;
      for (const [channelKey, entries] of [...this.channels]) {
        for (const entry of [...entries]) {
          if (entry.exclude) {
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
              const idx = entries.indexOf(entry);
              if (idx !== -1) entries.splice(idx, 1);
              dirty = true;
            }
          }
        }
        if (entries.length === 0) this.channels.delete(channelKey);
      }
      if (dirty) this.recompute();
    }

    // Physics reads the post-aging scale later this frame, so elapsed uses it too.
    this.elapsedSeconds += dt * this.effectiveScale;
  }

  /**
   * Release every request. Called by the engine on scene exit.
   * @internal
   */
  _releaseAll(): void {
    for (const entries of this.channels.values()) {
      for (const entry of entries) entry.released = true;
    }
    this.channels.clear();
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
      return;
    }
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

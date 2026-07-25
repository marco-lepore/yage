import type { Entity } from "./Entity.js";
import type { Scene, SetupParams, SetupParamTuple } from "./Scene.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import { devWarn } from "./internal/dev.js";

/**
 * An entity class a pool can hand out: it declares its own `onAcquire`.
 *
 * The base `Entity.onAcquire` is optional, and an optional method does not
 * satisfy a required one — so a class that never declares the hook fails this
 * constraint at the `EntityPool` constructor instead of silently skipping its
 * per-reuse reset. A member that needs no reset states that with an empty
 * `onAcquire() {}`.
 */
export type PoolableEntity = Entity & { onAcquire(...args: never[]): void };

/** Pool behaviour. `TMax` carries whether the pool is capped into `acquire`'s return type. */
export interface EntityPoolOptions<
  T extends PoolableEntity,
  TMax extends number | undefined = number,
> {
  /**
   * Members to construct up front, parked dormant. They run their
   * constructor and `setup()`, never `onAcquire` — prewarming is not an
   * acquisition.
   */
  prewarm?: number;
  /**
   * Upper bound on total members, leased and free together. Left out, the
   * pool is elastic: it grows whenever every member is out and `acquire`
   * always returns one. Set, a saturated `acquire` returns `undefined` and
   * only `forceAcquire` still produces a member, by reclaiming one.
   */
  maxSize?: TMax;
  /**
   * Victim selection for `forceAcquire` on a saturated pool: the leased
   * member with the lowest value is taken, ties going to the one acquired
   * longest ago. Default: oldest acquired.
   */
  reclaimPriority?: (member: T) => number;
}

/**
 * Constructor arguments after the entity class, derived from the class's own
 * `setup()` signature the way `Scene.spawn`'s are: a class whose `setup`
 * requires params must pass them as `setup`, and one that takes none cannot.
 */
export type EntityPoolArgs<
  T extends PoolableEntity,
  TMax extends number | undefined,
> = [SetupParamTuple<T>] extends [never]
  ? [options?: EntityPoolOptions<T, TMax>]
  : SetupParamTuple<T> extends readonly []
    ? [options?: EntityPoolOptions<T, TMax>]
    : [] extends SetupParamTuple<T>
      ? [options?: EntityPoolOptions<T, TMax> & { setup?: SetupParams<T> }]
      : [options: EntityPoolOptions<T, TMax> & { setup: SetupParams<T> }];

/** `T` on an elastic pool, `T | undefined` on a capped one. */
export type AcquireResult<
  T extends PoolableEntity,
  TMax extends number | undefined,
> = undefined extends TMax ? T : T | undefined;

/**
 * A group of entities cycled by deactivation instead of spawn and destroy.
 * A member is built once, parked dormant when released, and woken on the next
 * `acquire`, so its Rapier body, Pixi display object and component instances
 * stay allocated between lives.
 *
 * ```ts
 * class Spark extends Entity {
 *   setup() { this.add(new Transform()); this.add(new GraphicsComponent()...); }
 *   onAcquire(x: number, y: number) { this.get(Transform).setPosition(x, y); }
 * }
 *
 * // In the scene's onEnter — the members' components resolve scene services.
 * this.sparks = new EntityPool(this, Spark, { prewarm: 32 });
 *
 * const spark = this.sparks.acquire(x, y);   // Spark: elastic pools always give one
 * this.sparks.release(spark);                // dormant, back in the pool
 * ```
 *
 * `acquire`'s arguments are the entity's own `onAcquire` parameters, and its
 * return type follows the pool: `T` while elastic, `T | undefined` once
 * `maxSize` is set. `forceAcquire` always returns a member, reclaiming the
 * lowest-priority live one when a capped pool is saturated.
 *
 * Reuse resets nothing by itself. `onAcquire` is where a member returns to a
 * known state — position, health, animation frame — because everything it
 * held while dormant is still there.
 */
export class EntityPool<
  T extends PoolableEntity,
  TMax extends number | undefined = undefined,
> {
  private readonly scene: Scene;
  private readonly Class: new () => T;
  private readonly setupParams: unknown;
  private readonly maxSize: number | undefined;
  private readonly reclaimPriority: ((member: T) => number) | undefined;

  /** Every member, in construction order. */
  private readonly members: T[] = [];
  /** Members available right now. */
  private readonly freeList: T[] = [];
  /** Members handed out and not yet released. */
  private readonly leases = new Set<T>();
  /** Released while the scene holds releases; moved to `freeList` on flush. */
  private readonly pendingRelease: T[] = [];
  /** Acquisition order, for the default oldest-first reclaim. */
  private readonly acquiredAt = new Map<T, number>();
  private acquireCount = 0;
  private _disposed = false;

  constructor(
    scene: Scene,
    Class: new () => T,
    ...args: EntityPoolArgs<T, TMax>
  ) {
    const options = args[0] as
      | (EntityPoolOptions<T, TMax> & { setup?: unknown })
      | undefined;

    if (!scene.context) {
      throw new Error(
        `EntityPool for ${Class.name} was created before scene "${scene.name}" had an engine context. ` +
          `Create pools in onEnter(), where scene services (physics world, render tree) are registered.`,
      );
    }

    const prewarm = options?.prewarm ?? 0;
    if (!Number.isInteger(prewarm) || prewarm < 0) {
      throw new Error(
        `EntityPool for ${Class.name}: prewarm must be a non-negative integer, got ${prewarm}.`,
      );
    }
    const maxSize = options?.maxSize;
    if (maxSize !== undefined) {
      if (!Number.isInteger(maxSize) || maxSize < 1) {
        throw new Error(
          `EntityPool for ${Class.name}: maxSize must be an integer of at least 1, got ${maxSize}.`,
        );
      }
      if (maxSize < prewarm) {
        throw new Error(
          `EntityPool for ${Class.name}: maxSize (${maxSize}) is below prewarm (${prewarm}).`,
        );
      }
    }

    this.scene = scene;
    this.Class = Class;
    this.setupParams = options?.setup;
    this.maxSize = maxSize;
    this.reclaimPriority = options?.reclaimPriority;

    scene._registerPool(this);

    for (let i = 0; i < prewarm; i++) {
      this.freeList.push(this.construct());
    }
  }

  /** Total members, leased and free together. */
  get size(): number {
    return this.members.length;
  }

  /** Members currently handed out. */
  get leased(): number {
    return this.leases.size;
  }

  /**
   * Members ready for the next `acquire`. A member released while the scene
   * is holding releases (`Scene.deferPoolReleases`) counts in neither `free`
   * nor `leased` until the hold ends.
   */
  get free(): number {
    return this.freeList.length;
  }

  /** True once `dispose()` has run, or the scene that owns the pool has exited. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Take a member: a dormant one if the pool has any, otherwise a new one
   * while the pool can still grow. Returns `undefined` only on a capped pool
   * with every member out.
   *
   * The member is active and in every matching query before `onAcquire` runs,
   * so the hook can reach its own components and siblings. Acquire during
   * Update and the member renders the same frame; acquire later (Render,
   * EndOfFrame) and it first draws on the next one.
   */
  acquire(...args: Parameters<T["onAcquire"]>): AcquireResult<T, TMax> {
    this.assertUsable("acquire");
    const member = this.takeFree() ?? this.grow();
    if (!member) return undefined as AcquireResult<T, TMax>;
    this.lease(member);
    this.callAcquire(member, args);
    return member as AcquireResult<T, TMax>;
  }

  /**
   * Take a member, always. Same as `acquire` while the pool can serve one; on
   * a saturated capped pool it reclaims instead — the lowest-`reclaimPriority`
   * live member is released and handed straight back, running `onRelease`,
   * then `onAcquire`, in the same call.
   *
   * One case bends the release hold: a capped pool whose every member was
   * released inside the current hold has nothing live to reclaim, so it hands
   * a held member back rather than fail a call that promises a member.
   */
  forceAcquire(...args: Parameters<T["onAcquire"]>): T {
    this.assertUsable("forceAcquire");
    const member = this.takeFree() ?? this.grow() ?? this.reclaim();
    this.lease(member);
    this.callAcquire(member, args);
    return member;
  }

  /**
   * Put a member back: `onRelease`, then dormant, then available again.
   * Releasing an entity this pool did not hand out — a double release, or
   * another pool's member — is a reported no-op.
   */
  release(member: T): void {
    if (this._disposed) return;
    if (!this.leases.has(member)) {
      devWarn(
        `EntityPool<${this.Class.name}>.release() ignored an entity it has not leased ` +
          `("${member.name}") — already released, or never acquired from this pool.`,
      );
      return;
    }
    this.leases.delete(member);
    this.acquiredAt.delete(member);
    try {
      this.callRelease(member);
    } finally {
      // A throwing hook still parks the member: it is out of the lease set
      // either way, and losing track of it would leak a live entity.
      this.stow(member);
    }
  }

  /** Release every leased member. */
  releaseAll(): void {
    for (const member of [...this.leases]) {
      this.release(member);
    }
  }

  /**
   * Destroy every member and stop the pool. `acquire` / `forceAcquire` throw
   * afterwards. The scene disposes its pools on exit, so a pool that lives as
   * long as its scene never needs this call.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.scene._unregisterPool(this);
    for (const member of this.members) {
      if (!member.isDestroyed) member.destroy();
    }
    this.members.length = 0;
    this.freeList.length = 0;
    this.pendingRelease.length = 0;
    this.leases.clear();
    this.acquiredAt.clear();
  }

  /**
   * Internal: move releases that happened while the scene held them into the
   * free list. Called by `Scene.deferPoolReleases` when the batch completes.
   * @internal
   */
  _flushPendingReleases(): void {
    for (const member of this.pendingRelease) {
      if (!member.isDestroyed) this.freeList.push(member);
    }
    this.pendingRelease.length = 0;
  }

  // ---- Internals ----

  private assertUsable(method: string): void {
    if (this._disposed) {
      throw new Error(
        `EntityPool<${this.Class.name}>.${method}() was called on a disposed pool. ` +
          `Pools are disposed when their scene exits — create a new one in onEnter().`,
      );
    }
  }

  /** Next available member, dropping any that were destroyed behind the pool's back. */
  private takeFree(): T | undefined {
    let member = this.freeList.pop();
    while (member?.isDestroyed) {
      this.forget(member);
      member = this.freeList.pop();
    }
    return member;
  }

  /** A brand-new member, or `undefined` when a capped pool is full. */
  private grow(): T | undefined {
    if (this.maxSize !== undefined && this.members.length >= this.maxSize) {
      this.evictDestroyed();
      if (this.members.length >= this.maxSize) return undefined;
    }
    return this.construct();
  }

  /**
   * Members are spawned dormant, so an entity that is about to sleep never
   * joins a query or fires an enable hook on the way in.
   */
  private construct(): T {
    const member = this.scene._spawnDormant(() => {
      // The setup params were typed against this class at the constructor;
      // `spawn`'s overloads can't re-derive that from the erased generic. The
      // three-argument form is the unambiguous one: a params object whose only
      // field is `key` would be read as spawn options in the short form.
      const spawn = this.scene.spawn as (
        this: Scene,
        Class: new () => T,
        params: unknown,
        options: object,
      ) => T;
      const entity = spawn.call(this.scene, this.Class, this.setupParams, {});
      // Park by the entity's own bit: the window only clears the inherited
      // one, which would let the member wake with an ancestor.
      entity._setActiveSuppressed(false);
      entity._markPooled();
      return entity;
    });
    this.members.push(member);
    return member;
  }

  private lease(member: T): void {
    // Bookkeeping first: a throwing hook below leaves the pool consistent,
    // with the member leased and active rather than in two places or none.
    this.leases.add(member);
    this.acquiredAt.set(member, ++this.acquireCount);
    member.setActive(true);
  }

  /** Put a member to sleep and back into the pool's keeping. */
  private stow(member: T): void {
    member.setActive(false);
    if (member.isDestroyed) {
      this.forget(member);
    } else if (this.scene._poolReleasesHeld) {
      this.pendingRelease.push(member);
    } else {
      this.freeList.push(member);
    }
  }

  /** Release the lowest-priority live member and hand it straight back. */
  private reclaim(): T {
    let victim: T | undefined;
    let best = Number.POSITIVE_INFINITY;
    let bestAge = Number.POSITIVE_INFINITY;
    for (const member of this.leases) {
      const age = this.acquiredAt.get(member)!;
      // A throw here aborts the reclaim before anything is mutated.
      const priority = this.reclaimPriority
        ? this.reclaimPriority(member)
        : age;
      if (priority < best || (priority === best && age < bestAge)) {
        victim = member;
        best = priority;
        bestAge = age;
      }
    }
    if (victim) {
      this.leases.delete(victim);
      this.acquiredAt.delete(victim);
      try {
        this.callRelease(victim);
      } catch (error) {
        // The caller never receives the member, so park it instead of losing
        // track of an entity that is in no collection.
        this.stow(victim);
        throw error;
      }
      // Straight back to the caller: a reclaimed member skips the free list,
      // and with it the release hold, which is what "force" buys.
      victim.setActive(false);
      return victim;
    }
    // Nothing is live, so every member sits in a held release batch. Handing
    // one back inside the batch is the last resort — better than failing a
    // call whose whole contract is that it returns a member.
    const held = this.pendingRelease.shift();
    if (held) return held;
    throw new Error(
      `EntityPool<${this.Class.name}>.forceAcquire() found no member to reclaim. ` +
        `The pool is empty — its members were destroyed outside it.`,
    );
  }

  private callAcquire(member: T, args: unknown[]): void {
    const hook = member.onAcquire as (...a: unknown[]) => void;
    const boundary = this.scene.context.tryResolve(ErrorBoundaryKey);
    if (boundary) {
      boundary.wrapCallback(() => hook.apply(member, args), {
        kind: "Entity onAcquire hook",
        entity: member.name,
        scene: this.scene.name,
      });
    } else {
      hook.apply(member, args);
    }
  }

  private callRelease(member: T): void {
    if (!member.onRelease) return;
    const hook = member.onRelease;
    const boundary = this.scene.context.tryResolve(ErrorBoundaryKey);
    if (boundary) {
      boundary.wrapCallback(() => hook.call(member), {
        kind: "Entity onRelease hook",
        entity: member.name,
        scene: this.scene.name,
      });
    } else {
      hook.call(member);
    }
  }

  private evictDestroyed(): void {
    for (const member of [...this.members]) {
      if (member.isDestroyed) this.forget(member);
    }
  }

  /** Drop a member the pool no longer owns (destroyed from outside). */
  private forget(member: T): void {
    const index = this.members.indexOf(member);
    if (index !== -1) this.members.splice(index, 1);
    const free = this.freeList.indexOf(member);
    if (free !== -1) this.freeList.splice(free, 1);
    const pending = this.pendingRelease.indexOf(member);
    if (pending !== -1) this.pendingRelease.splice(pending, 1);
    this.leases.delete(member);
    this.acquiredAt.delete(member);
  }
}

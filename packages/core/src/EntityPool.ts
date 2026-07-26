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

/**
 * Where a member stands. `releasing` covers the window inside `onRelease`:
 * no longer leased, not yet available, and not handed out by anything.
 */
type MemberStatus = "free" | "leased" | "releasing";

interface MemberState {
  status: MemberStatus;
  /** Acquisition order, for the default oldest-first reclaim. */
  seq: number;
}

/** Pool behaviour. `TMax` carries whether the pool is capped into `acquire`'s return type. */
export interface EntityPoolOptions<
  T extends PoolableEntity,
  TMax extends number | undefined = undefined,
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

  /**
   * Every member and where it stands. One record per member and one status
   * field inside it, so a member is always in exactly one state — it cannot
   * be filed twice or lost between two collections.
   */
  private readonly state = new Map<T, MemberState>();
  /**
   * Members believed free, newest first. A hint, not the truth: an entry
   * whose status has moved on is skipped when popped, which is why nothing
   * has to splice this list.
   */
  private readonly freeHint: T[] = [];
  private readonly counts: Record<MemberStatus, number> = {
    free: 0,
    leased: 0,
    releasing: 0,
  };
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

    try {
      for (let i = 0; i < prewarm; i++) {
        this.construct();
      }
    } catch (error) {
      // The constructor throws, so the caller never gets a reference and
      // could not dispose the members already built. Undo it here.
      this.dispose();
      throw error;
    }
  }

  /** Total members, leased and free together. */
  get size(): number {
    return this.state.size;
  }

  /** Members currently handed out. */
  get leased(): number {
    return this.counts.leased;
  }

  /**
   * Members ready for the next `acquire`. A member part-way through its
   * release counts in neither `free` nor `leased`.
   */
  get free(): number {
    return this.counts.free;
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
    const seq = this.lease(member);
    this.callAcquire(member, args);
    this.takeBackIfReleased(member, seq);
    return member as AcquireResult<T, TMax>;
  }

  /**
   * Take a member, always. Same as `acquire` while the pool can serve one; on
   * a saturated capped pool it reclaims instead — the lowest-`reclaimPriority`
   * live member is released and handed straight back, running `onRelease`,
   * then `onAcquire`, in the same call.
   *
   * The one call it cannot serve is from inside `onRelease` on a capped pool
   * with no other member left. The member that hook belongs to is mid-release
   * and handing it straight back would run the rest of its release over a
   * fresh acquisition, so this throws instead.
   */
  forceAcquire(...args: Parameters<T["onAcquire"]>): T {
    this.assertUsable("forceAcquire");
    const member = this.takeFree() ?? this.grow() ?? this.reclaim();
    const seq = this.lease(member);
    this.callAcquire(member, args);
    this.takeBackIfReleased(member, seq);
    return member;
  }

  /**
   * Put a member back: `onRelease`, then dormant, then available again.
   * Releasing an entity this pool did not hand out — a double release, or
   * another pool's member — is a reported no-op.
   */
  release(member: T): void {
    if (this._disposed) return;
    if (this.state.get(member)?.status !== "leased") {
      devWarn(
        `EntityPool<${this.Class.name}>.release() ignored an entity it has not leased ` +
          `("${member.name}") — already released, or never acquired from this pool.`,
      );
      return;
    }
    this.endLease(member);
    try {
      this.callRelease(member);
    } finally {
      // A throwing hook still parks the member rather than leaving it stuck
      // mid-release.
      this.stow(member);
    }
  }

  /**
   * Release every member leased when the call was made. A lease a release
   * hook creates while this runs is the hook's to keep: only the leases that
   * existed at call time end, and each only if it is still the same lease
   * when its turn comes.
   */
  releaseAll(): void {
    const leases: Array<[T, number]> = [];
    for (const [member, st] of this.state) {
      if (st.status === "leased") leases.push([member, st.seq]);
    }
    for (const [member, seq] of leases) {
      const st = this.state.get(member);
      if (st?.status === "leased" && st.seq === seq) this.release(member);
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
    for (const member of this.state.keys()) {
      // The pool owns their lifetime, so it destroys them through the path
      // that `Entity.destroy` refuses.
      member._destroyOwned();
    }
    this.state.clear();
    this.freeHint.length = 0;
    this.counts.free = 0;
    this.counts.leased = 0;
    this.counts.releasing = 0;
  }

  /**
   * Internal: take a member back because `Entity.destroy` was called on it.
   * A member that is not currently leased is already back in the pool, so
   * retiring it again is a no-op rather than a reported double release.
   * @internal
   */
  _releaseMember(member: Entity): void {
    const pooled = member as T;
    if (this.state.get(pooled)?.status === "leased") this.release(pooled);
  }

  /**
   * Internal: is this member currently lent out? `Entity.handle()` asks,
   * so a handle taken on a member sitting in the pool is born dead instead
   * of coming alive at the next acquisition.
   * @internal
   */
  _isLeased(member: Entity): boolean {
    return this.state.get(member as T)?.status === "leased";
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

  /** Next available member, skipping hints whose member has moved on. */
  private takeFree(): T | undefined {
    for (
      let member = this.freeHint.pop();
      member;
      member = this.freeHint.pop()
    ) {
      if (this.state.get(member)?.status === "free") return member;
    }
    return undefined;
  }

  /**
   * The one place a member's status changes, so the counters and the free
   * hint cannot drift from it.
   */
  private setStatus(member: T, next: MemberStatus): void {
    const st = this.state.get(member);
    if (!st || st.status === next) return;
    this.counts[st.status]--;
    this.counts[next]++;
    st.status = next;
    if (next === "free") this.freeHint.push(member);
  }

  /** A brand-new member, or `undefined` when a capped pool is full. */
  private grow(): T | undefined {
    if (this.maxSize !== undefined && this.state.size >= this.maxSize) {
      return undefined;
    }
    return this.construct();
  }

  /**
   * Members are spawned dormant, so an entity that is about to sleep never
   * joins a query or fires an enable hook on the way in.
   */
  private construct(): T {
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
    // The member is born inert, so it never fires an enable hook or joins a
    // query only to leave both when it is parked a moment later. Children its
    // `setup()` spawns inherit that through `spawnChild`.
    this.scene._spawnInert = true;
    let member: T;
    try {
      member = spawn.call(this.scene, this.Class, this.setupParams, {});
    } finally {
      this.scene._spawnInert = false;
    }
    // A member has no parent to settle its state, so clear its own bit too.
    member._setActiveSuppressed(false);
    member._markPooled(this);
    // Construction ran game code — `setup()`, component `onAdd`, the scene's
    // spawn events — with the member live and not yet pool-owned. That
    // proto-life ends here, so a handle taken during it does not resolve
    // into the first lease.
    member._endLife();
    this.state.set(member, { status: "free", seq: 0 });
    this.counts.free++;
    this.freeHint.push(member);
    return member;
  }

  /**
   * Restore the promise `acquire` makes — you own the member you are handed.
   * An `onAcquire` (or an `onEnable` the activation fired) that releases the
   * member being acquired would otherwise put it back in the pool while the
   * caller still holds it, and the next acquisition would hand the same
   * entity to someone else.
   *
   * Re-leasing follows the same rule as a first acquisition: a component
   * `onEnable` that throws during the reactivation leaves the member leased
   * and active, not half-filed. `releaseAll()` still reaches it.
   */
  private takeBackIfReleased(member: T, seq: number): void {
    const st = this.state.get(member);
    if (st?.status === "leased") {
      // Leased is not enough — it has to still be *this* acquisition's lease.
      if (st.seq === seq) return;
      throw new Error(
        `EntityPool<${this.Class.name}>: the acquire hooks released the member being acquired ` +
          `("${member.name}") and a nested acquisition took it. Two callers cannot hold one ` +
          `entity, so this acquisition fails. Release a member after its acquisition, not during it.`,
      );
    }
    devWarn(
      `EntityPool<${this.Class.name}>: the acquire hooks released the member being acquired ` +
        `("${member.name}"). The pool has taken it back — release it after the acquisition, not during it.`,
    );
    this.lease(member);
  }

  private lease(member: T): number {
    // Bookkeeping first: a throwing hook below leaves the pool consistent,
    // with the member leased and active rather than stuck mid-transition.
    const seq = ++this.acquireCount;
    const st = this.state.get(member);
    if (st) st.seq = seq;
    this.setStatus(member, "leased");
    member.setActive(true);
    return seq;
  }

  /**
   * End the lease this member is holding. Its generation moves on before any
   * hook runs, so a handle taken during that life stops resolving the moment
   * the life is over — including for the code doing the releasing.
   *
   * `releasing` is its own state rather than an absence: the member is no
   * longer leased and not yet available, and nothing can hand it out while
   * its hook runs.
   */
  private endLease(member: T): void {
    member._endLife();
    this.setStatus(member, "releasing");
  }

  /** Put a member to sleep and back into the pool's keeping. */
  private stow(member: T): void {
    try {
      // Asleep before it is filed, so an `onDisable` that acquires cannot be
      // handed the very member being released, half disabled.
      member.setActive(false);
    } finally {
      // Filed even if a hook threw: the member is out of its lease either
      // way, and losing track of it would cost a capped pool the slot.
      this.setStatus(member, "free");
    }
  }

  /** Release the lowest-priority live member and hand it straight back. */
  private reclaim(): T {
    let victim: T | undefined;
    let best = Number.POSITIVE_INFINITY;
    let bestAge = Number.POSITIVE_INFINITY;
    for (const [member, st] of this.state) {
      if (st.status !== "leased") continue;
      const age = st.seq;
      // A throw here aborts the reclaim before anything is mutated.
      const priority = this.reclaimPriority
        ? this.callPriority(this.reclaimPriority, member)
        : age;
      if (priority < best || (priority === best && age < bestAge)) {
        victim = member;
        best = priority;
        bestAge = age;
      }
    }
    if (victim) {
      this.endLease(victim);
      try {
        this.callRelease(victim);
        // The old life ends here, so components disable and a rigid body
        // drops its velocity before the next `onAcquire` poses it.
        victim.setActive(false);
      } catch (error) {
        // The caller never receives the member. File it rather than leave it
        // stuck part-way through its release — on a capped pool that would
        // cost the slot for good. `stow` re-runs the deactivation, which is a
        // no-op when that is what threw: `setActive` writes the flag before
        // running the hooks, so the second call returns early.
        this.stow(victim);
        throw error;
      }
      // Straight back to the caller: a reclaimed member skips the free list.
      // It stays `releasing` until `lease` takes it, so nothing else can pick
      // it up.
      return victim;
    }
    if (this.state.size > 0) {
      // A member whose `onRelease` is still running has left the lease set and
      // has not reached the free list. The pool cannot hand it out — the rest
      // of its release hook would run against a fresh acquisition — and it is
      // already at `maxSize`, so it cannot build one either.
      throw new Error(
        `EntityPool<${this.Class.name}>.forceAcquire() has no member to hand out. ` +
          `The pool is capped at ${this.maxSize} and its members are all being released. ` +
          `A call made from onRelease cannot take the member that release belongs to.`,
      );
    }
    throw new Error(
      `EntityPool<${this.Class.name}>.forceAcquire() found no member to reclaim. ` +
        `The pool is empty — its members were destroyed outside it.`,
    );
  }

  private callPriority(priority: (member: T) => number, member: T): number {
    const boundary = this.scene.context.tryResolve(ErrorBoundaryKey);
    if (!boundary) return priority(member);
    let value = 0;
    boundary.wrapCallback(
      () => {
        value = priority(member);
      },
      {
        kind: "EntityPool reclaimPriority",
        entity: member.name,
        scene: this.scene.name,
      },
    );
    return value;
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
}

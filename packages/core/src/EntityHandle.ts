import type { Entity } from "./Entity.js";

/**
 * A reference to one life of an entity, read through {@link current}.
 *
 * A pooled entity is reused: the same object serves many lives, so a plain
 * reference to a released member silently becomes a reference to whatever the
 * pool handed out next. A handle expires with the life it was taken in.
 *
 * ```ts
 * class Turret extends Entity {
 *   private target?: EntityHandle<Enemy>;
 *
 *   onSpotted(enemy: Enemy) { this.target = enemy.handle(); }
 *
 *   update() {
 *     const enemy = this.target?.current;   // undefined once that enemy is gone
 *     if (enemy) this.aimAt(enemy);
 *   }
 * }
 * ```
 *
 * Create one with `entity.handle()`. The type parameter is output-only, so an
 * `EntityHandle<Enemy>` can be stored where an `EntityHandle<Entity>` is
 * expected but not the other way round.
 */
export interface EntityHandle<out T extends Entity = Entity> {
  /**
   * The entity while the captured life lasts, `undefined` once it ends —
   * destroyed, or released back to its pool.
   *
   * "Same life", not "currently active": an entity turned off with
   * `setActive(false)` still resolves.
   */
  readonly current: T | undefined;
}

/**
 * The one implementation. Kept internal so `EntityHandle` stays a shape game
 * code reads, never constructs.
 */
class LiveEntityHandle<T extends Entity> implements EntityHandle<T> {
  constructor(
    private readonly target: T,
    private readonly generation: number,
  ) {}

  get current(): T | undefined {
    const target = this.target;
    if (target.isDestroyed || target.generation !== this.generation) {
      return undefined;
    }
    return target;
  }
}

/**
 * A handle that never resolves. Shared: it holds no target, and `T` is
 * output-only, so one instance stands in for every entity type.
 * @internal
 */
export const DEAD_ENTITY_HANDLE: EntityHandle<never> = { current: undefined };

/**
 * Internal: capture the entity's current life. `Entity.handle()` is the
 * public way in.
 * @internal
 */
export function _createEntityHandle<T extends Entity>(
  target: T,
  generation: number,
): EntityHandle<T> {
  return new LiveEntityHandle(target, generation);
}

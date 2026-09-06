import type { Entity, EntityCallbacks } from "./Entity.js";
import type { Scene, SetupArgs, SpawnOptions } from "./Scene.js";
import { ErrorBoundaryKey } from "./EngineContext.js";
import { isolate } from "./internal/isolate.js";

/** `ownedDepth`'s answer when the ancestor walk finds a cycle. */
const CYCLIC = -1;

/**
 * The operations available inside a {@link Scene.spawnBatch} callback.
 *
 * Reserve every entity first, link the hierarchy, then run setup. Because all
 * of them exist before any `setup()` runs, a setup parameter can hold a handle
 * to an entity that has not been set up yet.
 */
export interface SpawnBatch {
  /**
   * Construct an entity and register its key without running `setup()`. The
   * entity belongs to the scene from this point — `entity.scene`,
   * `entity.handle()`, and `entity.requireKey()` all work — but it stays out
   * of `scene.getEntities()`, `findByKey()`, and every query until the batch
   * commits.
   *
   * `options.active` sets the state the entity wakes up in. The default,
   * `true`, activates it when the batch commits; `false` commits it dormant,
   * to be woken later with `setActive(true)`.
   */
  reserve<E extends Entity>(Class: new () => E, options?: SpawnOptions): E;

  /**
   * Link two reserved entities, so the child's `setup()` can read its parent
   * and siblings. Both must come from this batch's `reserve()`.
   */
  addChild(parent: Entity, name: string, child: Entity): void;

  /**
   * Run a reserved entity's `setup()`. Trailing arguments follow its `setup`
   * signature, the way `scene.spawn(Class, params)` does.
   */
  setup<E extends Entity>(entity: E, ...rest: SetupArgs<E>): void;
}

/**
 * Runs one `Scene.spawnBatch()` call. Reserved entities are held out of the
 * scene until every one of them is built, so a failure anywhere discards the
 * whole set and publishes nothing.
 *
 * @internal
 */
export class SpawnBatchRunner implements SpawnBatch {
  private readonly reserved: Entity[] = [];
  private readonly owned = new Set<Entity>();
  private readonly keys = new Set<string>();
  private readonly announced = new Set<Entity>();
  private open = true;
  private disposed = false;

  /**
   * Callbacks handed to reserved entities in place of the scene's. A reserved
   * entity's components must not join queries or announce themselves before
   * commit, so component changes go nowhere; the batch replays them against
   * the scene's own callbacks when it publishes.
   */
  private readonly callbacks: EntityCallbacks = {
    onComponentAdded: () => {},
    onComponentRemoved: () => {},
    onEntityActivated: (entity) => {
      throw new Error(
        `Entity "${entity.name}" became active during a spawn batch. Reserved ` +
          `entities stay dormant until the batch commits — reserve it with ` +
          `{ active: true } instead of activating it from setup().`,
      );
    },
    onEntityDeactivated: () => {},
  };

  constructor(private readonly scene: Scene) {}

  reserve<E extends Entity>(Class: new () => E, options: SpawnOptions = {}): E {
    this.assertOpen();
    const entity = new Class();
    this.join(entity, options);
    return entity;
  }

  addChild(parent: Entity, name: string, child: Entity): void {
    this.assertOpen();
    this.assertOwned(parent, "parent");
    this.assertOwned(child, "child");
    parent.addChild(name, child);
  }

  setup<E extends Entity>(entity: E, ...rest: SetupArgs<E>): void {
    this.assertOpen();
    this.assertOwned(entity, "entity");
    const setup = entity.setup;
    if (!setup) return;
    // The same attribution `Scene.spawn` gives a setup hook: the throw is
    // recorded against the entity before it reaches the batch and rolls it
    // back, so the culprit is the hook and not the batch that ran it.
    const boundary = this.scene.context.tryResolve(ErrorBoundaryKey);
    if (boundary) {
      boundary.wrapCallback(() => setup.call(entity, rest[0]), {
        kind: "Entity setup() hook",
        entity: entity.name,
        scene: this.scene.name,
      });
    } else {
      setup.call(entity, rest[0]);
    }
  }

  /**
   * Take an entity `Entity.spawnChild()` created during the batch. It joins
   * the transaction under its reserved parent and follows it through commit
   * or rollback.
   * @internal
   */
  _adopt(entity: Entity, options: SpawnOptions): void {
    this.assertOpen();
    this.join(entity, options);
  }

  /**
   * Validate the batch and put its entities in the scene. Registration is its
   * own pass, so the first `entity:created` subscriber already sees the
   * complete entity and key set.
   * @internal
   */
  _register(): void {
    this.open = false;
    this.validate();
    this.scene._registerBatchEntities(this.reserved);
  }

  /**
   * Announce the committed entities in reservation order. An entity counts as
   * announced from the moment its events start going out, so a subscriber that
   * throws part-way through leaves no `entity:destroyed` unpaired when the
   * rollback runs.
   * @internal
   */
  _announce(): void {
    for (const entity of this.reserved) {
      this.announced.add(entity);
      this.scene._announceBatchEntity(entity);
    }
  }

  /**
   * Apply each reserved entity's requested active state, parent-first. Roots
   * carry the whole subtree: an entity reserved dormant stays dormant, and so
   * does everything under it.
   * @internal
   */
  _activate(): void {
    for (const entity of this.reserved) {
      if (!entity.parent) entity._resyncActive();
    }
  }

  /**
   * Discard the batch after `error`. Every reserved entity is torn down
   * child-first and detached from the scene, whether or not it was published.
   * Teardown failures are reported and do not stop the walk — `error` stays
   * the one thrown to the caller.
   * @internal
   */
  _dispose(error: unknown): void {
    if (this.disposed) return;
    this.disposed = true;
    this.open = false;
    const original = error instanceof Error ? error : new Error(String(error));
    const report = (cleanupError: unknown): void =>
      this.report(cleanupError, original);
    const run = isolate(report);

    // Ending every life first means a handle taken during the batch stops
    // resolving before any teardown hook runs and can observe a half-torn set.
    for (const entity of this.reserved) entity._markDestroyed();
    this.severForeignLinks(run);

    for (const entity of this.childFirst()) {
      this.scene._finalizeEntityDestroy(
        entity,
        this.announced.has(entity),
        report,
      );
    }
    this.scene._dropFromDestroyQueue(this.owned);
  }

  private join(entity: Entity, options: SpawnOptions): void {
    const key = options.key;
    if (key !== undefined) {
      if (this.keys.has(key)) {
        throw new Error(
          `This spawn batch already reserved an entity with key "${key}".`,
        );
      }
      this.scene._assertKeyFree(key);
    }
    entity._setActiveSuppressed(options.active ?? true);
    entity._setScene(this.scene, this.callbacks);
    if (key !== undefined) {
      entity._setKey(key);
      this.keys.add(key);
    }
    this.reserved.push(entity);
    this.owned.add(entity);
  }

  /**
   * Check what setup did before anything is published. A batch owns a closed
   * set of entities: it never publishes one that destroyed itself, and never
   * links one to an entity outside the batch, because rollback could not undo
   * either.
   */
  private validate(): void {
    for (const entity of this.reserved) {
      if (entity.isDestroyed) {
        throw new Error(
          `Reserved entity "${entity.name}" was destroyed during the spawn ` +
            `batch. Leave it out of the batch instead.`,
        );
      }
      if (entity.parent && !this.owned.has(entity.parent)) {
        throw new Error(
          `Reserved entity "${entity.name}" was parented to ` +
            `"${entity.parent.name}", which this spawn batch does not own.`,
        );
      }
      for (const child of entity.children.values()) {
        if (!this.owned.has(child)) {
          throw new Error(
            `Reserved entity "${entity.name}" took "${child.name}" as a ` +
              `child, and this spawn batch does not own it.`,
          );
        }
      }
      if (this.ownedDepth(entity) === CYCLIC) {
        throw new Error(
          `Reserved entity "${entity.name}" sits in a parent cycle. A batch ` +
            `commits a hierarchy, so an entity cannot be its own ancestor.`,
        );
      }
    }
  }

  /** Reserved entities deepest first, so a child is torn down before its parent. */
  private childFirst(): Entity[] {
    return [...this.reserved].sort(
      (a, b) => this.ownedDepth(b) - this.ownedDepth(a),
    );
  }

  /**
   * How many reserved ancestors an entity has, or `CYCLIC` when the walk finds
   * more of them than the batch reserved. `Entity.addChild` accepts a link that
   * closes a cycle, and rollback walks this before anything has validated the
   * hierarchy, so the bound is what keeps a malformed batch from hanging.
   */
  private ownedDepth(entity: Entity): number {
    let depth = 0;
    for (
      let parent = entity.parent;
      parent && this.owned.has(parent);
      parent = parent.parent
    ) {
      if (++depth > this.owned.size) return CYCLIC;
    }
    return depth;
  }

  /**
   * Cut links between the batch and entities it does not own, so tearing the
   * batch down cannot reach into the rest of the scene.
   */
  private severForeignLinks(run: (step: () => void) => void): void {
    for (const entity of this.reserved) {
      const parent = entity.parent;
      if (parent && !this.owned.has(parent)) {
        const slot = SpawnBatchRunner.slotOf(parent, entity);
        if (slot !== undefined) run(() => parent.removeChild(slot));
      }
      for (const [name, child] of [...entity.children]) {
        if (!this.owned.has(child)) run(() => entity.removeChild(name));
      }
    }
  }

  private static slotOf(parent: Entity, child: Entity): string | undefined {
    for (const [name, candidate] of parent.children) {
      if (candidate === child) return name;
    }
    return undefined;
  }

  /**
   * Record a teardown failure. The error the caller sees is the one that
   * started the rollback, so a second sighting of it is dropped.
   */
  private report(error: unknown, original: Error): void {
    if (error === original) return;
    this.scene.context
      ?.tryResolve(ErrorBoundaryKey)
      ?.reportLifecycleError(error, {
        kind: "Spawn batch cleanup",
        scene: this.scene.name,
      });
  }

  private assertOpen(): void {
    if (!this.open) {
      throw new Error(
        "This spawn batch is closed. Its operations are only available " +
          "inside the scene.spawnBatch() callback.",
      );
    }
  }

  private assertOwned(entity: Entity, role: string): void {
    if (!this.owned.has(entity)) {
      throw new Error(
        `Entity "${entity.name}" is not part of this spawn batch, so it ` +
          `cannot be used as the ${role}. Reserve it with batch.reserve().`,
      );
    }
  }
}

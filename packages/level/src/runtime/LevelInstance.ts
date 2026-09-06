import { ErrorBoundaryKey } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { describeError } from "../internal/describe.js";
import type { PreparedPlacement } from "../prepare/types.js";
import { LevelLoadError } from "./errors.js";

/**
 * The entities one level document put in a scene.
 *
 * It is a handle, not an entity: it is not the parent of what it loaded, and
 * it can destroy only what it created. A scene can hold several instances
 * under different namespaces.
 */
export class LevelInstance {
  private activated = false;
  private destroyed = false;

  /** @internal Built by `instantiateLevel()`. */
  constructor(
    private readonly scene: Scene,
    private readonly documentId: string,
    /** Parent-first, so reversing gives child-first teardown. */
    private readonly ordered: readonly PreparedPlacement[],
    private readonly byPlacementId: ReadonlyMap<string, Entity>,
  ) {}

  /** The document this instance loaded. */
  get id(): string {
    return this.documentId;
  }

  /**
   * The entity a placement became, or `undefined` for an unknown placement or
   * one whose entity the game has since destroyed.
   */
  get(placementId: string): Entity | undefined {
    const entity = this.byPlacementId.get(placementId);
    return entity === undefined || entity.isDestroyed ? undefined : entity;
  }

  /** Every live authored entity, parent-first. */
  get entities(): readonly Entity[] {
    const live: Entity[] = [];
    for (const prepared of this.ordered) {
      const entity = this.get(prepared.placement.id);
      if (entity) live.push(entity);
    }
    return live;
  }

  /** Whether {@link dispose} has run. */
  get isDisposed(): boolean {
    return this.destroyed;
  }

  /**
   * Apply the active state each placement was authored with, parent-first.
   *
   * `instantiateLevel()` calls this itself unless the caller asked for
   * deferred activation. It runs once: a second call throws, and a failure
   * disposes the instance rather than leaving a level half awake.
   */
  activate(): void {
    if (this.destroyed) {
      throw new LevelLoadError(
        `Level "${this.documentId}" is disposed, so its entities cannot be activated.`,
        { documentId: this.documentId },
      );
    }
    if (this.activated) {
      throw new LevelLoadError(
        `Level "${this.documentId}" is already activated. Activation applies the authored states once.`,
        { documentId: this.documentId },
      );
    }
    this.activated = true;

    for (const prepared of this.ordered) {
      const entity = this.get(prepared.placement.id);
      if (!entity) continue;
      try {
        entity.setActive(prepared.placement.active);
      } catch (error) {
        this.dispose();
        throw new LevelLoadError(
          `Activating placement "${prepared.placement.id}" of level "${this.documentId}" failed: ${describeError(error)}`,
          {
            documentId: this.documentId,
            placementId: prepared.placement.id,
            typeId: prepared.entry.id,
            cause: error,
          },
        );
      }
    }
  }

  /**
   * Destroy every authored entity this instance still owns, child-first, and
   * leave the rest of the scene alone. Calling it twice does nothing the
   * second time.
   *
   * Destruction goes through the engine's ordinary path, so it cascades to an
   * entity a placement spawned itself and the entities leave the scene at the
   * end of the frame. An authored entity the game reparented is still
   * destroyed, because the instance tracks what it created rather than where
   * it now sits.
   */
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const prepared of [...this.ordered].reverse()) {
      const entity = this.get(prepared.placement.id);
      if (!entity) continue;
      try {
        entity.destroy();
      } catch (error) {
        // Teardown runs to the end, and whatever started the disposal stays
        // the error the caller sees. `destroy()` runs game code on the way
        // down — releasing a pooled child calls its `onRelease` and its
        // components' `onDisable` — so one placement can throw while the rest
        // of the level still has to come apart.
        this.scene.context
          ?.tryResolve(ErrorBoundaryKey)
          ?.reportLifecycleError(error, {
            kind: "Level instance disposal",
            entity: entity.name,
            scene: this.scene.name,
          });
      }
    }
  }
}

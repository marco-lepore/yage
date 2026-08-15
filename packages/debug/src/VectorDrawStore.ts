import { devWarn, Transform } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import type { DebugVectorOptions, DebugVectorProvider } from "./types.js";

/** A registered vector arrow, with every option resolved to a value. */
export interface VectorEntry {
  readonly entity: Entity;
  readonly vector: DebugVectorProvider;
  readonly scale: number;
  readonly color: number;
  readonly alpha: number;
  readonly originX: number;
  readonly originY: number;
  readonly minLength: number;
  readonly width: number;
  readonly headSize: number;
}

/**
 * The vector arrows registered through `DebugRegistry.drawVector`, indexed by
 * entity id so a destroyed entity's registrations can be dropped in one step
 * — that happens on the `entity:destroyed` bus event, which fires whether or
 * not the overlay is on, so nothing accumulates in a build that never draws.
 */
export class VectorDrawStore {
  private readonly byEntity = new Map<number, Set<VectorEntry>>();
  private count = 0;

  /** Register an arrow, returning an idempotent disposer. */
  add(
    entity: Entity,
    vector: DebugVectorProvider,
    options: DebugVectorOptions = {},
  ): () => void {
    if (!entity.tryGet(Transform)) {
      // The arrow is positioned from the entity's world position, so there is
      // nowhere to draw it. Warn once here rather than staying silent every
      // frame — the registration still stands in case a Transform arrives.
      devWarn(
        `debug.drawVector() on "${entity.name}", which has no Transform — ` +
          `the arrow has no position to start from and will not draw.`,
      );
    }

    const entry: VectorEntry = {
      entity,
      vector,
      scale: options.scale ?? 1,
      color: options.color ?? 0xffffff,
      alpha: options.alpha ?? 0.9,
      originX: options.origin?.x ?? 0,
      originY: options.origin?.y ?? 0,
      minLength: options.minLength ?? 0,
      width: options.width ?? 2,
      headSize: options.headSize ?? 8,
    };

    const id = entity.id;
    let entries = this.byEntity.get(id);
    if (!entries) {
      entries = new Set();
      this.byEntity.set(id, entries);
    }
    entries.add(entry);
    this.count++;

    return () => {
      const current = this.byEntity.get(id);
      if (!current?.delete(entry)) return;
      this.count--;
      if (current.size === 0) this.byEntity.delete(id);
    };
  }

  /** Drop every arrow registered for an entity. */
  dropEntity(entityId: number): void {
    const entries = this.byEntity.get(entityId);
    if (!entries) return;
    this.count -= entries.size;
    this.byEntity.delete(entityId);
  }

  clear(): void {
    this.byEntity.clear();
    this.count = 0;
  }

  /** How many arrows are registered. */
  get size(): number {
    return this.count;
  }

  /** Safe to `dropEntity` mid-iteration — Map and Set iterators tolerate it. */
  *[Symbol.iterator](): IterableIterator<VectorEntry> {
    for (const entries of this.byEntity.values()) {
      yield* entries;
    }
  }
}

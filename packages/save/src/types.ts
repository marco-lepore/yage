import type { Entity } from "@yage/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedSlots = Record<string, any>;

/** Pluggable storage backend for save data. */
export interface SaveStorage {
  load(key: string): string | null;
  save(key: string, data: string): void;
  delete(key: string): void;
  /** Return all keys, optionally filtered to those starting with `prefix`. */
  list(prefix?: string): string[];
}

/**
 * Passed to `afterRestore` hooks so user code can resolve entity references
 * that were captured as IDs at save time.
 *
 * ```ts
 * // In serialize():
 * serialize() { return { targetId: this.target.id }; }
 *
 * // In afterRestore():
 * afterRestore(data: { targetId: number }, resolve: SnapshotResolver) {
 *   this.target = resolve.entity(data.targetId)!;
 * }
 * ```
 */
export interface SnapshotResolver {
  /** Resolve a save-time entity ID to the restored entity instance. Returns null if not found. */
  entity(savedId: number): Entity | null;
}

/** Complete snapshot of the game state. */
export interface GameSnapshot {
  version: number;
  timestamp: number;
  scenes: SceneSnapshotEntry[];
}

/** Serialized state for a single scene in the stack. */
export interface SceneSnapshotEntry {
  /** Scene type identifier (from @serializable decorator). */
  type: string;
  /** Whether the scene was paused at save time. */
  paused: boolean;
  /** Auto-collected entity snapshots. */
  entities: EntitySnapshotEntry[];
  /** User-defined scene data (from scene.serialize()). */
  userData?: unknown;
}

/** Serialized state for a single entity. */
export interface EntitySnapshotEntry {
  /** Entity runtime ID at save time (used to restore references). */
  id: number;
  /** Entity type identifier (from @serializable decorator). */
  type: string;
  /** Auto-collected component snapshots. */
  components: ComponentSnapshot[];
  /** User-defined entity data (from entity.serialize()). */
  userData?: unknown;
  /** Save-time ID of the parent entity, if this is a child. */
  parentId?: number;
  /** The name this entity was registered under in parent.addChild(). */
  childName?: string;
}

/** Serialized state for a single component. */
export interface ComponentSnapshot {
  /** Component class name. */
  type: string;
  /** Data from component.serialize(). */
  data: unknown;
}

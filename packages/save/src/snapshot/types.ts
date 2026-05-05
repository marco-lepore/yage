// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedSlots = Record<string, any>;

/** Pluggable storage backend for save data. */
export interface SnapshotStorage {
  load(key: string): string | null;
  save(key: string, data: string): void;
  delete(key: string): void;
  /** Return all keys, optionally filtered to those starting with `prefix`. */
  list(prefix?: string): string[];
}

/** Complete snapshot of the game state. */
export interface GameSnapshot {
  version: number;
  timestamp: number;
  scenes: SceneSnapshotEntry[];
  /**
   * Extension data contributed by plugins outside the entity/component model
   * — e.g. layer/scene/screen-scope effects from the renderer. Keyed by the
   * string passed to `SnapshotService.registerSnapshotExtra`.
   */
  extras?: Record<string, unknown>;
}

/**
 * Plugin-supplied snapshot data that doesn't fit the per-entity/component
 * model. The renderer registers one of these for layer/scene/screen-scope
 * effects.
 */
export interface SnapshotContributor {
  /** Build the snapshot fragment. Return `undefined` to omit the extra. */
  serialize(): unknown;
  /** Apply the snapshot fragment back onto live state. */
  restore(data: unknown): void | Promise<void>;
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

import type { LevelPoint } from "../document/types.js";

/**
 * Where a whole level sits in the scene. Composed into every top-level
 * placement's transform at load time, so a scene can place several copies of
 * one document without a generated root entity. It is a value, not a live
 * handle: moving it afterwards means moving the entities.
 */
export interface LevelInstanceTransform {
  readonly position?: LevelPoint;
  readonly rotation?: number;
  readonly scale?: LevelPoint;
}

/** What {@link instantiateLevel} takes beside the scene and the prepared level. */
export interface InstantiateLevelOptions {
  /**
   * Prefixes every scene key this load derives, as `<namespace>/<key-or-id>`.
   * It must not be empty and must not contain `/`, which is what makes the
   * first separator the split point and keeps two namespaces from deriving one
   * key. It also keeps level keys clear of the ones a game's own `spawn()`
   * calls register.
   */
  readonly namespace: string;
  /** Defaults to no offset, no rotation, and no scaling. */
  readonly transform?: LevelInstanceTransform;
  /**
   * `"deferred"` commits the entities dormant whatever the document says, for
   * a caller that wants them in the scene before they run — the editor's
   * preview is one. Wake them with `LevelInstance.activate()`. The default
   * applies the authored active states before `instantiateLevel()` returns.
   */
  readonly activation?: "immediate" | "deferred";
}

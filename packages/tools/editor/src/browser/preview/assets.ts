import type { AssetHandle, AssetManager } from "@yagejs/core";
import type { PreparedLevel } from "@yagejs/level";

/** How the engine's asset manager identifies one asset. */
export function assetKey(handle: AssetHandle<unknown>): string {
  return `${handle.type}:${handle.path}`;
}

/**
 * Holds one engine reference per asset the open level needs.
 *
 * Core's `AssetManager` reference-counts by key, so loading the same texture
 * from two rebuilds would take two references and releasing once would leave
 * one behind. This holds exactly one for each key the current level needs,
 * releases the keys it stops needing, and remembers which keys failed so a
 * rebuild caused by something else does not retry a missing file every time.
 *
 * Calls are serialized by the rebuild queue that drives them, so this holds no
 * queue of its own.
 */
export class PreviewAssetLease {
  private readonly held = new Map<string, AssetHandle<unknown>>();
  private readonly failed = new Map<string, string>();
  /** Keys the open level needs. What a release keeps. */
  private required = new Set<string>();

  constructor(private readonly assets: AssetManager) {}

  /** The keys that failed to load, with the reason each failed. */
  get failures(): ReadonlyMap<string, string> {
    return this.failed;
  }

  /**
   * Take what the level needs and does not already have, and make that list
   * the level's requirement. Each asset is loaded on its own, so one missing
   * file costs its own placements rather than the whole preview.
   *
   * Acquiring and releasing are separate calls, and acquiring comes first: a
   * texture both the old and the new document use must never drop to zero
   * references in between, because the engine destroys an asset when its last
   * reference goes.
   */
  async acquire(required: readonly AssetHandle<unknown>[]): Promise<void> {
    this.required = new Set(required.map(assetKey));
    for (const handle of required) {
      const key = assetKey(handle);
      if (this.held.has(key) || this.failed.has(key)) continue;
      try {
        await this.assets.loadAll([handle]);
        this.held.set(key, handle);
      } catch (error) {
        this.failed.set(
          key,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /**
   * Drop what the open level does not need.
   *
   * It reads the requirement the last {@link acquire} recorded rather than
   * taking one, so a release scheduled while an older level was open still
   * keeps what the current one needs.
   *
   * Call it once the entities that were using those assets have left their
   * scene, not merely been destroyed: destruction is flushed at the end of the
   * frame, and a render object still in the tree would draw with a texture
   * this destroys.
   */
  release(): void {
    for (const [key, handle] of [...this.held]) {
      if (this.required.has(key)) continue;
      this.assets.unload(handle);
      this.held.delete(key);
    }
    for (const key of [...this.failed.keys()]) {
      if (!this.required.has(key)) this.failed.delete(key);
    }
  }

  /** Release every reference this lease holds. Called when the editor closes. */
  releaseAll(): void {
    for (const handle of this.held.values()) this.assets.unload(handle);
    this.held.clear();
    this.failed.clear();
    this.required = new Set();
  }
}

/** Placements whose assets did not load, keyed to the reason. */
export function placementsMissingAssets(
  prepared: PreparedLevel,
  failures: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const blocked = new Map<string, string>();
  if (failures.size === 0) return blocked;
  for (const entry of prepared.placements) {
    for (const handle of entry.assets) {
      const reason = failures.get(assetKey(handle));
      if (reason === undefined) continue;
      blocked.set(entry.placement.id, reason);
      break;
    }
  }
  return blocked;
}

import type { AssetHandle, AssetLoader } from "./AssetHandle.js";

/**
 * Orchestrates asset loading across plugin-provided loaders.
 * Core owns the "when" and "what"; plugins own the "how".
 *
 * Loads are **reference-counted** by `type:path`: every handle passed to
 * `loadAll` adds a reference (even when the asset is already cached), and
 * `unload` only fires the loader's `unload` once the last reference is
 * released. Without this, two scenes preloading the same asset share one cache
 * entry, so the first `unload` would tear the asset out from under the other —
 * the underlying Pixi `Assets`/`BitmapFont` registries dedupe by key and are
 * not ref-counted, so the destruction would be real. `clear` ignores the
 * counts and frees everything outright.
 */
export class AssetManager {
  private loaders = new Map<string, AssetLoader>();
  private cache = new Map<string, unknown>();
  /** Live reference count per cache key — see the class-level note. */
  private refCounts = new Map<string, number>();

  /** Register a loader for a given asset type. Called by plugins during install(). */
  registerLoader(type: string, loader: AssetLoader): void {
    this.loaders.set(type, loader);
  }

  /** Retrieve a loaded asset. Throws if not loaded. */
  get<T>(handle: AssetHandle<T>): T {
    const key = this.key(handle);
    const asset = this.cache.get(key);
    if (asset === undefined) {
      throw new Error(`Asset not loaded: "${handle.path}" (type: ${handle.type})`);
    }
    return asset as T;
  }

  /** Check if an asset is loaded. */
  has(handle: AssetHandle<unknown>): boolean {
    return this.cache.has(this.key(handle));
  }

  /**
   * Load all assets, adding a reference to each and loading only the ones not
   * already cached. Reports progress via optional callback (0→1).
   *
   * Every distinct handle in `handles` adds one reference, whether it was
   * freshly loaded or already cached — so two scenes preloading the same asset
   * each hold a reference and a single `unload` won't free it under the other.
   * Duplicate handles within one call count once.
   */
  async loadAll(
    handles: readonly AssetHandle<unknown>[],
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    const seen = new Set<string>();
    const toLoad: AssetHandle<unknown>[] = [];
    for (const handle of handles) {
      const key = this.key(handle);
      if (seen.has(key)) continue;
      seen.add(key);
      // Already-cached handles still take a reference here; the fresh ones
      // take theirs once their load resolves (below), so a rejected load
      // never leaves a dangling count.
      if (this.cache.has(key)) this.retain(key);
      else toLoad.push(handle);
    }
    if (toLoad.length === 0) {
      onProgress?.(1);
      return;
    }
    let done = 0;
    onProgress?.(0);
    await Promise.all(
      toLoad.map(async (handle) => {
        const loader = this.loaders.get(handle.type);
        if (!loader) {
          throw new Error(
            `No loader registered for asset type "${handle.type}". Missing plugin?`,
          );
        }
        const asset = await loader.load(handle.path, handle.data);
        const key = this.key(handle);
        this.cache.set(key, asset);
        this.retain(key);
        onProgress?.(++done / toLoad.length);
      }),
    );
  }

  /**
   * Release one reference to an asset. The loader's `unload` runs and the cache
   * entry is dropped only when the last reference is released; earlier calls
   * just decrement. A no-op for handles that were never loaded.
   */
  unload(handle: AssetHandle<unknown>): void {
    const key = this.key(handle);
    const asset = this.cache.get(key);
    if (asset === undefined) return;
    const count = this.refCounts.get(key) ?? 0;
    if (count > 1) {
      this.refCounts.set(key, count - 1);
      return;
    }
    this.refCounts.delete(key);
    const loader = this.loaders.get(handle.type);
    loader?.unload?.(handle.path, asset);
    this.cache.delete(key);
  }

  /** Unload every cached asset outright, ignoring reference counts. */
  clear(): void {
    for (const [key, asset] of this.cache) {
      const [type, ...pathParts] = key.split(":");
      const path = pathParts.join(":");
      this.loaders.get(type!)?.unload?.(path, asset);
    }
    this.cache.clear();
    this.refCounts.clear();
  }

  /** Add one reference to a cache key. */
  private retain(key: string): void {
    this.refCounts.set(key, (this.refCounts.get(key) ?? 0) + 1);
  }

  private key(handle: AssetHandle<unknown>): string {
    return `${handle.type}:${handle.path}`;
  }
}

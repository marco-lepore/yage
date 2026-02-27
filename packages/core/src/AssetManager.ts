import type { AssetHandle, AssetLoader } from "./AssetHandle.js";

/**
 * Orchestrates asset loading across plugin-provided loaders.
 * Core owns the "when" and "what"; plugins own the "how".
 */
export class AssetManager {
  private loaders = new Map<string, AssetLoader>();
  private cache = new Map<string, unknown>();

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
   * Load all assets, skipping already-cached ones.
   * Reports progress via optional callback (0→1).
   */
  async loadAll(
    handles: readonly AssetHandle<unknown>[],
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    const toLoad = handles.filter((h) => !this.cache.has(this.key(h)));
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
        const asset = await loader.load(handle.path);
        this.cache.set(this.key(handle), asset);
        onProgress?.(++done / toLoad.length);
      }),
    );
  }

  /** Unload a single asset and remove from cache. */
  unload(handle: AssetHandle<unknown>): void {
    const key = this.key(handle);
    const asset = this.cache.get(key);
    if (asset === undefined) return;
    const loader = this.loaders.get(handle.type);
    loader?.unload?.(handle.path, asset);
    this.cache.delete(key);
  }

  /** Unload all cached assets. */
  clear(): void {
    for (const [key, asset] of this.cache) {
      const [type, ...pathParts] = key.split(":");
      const path = pathParts.join(":");
      this.loaders.get(type!)?.unload?.(path, asset);
    }
    this.cache.clear();
  }

  private key(handle: AssetHandle<unknown>): string {
    return `${handle.type}:${handle.path}`;
  }
}

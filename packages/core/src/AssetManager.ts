import type { AssetHandle, AssetLoader } from "./AssetHandle.js";
import { devWarn } from "./internal/dev.js";

/** A loaded asset plus the `data` of the handle whose load produced it. */
interface CacheEntry {
  asset: unknown;
  data: unknown;
}

/**
 * Orchestrates asset loading across plugin-provided loaders.
 * Core owns the "when" and "what"; plugins own the "how".
 *
 * Loads are **reference-counted** by `type:path`: every handle passed to
 * `loadAll` adds a reference once the whole call has resolved, and `unload`
 * only fires the loader's `unload` once the last reference is released.
 * Without this, two scenes preloading the same asset share one cache
 * entry, so the first `unload` would tear the asset out from under the other —
 * the underlying Pixi `Assets`/`BitmapFont` registries dedupe by key and are
 * not ref-counted, so the destruction would be real. `clear` ignores the
 * counts and frees everything outright.
 *
 * A failed `loadAll` takes no references at all, so its already-loaded
 * siblings stay cached and uncounted: a retry counts each of them once and a
 * single `unload` per handle frees them.
 */
export class AssetManager {
  private loaders = new Map<string, AssetLoader>();
  private cache = new Map<string, CacheEntry>();
  /** Live reference count per cache key — see the class-level note. */
  private refCounts = new Map<string, number>();
  /** Paths already warned about, so one authoring mistake warns once. */
  private warnedConflicts = new Set<string>();

  /** Register a loader for a given asset type. Called by plugins during install(). */
  registerLoader(type: string, loader: AssetLoader): void {
    this.loaders.set(type, loader);
  }

  /** Retrieve a loaded asset. Throws if not loaded. */
  get<T>(handle: AssetHandle<T>): T {
    const key = this.key(handle);
    const entry = this.cache.get(key);
    if (entry === undefined) {
      throw new Error(
        `Asset not loaded: "${handle.path}" (type: ${handle.type})`,
      );
    }
    return entry.asset as T;
  }

  /** Check if an asset is loaded. */
  has(handle: AssetHandle<unknown>): boolean {
    return this.cache.has(this.key(handle));
  }

  /**
   * Load all assets, adding a reference to each and loading only the ones not
   * already cached. Reports progress via optional callback (0→1).
   *
   * Every distinct handle in `handles` adds one reference — whether it was
   * freshly loaded or already cached — once every load in the call has
   * resolved, so two scenes preloading the same asset each hold a reference
   * and a single `unload` won't free it under the other. Duplicate handles
   * within one call count once, and a call that rejects counts nothing.
   *
   * A second handle for a path already loaded under a different `data` reuses
   * the first load and warns: the cache is keyed by type and path alone.
   */
  async loadAll(
    handles: readonly AssetHandle<unknown>[],
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    const seen = new Map<string, AssetHandle<unknown>>();
    const keys: string[] = [];
    const toLoad: AssetHandle<unknown>[] = [];
    for (const handle of handles) {
      const key = this.key(handle);
      const first = seen.get(key);
      if (first) {
        this.warnOnConflictingData(handle, first.data);
        continue;
      }
      seen.set(key, handle);
      keys.push(key);
      const entry = this.cache.get(key);
      if (entry) this.warnOnConflictingData(handle, entry.data);
      else toLoad.push(handle);
    }
    if (toLoad.length === 0) {
      onProgress?.(1);
      for (const key of keys) this.retain(key);
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
        this.cache.set(this.key(handle), { asset, data: handle.data });
        onProgress?.(++done / toLoad.length);
      }),
    );
    // References are taken in one pass at the end: a rejected call leaves its
    // siblings cached but uncounted, so the retry that follows counts each of
    // them exactly once.
    for (const key of keys) this.retain(key);
  }

  /**
   * Release one reference to an asset. The loader's `unload` runs and the cache
   * entry is dropped only when the last reference is released; earlier calls
   * just decrement. A no-op for handles that were never loaded.
   */
  unload(handle: AssetHandle<unknown>): void {
    const key = this.key(handle);
    const entry = this.cache.get(key);
    if (entry === undefined) return;
    const count = this.refCounts.get(key) ?? 0;
    if (count > 1) {
      this.refCounts.set(key, count - 1);
      return;
    }
    this.refCounts.delete(key);
    const loader = this.loaders.get(handle.type);
    loader?.unload?.(handle.path, entry.asset);
    this.cache.delete(key);
    this.warnedConflicts.delete(key);
  }

  /** Unload every cached asset outright, ignoring reference counts. */
  clear(): void {
    for (const [key, entry] of this.cache) {
      const [type, ...pathParts] = key.split(":");
      const path = pathParts.join(":");
      this.loaders.get(type!)?.unload?.(path, entry.asset);
    }
    this.cache.clear();
    this.refCounts.clear();
    this.warnedConflicts.clear();
  }

  /** Add one reference to a cache key. */
  private retain(key: string): void {
    this.refCounts.set(key, (this.refCounts.get(key) ?? 0) + 1);
  }

  private key(handle: AssetHandle<unknown>): string {
    return `${handle.type}:${handle.path}`;
  }

  /**
   * Warn when a handle declares different loader `data` than the load that
   * serves it — the cache entry, or the first declaration in the same
   * `loadAll` call. One path under one type is one entry, so the
   * second declaration's `data` never reaches a loader — usually a typo or a
   * copied line rather than a deliberate second variant.
   */
  private warnOnConflictingData(
    handle: AssetHandle<unknown>,
    loadedData: unknown,
  ): void {
    // The common case is the same handle constant declared by two scenes.
    if (Object.is(loadedData, handle.data)) return;
    const loaded = describeData(loadedData);
    const declared = describeData(handle.data);
    if (loaded === declared) return;
    const key = this.key(handle);
    if (this.warnedConflicts.has(key)) return;
    this.warnedConflicts.add(key);
    devWarn(
      `AssetManager: "${handle.path}" (type: ${handle.type}) was loaded with ` +
        `${loaded} and is declared again with ${declared}. The first load ` +
        "wins and the second declaration's options are ignored — load one " +
        "path under one set of options.",
    );
  }
}

/**
 * Loader `data` as a comparable, readable string. Object keys are sorted so
 * two declarations that differ only in the order they were written compare
 * equal; every shipped `data` is a plain object of primitives.
 */
function describeData(value: unknown): string {
  if (value === undefined) return "no options";
  try {
    return (
      JSON.stringify(value, (_key, val: unknown) => {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          return val;
        }
        const sorted: Record<string, unknown> = {};
        for (const name of Object.keys(val as Record<string, unknown>).sort()) {
          sorted[name] = (val as Record<string, unknown>)[name];
        }
        return sorted;
      }) ?? String(value)
    );
  } catch {
    // A custom loader may put anything on a handle; a diagnostic must not be
    // the thing that breaks the load.
    return "options that cannot be printed";
  }
}

/**
 * A phantom-typed handle referencing an asset by type and path.
 * Created by plugin-specific factory functions (e.g. `texture()`, `sound()`).
 * Core knows nothing about concrete asset types.
 */
export class AssetHandle<T> {
  constructor(
    /** Loader type key (e.g. "texture", "sound"). */
    readonly type: string,
    /** Asset path or URL. */
    readonly path: string,
  ) {}

  /** Phantom field to preserve the generic type at compile time. */
  declare readonly _type: T;
}

/** Interface that plugins implement to load/unload a specific asset type. */
export interface AssetLoader<T = unknown> {
  load(path: string): Promise<T>;
  unload?(path: string, asset: T): void;
}

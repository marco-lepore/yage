import type { AssetHandle } from "@yagejs/core";
import type { AssetManager } from "@yagejs/core";

// ---------------------------------------------------------------------------
// Module-level AssetManager access (set by UIPlugin.install)
// ---------------------------------------------------------------------------

let assetManager: AssetManager | undefined;

/** Store the AssetManager reference for UI elements that need textures. */
export function setAssetManager(am: AssetManager): void {
  assetManager = am;
}

/** Resolve an AssetHandle to its loaded asset. Throws if not available. */
export function resolveTexture<T>(handle: AssetHandle<T>): T {
  if (!assetManager) {
    throw new Error("AssetManager not available. Did you add UIPlugin?");
  }
  return assetManager.get(handle);
}

import type { AssetHandle } from "@yagejs/core";
import type { JsonValue } from "../document/types.js";
import { createBuiltInAssetParamKind, type ParamKind } from "./types.js";

/**
 * How one kind of project asset becomes a loadable handle.
 *
 * The `create` function comes from the plugin that owns the asset — `texture`
 * from `@yagejs/renderer`, for instance — so a level never names a loader
 * itself. It must be deterministic: preparation calls it while deriving a
 * level's preload set and again while decoding parameters.
 *
 * ```ts
 * const textureAsset = defineLevelAsset({ kind: "texture", create: texture });
 * ```
 */
export interface LevelAssetDescriptor<T> {
  /** Stable name for this kind of asset, used in messages. */
  readonly kind: string;
  /** Builds the handle for a project-relative POSIX path. */
  create(path: string): AssetHandle<T>;
}

/** Declare a kind of project asset that `param.asset()` can refer to. */
export function defineLevelAsset<T>(
  descriptor: LevelAssetDescriptor<T>,
): LevelAssetDescriptor<T> {
  return Object.freeze({
    kind: descriptor.kind,
    create: descriptor.create,
  });
}

/**
 * A project asset, authored as a project-relative POSIX path and decoded to
 * the handle its descriptor builds. The path is what the level file stores;
 * the descriptor is what knows how to load it.
 */
function assetParam<T>(
  descriptor: LevelAssetDescriptor<T>,
  defaultPath: string,
): ParamKind<AssetHandle<T>> {
  const create = (value: JsonValue): AssetHandle<T> => {
    const path = value as string;
    const handle = descriptor.create(path);
    // Checked by shape rather than with `instanceof`: a project that ends up
    // with two copies of `@yagejs/core` would otherwise have every valid
    // handle rejected, which is worse than accepting a wrong-shaped one.
    if (
      typeof handle !== "object" ||
      handle === null ||
      typeof (handle as AssetHandle<T>).type !== "string" ||
      typeof (handle as AssetHandle<T>).path !== "string"
    ) {
      throw new Error(
        `The ${descriptor.kind} asset descriptor returned ${handle === null ? "null" : typeof handle} for "${path}" instead of an AssetHandle.`,
      );
    }
    return handle;
  };
  return createBuiltInAssetParamKind({
    assetKind: descriptor.kind,
    defaultValue: defaultPath,
    validate: validateAssetPath,
    decode: create,
    assets: (value: JsonValue) => [create(value)],
  });
}

/** The parameter kinds a level can author. */
export const param = Object.freeze({ asset: assetParam });

/**
 * An authored asset path is project-relative and POSIX, so a level names one
 * shape of path and the loader resolves it the same way on every platform.
 */
function validateAssetPath(value: JsonValue): readonly string[] {
  if (typeof value !== "string") return ["must be an asset path string"];
  if (value === "") return ["must not be empty"];
  if (value.includes("\\")) {
    return ["must use POSIX separators, not backslashes"];
  }
  if (value.startsWith("/")) return ["must be relative to the project"];
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === ".")) {
    return ['must not contain an empty or "." path segment'];
  }
  if (segments.includes("..")) {
    return ['must not contain a ".." path segment'];
  }
  return [];
}

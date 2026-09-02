import type { AssetHandle, Entity, EntityHandle } from "@yagejs/core";
import type { JsonValue } from "../document/types.js";
import {
  createBuiltInParamKind,
  type AssetFrames,
  type ParamKind,
} from "./types.js";

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
 *
 * `frames` says how the named file is cut into a grid of frames. It is
 * authoring data: it changes nothing about the path, the decoded handle, or
 * the level document, and it exists so an authoring tool can show one frame of
 * a sheet rather than the whole strip. Its members are the renderer's
 * `TextureSliceOptions`, so the type that declares it spreads the same object
 * into the frame source it builds:
 *
 * ```ts
 * const TORCH_FRAMES = { frameWidth: 48 };
 *
 * const TorchParams = defineParams({
 *   sprite: param.asset(textureAsset, "assets/torch.png", TORCH_FRAMES),
 * });
 * ```
 */
function assetParam<T>(
  descriptor: LevelAssetDescriptor<T>,
  defaultPath: string,
  frames?: AssetFrames,
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
  return createBuiltInParamKind({
    name: "asset",
    assetKind: descriptor.kind,
    // Copied, because the caller keeps the object to spread into its own frame
    // source and a later mutation of it must not change what the schema says.
    ...(frames === undefined ? {} : { frames: Object.freeze({ ...frames }) }),
    defaultValue: defaultPath,
    validate: validateAssetPath,
    decode: create,
    assets: (value: JsonValue) => [create(value)],
  });
}

/** What a reference parameter accepts. */
export interface EntityRefOptions {
  /** The placement types it may point at, as catalog type ids. At least one. */
  readonly types: readonly string[];
  /** Whether "no target" is a value here. Defaults to `false`. */
  readonly optional?: boolean;
}

/**
 * Another placement in the same level, authored as that placement's id and
 * decoded to a handle on the entity it became.
 *
 * Every placement is reserved before any `setup()` runs, so a reference
 * resolves whichever order the document lists the two placements in, and two
 * placements may point at each other. The target's own `setup()` may not have
 * run yet, so store the handle in `setup()` and read `.current` from a
 * component's `onEnable()` or later.
 *
 * ```ts
 * const SwitchParams = defineParams({
 *   door: param.entityRef<Door>({ types: ["game.door"] }),
 *   chime: param.entityRef<Chime>({ types: ["game.chime"], optional: true }),
 * });
 * ```
 *
 * The type argument is what `setup()` sees. Nothing checks it at runtime: the
 * accepted type ids do, when the catalog is built and when the level is
 * prepared.
 */
function entityRefParam<T extends Entity = Entity>(
  options: EntityRefOptions & { readonly optional: true },
): ParamKind<EntityHandle<T> | undefined>;
function entityRefParam<T extends Entity = Entity>(
  options: EntityRefOptions,
): ParamKind<EntityHandle<T>>;
function entityRefParam<T extends Entity = Entity>(
  options: EntityRefOptions,
): ParamKind<EntityHandle<T> | undefined> {
  return createBuiltInParamKind({
    name: "entityRef",
    // Copied and frozen, because the caller keeps the array it passed and a
    // later mutation of it must not change what the schema accepts.
    types: Object.freeze([...options.types]),
    optional: options.optional ?? false,
    // Nothing is chosen until an author chooses it. A required reference left
    // at its default is reported when the level is prepared, not here.
    defaultValue: null,
    validate: validateEntityRef,
    decode: (value, context) =>
      value === null
        ? undefined
        : (context.resolveEntityRef(value as string) as EntityHandle<T>),
    assets: () => [],
  });
}

/**
 * A reference is a placement id or nothing. Whether nothing is allowed is
 * preparation's question: the catalog validates every declared default, and a
 * reference's default is `null` whether or not the field is optional.
 */
function validateEntityRef(value: JsonValue): readonly string[] {
  if (value === null) return [];
  if (typeof value !== "string") return ["must be a placement id or null"];
  if (value === "") return ["must not be empty"];
  return [];
}

/** The parameter kinds a level can author. */
export const param = Object.freeze({
  asset: assetParam,
  entityRef: entityRefParam,
});

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

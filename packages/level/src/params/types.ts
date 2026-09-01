import type { AssetHandle } from "@yagejs/core";
import type { JsonValue } from "../document/types.js";

/**
 * One parameter's kind: the JSON it accepts, the runtime value that JSON
 * decodes to, and the assets the value needs loaded.
 *
 * @internal Kinds are built through {@link param}. This type is exported so
 * `ParamsOf` can be written down, not so code outside the package implements
 * one.
 */
export interface ParamKind<T> {
  /** Stable kind name, used in messages. */
  readonly name: "asset";
  /**
   * The kind of asset this parameter names, from the descriptor
   * `param.asset()` was given — `"texture"`, `"sound"`, whatever a project
   * declared. Open, because {@link defineLevelAsset} is public.
   */
  readonly assetKind: string;
  /**
   * The value the editor writes into a new placement. Loading never fills it
   * in: a placement that omits the field fails validation, so changing this
   * cannot change what an existing level means.
   */
  readonly defaultValue: JsonValue;
  /**
   * Problems with an authored value, each completing the sentence
   * "`<path>` …". An empty list means {@link decode} and {@link assets} may
   * run on the value.
   */
  validate(value: JsonValue): readonly string[];
  /** The runtime value passed to `setup()`. Call only on a validated value. */
  decode(value: JsonValue): T;
  /** Handles the decoded value needs loaded. Call only on a validated value. */
  assets(value: JsonValue): readonly AssetHandle<unknown>[];
}

/** The parameter kinds of one schema, by parameter name. */
export type ParamFields = Readonly<Record<string, ParamKind<unknown>>>;

/**
 * A placeable entity's parameter schema, built by {@link defineParams}. It is
 * runtime data and the source of the `setup()` parameter type; it carries no
 * operations of its own.
 */
export interface ParamsSchema<F extends ParamFields> {
  /** @internal The kinds, copied into a frozen null-prototype object. */
  readonly _fields: F;
}

/** One schema field an authoring tool can render. */
export type ParamFieldDescription = {
  readonly name: string;
  /**
   * Which control the field needs. A closed set: a tool switches on it and a
   * new kind is meant to fail that switch to compile.
   */
  readonly kind: "asset";
  /**
   * For an asset field, the kind of asset it names — the `kind` of the
   * descriptor `param.asset()` was given. Open rather than closed, because a
   * game declares its own asset kinds through {@link defineLevelAsset}, so a
   * tool matches the kinds it knows and treats the rest as paths.
   */
  readonly assetKind?: string;
  readonly defaultValue: string;
};

/** The decoded parameter object a schema produces — a `setup()` signature. */
export type ParamsOf<S> =
  S extends ParamsSchema<infer F>
    ? { [K in keyof F]: RuntimeValueOf<F[K]> }
    : never;

type RuntimeValueOf<K> = K extends ParamKind<infer T> ? T : never;

/** Where a parameter problem is, and what it is. */
export interface ParamError {
  /**
   * Key segments from the parameter object down to the value. A list rather
   * than a joined string, because an authored key may contain any character.
   */
  readonly path: readonly string[];
  readonly message: string;
}

type AssetParamKindDefinition<T> = {
  readonly assetKind: string;
  readonly defaultValue: JsonValue;
  readonly validate: (value: JsonValue) => readonly string[];
  readonly decode: (value: JsonValue) => T;
  readonly assets: (value: JsonValue) => readonly AssetHandle<unknown>[];
};

/**
 * Package-private construction proof for built-in kinds. A private field is
 * tied to the exact instances this class creates and cannot be copied by
 * object spread.
 */
class BuiltInAssetParamKind<T> implements ParamKind<T> {
  readonly #brand = true;
  readonly name = "asset";
  readonly assetKind: string;
  readonly defaultValue: JsonValue;
  readonly validate: (value: JsonValue) => readonly string[];
  readonly decode: (value: JsonValue) => T;
  readonly assets: (value: JsonValue) => readonly AssetHandle<unknown>[];

  constructor(definition: AssetParamKindDefinition<T>) {
    this.assetKind = definition.assetKind;
    this.defaultValue = definition.defaultValue;
    this.validate = definition.validate;
    this.decode = definition.decode;
    this.assets = definition.assets;
  }

  static is(value: unknown): value is ParamKind<unknown> {
    return typeof value === "object" && value !== null && #brand in value;
  }
}

/** @internal Build a package-owned asset parameter kind. */
export function createBuiltInAssetParamKind<T>(
  definition: AssetParamKindDefinition<T>,
): ParamKind<T> {
  return Object.freeze(new BuiltInAssetParamKind(definition));
}

/** @internal Whether a value is a parameter kind built by this package. */
export function isBuiltInParamKind(
  value: unknown,
): value is ParamKind<unknown> {
  return BuiltInAssetParamKind.is(value);
}

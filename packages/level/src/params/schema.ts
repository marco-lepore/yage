import type { AssetHandle } from "@yagejs/core";
import type { JsonObject, JsonValue } from "../document/types.js";
import { describeError } from "../internal/describe.js";
import type {
  ParamError,
  ParamFieldDescription,
  ParamFields,
  ParamKind,
  ParamsOf,
  ParamsSchema,
} from "./types.js";
import { isBuiltInParamKind } from "./types.js";

/**
 * Declare a placeable entity's parameters.
 *
 * ```ts
 * const CrateParams = defineParams({
 *   texture: param.asset(textureAsset, "sprites/crate.png"),
 * });
 * ```
 *
 * The result is passed to `defineLevelEntity({ params })`, and
 * `ParamsOf<typeof CrateParams>` is the entity's `setup()` parameter type.
 *
 * Declaring a schema never throws. A field whose default its own kind rejects
 * is reported when the catalog is built, so the editor lists it and keeps
 * working; a throw here would come out of the entity module's import and lock
 * editing instead.
 */
export function defineParams<F extends ParamFields>(
  fields: F,
): ParamsSchema<F> {
  // Null prototype, so a parameter named "__proto__" becomes an own key
  // instead of replacing the prototype.
  const copied = Object.create(null) as Record<string, ParamKind<unknown>>;
  for (const [name, kind] of Object.entries(fields)) copied[name] = kind;
  return Object.freeze({ _fields: Object.freeze(copied) as F });
}

/**
 * Problems with the schema's own declared defaults. The catalog runs this so
 * an unusable default is found once, when the project's declarations are
 * collected, rather than at the placement that first uses it.
 */
export function schemaDefaultProblems(
  schema: ParamsSchema<ParamFields>,
): readonly ParamError[] {
  const errors: ParamError[] = [];
  for (const [name, kind] of fieldsOf(schema)) {
    if (!isBuiltInParamKind(kind)) {
      errors.push({ path: [name], message: "kind did not come from param.*" });
      continue;
    }
    for (const message of kind.validate(kind.defaultValue)) {
      errors.push({ path: [name], message: `default ${message}` });
    }
  }
  return errors;
}

/**
 * The data an authoring tool needs to render a schema's built-in fields.
 *
 * Descriptions follow declaration order and contain no validators, decoders,
 * asset factories, or other project callbacks.
 */
export function describeParams(
  schema: ParamsSchema<ParamFields>,
): readonly ParamFieldDescription[] {
  const descriptions = fieldsOf(schema).map(([name, kind]) => {
    if (!isBuiltInParamKind(kind)) {
      throw new TypeError(
        `Parameter "${name}" kind did not come from param.*.`,
      );
    }
    return Object.freeze({
      name,
      kind: kind.name,
      assetKind: kind.assetKind,
      defaultValue: kind.defaultValue as string,
    });
  });
  return Object.freeze(descriptions);
}

/**
 * The parameter object an editor writes into a new placement: every field at
 * its declared default.
 *
 * Defaults are resolved once, when the placement is created, so changing a
 * declaration's default later cannot change what an existing level means. A
 * placement that omits a parameter is an error at load time for the same
 * reason, rather than falling back to the default.
 *
 * Each value is the declaration's own `defaultValue` rather than a copy of it.
 * Every parameter kind is string-valued today, so nothing shares mutable
 * state; a kind whose default is an object or an array has to copy here before
 * two placements can hold one.
 */
export function defaultParams(schema: ParamsSchema<ParamFields>): JsonObject {
  const params = Object.create(null) as Record<string, JsonValue>;
  for (const [name, kind] of fieldsOf(schema)) params[name] = kind.defaultValue;
  return params as JsonObject;
}

/**
 * Every problem with an authored parameter object: an unknown key, a missing
 * key, or a value its kind rejects.
 *
 * A missing key is an error rather than a default. The default exists for
 * authoring — the editor resolves it when it creates a placement — so a later
 * change to a default cannot silently change what an existing level means.
 */
export function validateParams(
  schema: ParamsSchema<ParamFields>,
  params: JsonObject,
): readonly ParamError[] {
  const errors: ParamError[] = [];
  const fields = fieldsOf(schema);
  const declared = new Set(fields.map(([name]) => name));

  for (const key of Object.keys(params)) {
    if (!declared.has(key)) {
      errors.push({ path: [key], message: "is not a declared parameter" });
    }
  }
  for (const [name, kind] of fields) {
    const value = ownValue(params, name);
    if (value === undefined) {
      errors.push({ path: [name], message: "is required and is missing" });
      continue;
    }
    for (const message of kind.validate(value)) {
      errors.push({ path: [name], message });
    }
  }
  return errors;
}

/**
 * The runtime values `setup()` receives. Call only on parameters that
 * {@link validateParams} accepted.
 */
export function decodeParams<F extends ParamFields>(
  schema: ParamsSchema<F>,
  params: JsonObject,
): ParamsOf<ParamsSchema<F>> {
  const decoded = Object.create(null) as Record<string, unknown>;
  for (const [name, kind] of fieldsOf(schema)) {
    try {
      decoded[name] = kind.decode(requireValue(params, name));
    } catch (error) {
      throw new ParamDecodeError([name], error);
    }
  }
  return decoded as ParamsOf<ParamsSchema<F>>;
}

/**
 * Which parameter's `decode` threw. A kind's codec is developer code, and
 * whoever reports the failure needs to name the field rather than the whole
 * parameter object.
 *
 * @internal
 */
export class ParamDecodeError extends Error {
  constructor(
    readonly path: readonly string[],
    cause: unknown,
  ) {
    super(
      `Parameter "${path.join(".")}" could not be decoded: ${describeError(cause)}`,
      { cause },
    );
    this.name = "ParamDecodeError";
  }
}

/**
 * The asset handles an authored parameter object needs loaded, in field
 * declaration order. Call only on parameters that {@link validateParams}
 * accepted.
 */
export function paramAssets(
  schema: ParamsSchema<ParamFields>,
  params: JsonObject,
): readonly AssetHandle<unknown>[] {
  const handles: AssetHandle<unknown>[] = [];
  for (const [name, kind] of fieldsOf(schema)) {
    handles.push(...kind.assets(requireValue(params, name)));
  }
  return handles;
}

function fieldsOf(
  schema: ParamsSchema<ParamFields>,
): readonly (readonly [string, ParamKind<unknown>])[] {
  return Object.entries(schema._fields);
}

function requireValue(params: JsonObject, name: string): JsonValue {
  const value = ownValue(params, name);
  if (value === undefined) {
    throw new Error(
      `Parameter "${name}" is missing; validate before decoding.`,
    );
  }
  return value;
}

/** Own-property read: an inherited key such as `__proto__` reads as absent. */
function ownValue(params: JsonObject, name: string): JsonValue | undefined {
  return Object.hasOwn(params, name)
    ? (Reflect.get(params, name) as JsonValue)
    : undefined;
}

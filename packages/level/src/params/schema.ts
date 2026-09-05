import type { AssetHandle } from "@yagejs/core";
import type { JsonObject, JsonValue } from "../document/types.js";
import { describeError } from "../internal/describe.js";
import type {
  ParamDecodeContext,
  ParamError,
  ParamFieldDescription,
  ParamFields,
  ParamKind,
  ParamsOf,
  ParamsSchema,
  ParamValueDescription,
} from "./types.js";
import {
  MAX_PARAM_DEPTH,
  frameProblems,
  frozenFields,
  isBuiltInParamKind,
  paramNodes,
} from "./types.js";

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
  return Object.freeze({ _fields: frozenFields(fields) });
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
    const nodes = paramNodes(kind);
    const depth = Math.max(...nodes.map((node) => node.path.length));
    if (depth > MAX_PARAM_DEPTH) {
      errors.push({
        path: [name],
        message:
          `nests values ${String(depth)} levels deep, and the most a level ` +
          `can author is ${String(MAX_PARAM_DEPTH)}`,
      });
    }
    let builtIn = true;
    for (const node of nodes) {
      const path = [name, ...node.path];
      if (!isBuiltInParamKind(node.kind)) {
        errors.push({ path, message: "kind did not come from param.*" });
        builtIn = false;
        continue;
      }
      if (node.kind.frames !== undefined) {
        for (const message of frameProblems(node.kind.frames)) {
          errors.push({ path, message });
        }
      }
      // Everything that follows a reference — preparation's target check, the
      // links the editor draws, the ids a copy rewrites — reads one named
      // parameter of a placement. A reference deeper than that would load and
      // point at nothing, so the catalog reports the declaration instead.
      if (node.kind.name === "entityRef" && node.path.length > 0) {
        errors.push({
          path,
          message:
            "is a reference inside another value; a reference must be a " +
            "parameter of its own",
        });
      }
      // A dropdown with nothing in it offers the author no way to write a
      // value the codec would accept, so the declaration is the problem.
      if (
        node.kind.editor === "select" &&
        (node.kind.options ?? []).length === 0
      ) {
        errors.push({
          path,
          message: "is edited as a choice and lists no values to choose from",
        });
      }
    }
    // Last, and only over a field built entirely out of `param.*`: validating
    // a default calls each member kind's own `validate`, so a lookalike is
    // reported above rather than run.
    if (!builtIn) continue;
    // One call for the whole field: a value with members runs each member's
    // own kind over the matching part of the default and says which member
    // the problem is in.
    for (const problem of kind.validate(kind.defaultValue)) {
      errors.push({
        path: [name, ...problem.path],
        message: `default ${problem.message}`,
      });
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
  return Object.freeze(
    fieldsOf(schema).map(([name, kind]) => describeField(name, kind, [name])),
  );
}

/** One named value: what it is, and the word a tool labels it with. */
function describeField(
  name: string,
  kind: ParamKind<unknown>,
  path: readonly string[],
): ParamFieldDescription {
  return Object.freeze({ name, ...describeValue(kind, path) });
}

/**
 * One value, and everything inside it. The members below a value with a shape
 * are descriptions in turn, so the code that renders a top-level field renders
 * a member of an object and an element of an array as well.
 */
function describeValue(
  kind: ParamKind<unknown>,
  path: readonly string[],
): ParamValueDescription {
  if (!isBuiltInParamKind(kind)) {
    throw new TypeError(
      `Parameter "${path.join(".")}" kind did not come from param.*.`,
    );
  }
  return Object.freeze({
    kind: kind.name,
    ...(kind.assetKind === undefined ? {} : { assetKind: kind.assetKind }),
    ...(kind.frames === undefined ? {} : { frames: kind.frames }),
    ...(kind.types === undefined ? {} : { types: kind.types }),
    ...(kind.optional === undefined ? {} : { optional: kind.optional }),
    ...(kind.min === undefined ? {} : { min: kind.min }),
    ...(kind.max === undefined ? {} : { max: kind.max }),
    ...(kind.step === undefined ? {} : { step: kind.step }),
    ...(kind.multiline === undefined ? {} : { multiline: kind.multiline }),
    ...(kind.options === undefined ? {} : { options: kind.options }),
    ...(kind.editor === undefined ? {} : { editor: kind.editor }),
    ...(kind.relative === undefined ? {} : { relative: kind.relative }),
    ...(kind.fields === undefined
      ? {}
      : {
          fields: Object.freeze(
            Object.entries(kind.fields).map(([member, memberKind]) =>
              describeField(member, memberKind, [...path, member]),
            ),
          ),
        }),
    ...(kind.item === undefined
      ? {}
      : { item: describeValue(kind.item, [...path, "0"]) }),
    defaultValue: kind.defaultValue,
  });
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
 * A default that is not a primitive is copied, so two placements created from
 * one declaration never share one object and an edit to either leaves the
 * other alone.
 */
export function defaultParams(schema: ParamsSchema<ParamFields>): JsonObject {
  const params = Object.create(null) as Record<string, JsonValue>;
  for (const [name, kind] of fieldsOf(schema)) {
    params[name] = copiedDefault(kind.defaultValue);
  }
  return params as JsonObject;
}

/** A default that no two placements may share, and every other one as it is. */
function copiedDefault(value: JsonValue): JsonValue {
  return typeof value === "object" && value !== null
    ? (structuredClone(value) as JsonValue)
    : value;
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
    for (const problem of kind.validate(value)) {
      errors.push({ path: [name, ...problem.path], message: problem.message });
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
  context: ParamDecodeContext,
): ParamsOf<ParamsSchema<F>> {
  const decoded = Object.create(null) as Record<string, unknown>;
  for (const [name, kind] of fieldsOf(schema)) {
    try {
      decoded[name] = kind.decode(requireValue(params, name), context);
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

/** One reference parameter a schema declares. */
export interface ReferenceField {
  readonly name: string;
  /** The catalog type ids it accepts. */
  readonly types: readonly string[];
  readonly optional: boolean;
}

/**
 * @internal The schema's reference parameters, in declaration order. Read off
 * the kinds rather than off {@link describeParams}, so a schema carrying a
 * kind this package did not build is skipped instead of throwing.
 */
export function referenceFields(
  schema: ParamsSchema<ParamFields>,
): readonly ReferenceField[] {
  const fields: ReferenceField[] = [];
  for (const [name, kind] of fieldsOf(schema)) {
    if (!isBuiltInParamKind(kind) || kind.name !== "entityRef") continue;
    fields.push({
      name,
      types: kind.types ?? [],
      optional: kind.optional ?? false,
    });
  }
  return fields;
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

import { Vec2 } from "@yagejs/core";
import type { AssetHandle, Entity, EntityHandle, Vec2Like } from "@yagejs/core";
import type {
  JsonObject,
  JsonValue,
  LevelTransform,
} from "../document/types.js";
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
/**
 * The two overloads each kind carries say what `setup()` receives.
 *
 * No options, or an object whose `optional` is absent or literally `false`,
 * takes the first and gets `T`. Everything else takes the second and gets
 * `T | undefined`: a literal `{ optional: true }`, and equally options held in
 * a variable typed with an `optional?: boolean`, which decides nothing at
 * compile time. The second answer is wider than some calls need and never
 * narrower than what the call can hand over.
 */
function entityRefParam<T extends Entity = Entity>(
  options: EntityRefOptions & { readonly optional?: false },
): ParamKind<EntityHandle<T>>;
function entityRefParam<T extends Entity = Entity>(
  options: EntityRefOptions,
): ParamKind<EntityHandle<T> | undefined>;
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

/** What every plain kind accepts, whatever its value looks like. */
interface OptionalParamOptions {
  /**
   * Whether `null` is a value here. Defaults to `false`. A missing key is an
   * error either way: an absent value is written down, never implied.
   */
  readonly optional?: boolean;
}

/** What a number parameter accepts. */
export interface NumberParamOptions extends OptionalParamOptions {
  /** Smallest accepted value. */
  readonly min?: number;
  /** Largest accepted value. */
  readonly max?: number;
  /**
   * How far one press of an authoring control moves the value. Authoring
   * data: a typed value off the step is accepted.
   */
  readonly step?: number;
}

/** What a whole-number parameter accepts. */
export interface IntegerParamOptions extends OptionalParamOptions {
  /** Smallest accepted value. */
  readonly min?: number;
  /** Largest accepted value. */
  readonly max?: number;
}

/** What a boolean parameter accepts. */
export type BooleanParamOptions = OptionalParamOptions;

/** What a string parameter accepts. */
export interface StringParamOptions extends OptionalParamOptions {
  /** Whether the value spans several lines, so a tool offers room for them. */
  readonly multiline?: boolean;
}

/** What a choice parameter accepts beyond its list of values. */
export type SelectParamOptions = OptionalParamOptions;

/** What a pair-of-numbers parameter accepts. */
export type Vec2ParamOptions = OptionalParamOptions;

/**
 * Which frame a point parameter hands `setup()`.
 *
 * `"world"` is where the level put the placement; `"local"` is the placement's
 * own frame, where `{ x: 0, y: 0 }` is its origin whatever the level did with
 * it.
 */
export type PointSpace = "world" | "local";

/** What a place-in-the-level parameter accepts. */
export interface PointParamOptions extends OptionalParamOptions {
  /**
   * Whether the value is stored in the placement's own frame rather than the
   * world's. Defaults to `false`.
   *
   * A relative point travels with the placement that holds it: move the slime
   * in the editor and its patrol end moves too. A world one stays where it is.
   */
  readonly relative?: boolean;
  /**
   * Which frame `setup()` receives the value in. Defaults to `"world"`.
   *
   * Independent of {@link relative}, which says how the value is stored: the
   * level converts between the two through the placement's authored world
   * pose, so a relative point can arrive as a world position and a world one
   * as an offset from the placement.
   */
  readonly space?: PointSpace;
}

/**
 * A number, authored and decoded as itself.
 *
 * `min` and `max` are checked when the level is prepared, so a value outside
 * them is a finding on that placement rather than a clamp nobody asked for.
 * `step` is not: it sizes the presses of an authoring control, and a typed
 * value between two steps is legal.
 *
 * ```ts
 * const SlimeParams = defineParams({
 *   speed: param.number(40, { min: 5, max: 200 }),
 *   bounce: param.number(0.5, { step: 0.05, optional: true }),
 * });
 * ```
 */
function numberParam(
  defaultValue: number,
  options?: NumberParamOptions & { readonly optional?: false },
): ParamKind<number>;
function numberParam(
  defaultValue: number,
  options: NumberParamOptions,
): ParamKind<number | undefined>;
function numberParam(
  defaultValue: number,
  options: NumberParamOptions = {},
): ParamKind<number | undefined> {
  return createBuiltInParamKind({
    name: "number",
    optional: options.optional ?? false,
    ...(options.min === undefined ? {} : { min: options.min }),
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.step === undefined ? {} : { step: options.step }),
    defaultValue,
    validate: (value) => numberProblems(value, options, false),
    decode: decodeOptional<number>,
    assets: () => [],
  });
}

/**
 * A whole number, authored and decoded as itself.
 *
 * Its own kind rather than an option on {@link numberParam}, because `2.5` in
 * a level file is a mistake to report and not a number to round.
 *
 * ```ts
 * const ChestParams = defineParams({
 *   coins: param.integer(10, { min: 0 }),
 * });
 * ```
 */
function integerParam(
  defaultValue: number,
  options?: IntegerParamOptions & { readonly optional?: false },
): ParamKind<number>;
function integerParam(
  defaultValue: number,
  options: IntegerParamOptions,
): ParamKind<number | undefined>;
function integerParam(
  defaultValue: number,
  options: IntegerParamOptions = {},
): ParamKind<number | undefined> {
  return createBuiltInParamKind({
    name: "integer",
    optional: options.optional ?? false,
    ...(options.min === undefined ? {} : { min: options.min }),
    ...(options.max === undefined ? {} : { max: options.max }),
    defaultValue,
    validate: (value) => numberProblems(value, options, true),
    decode: decodeOptional<number>,
    assets: () => [],
  });
}

/**
 * A switch, authored and decoded as `true` or `false`.
 *
 * ```ts
 * const DoorParams = defineParams({
 *   locked: param.boolean(true),
 * });
 * ```
 */
function booleanParam(
  defaultValue: boolean,
  options?: BooleanParamOptions & { readonly optional?: false },
): ParamKind<boolean>;
function booleanParam(
  defaultValue: boolean,
  options: BooleanParamOptions,
): ParamKind<boolean | undefined>;
function booleanParam(
  defaultValue: boolean,
  options: BooleanParamOptions = {},
): ParamKind<boolean | undefined> {
  return createBuiltInParamKind({
    name: "boolean",
    optional: options.optional ?? false,
    defaultValue,
    validate: (value) => booleanProblems(value, options.optional ?? false),
    decode: decodeOptional<boolean>,
    assets: () => [],
  });
}

/**
 * Text, authored and decoded as itself. The empty string is a value; `null` is
 * what an optional field holds when it holds nothing.
 *
 * `multiline` says the text is expected to span several lines, so a tool
 * offers room for them. It changes nothing about what is stored or accepted.
 *
 * ```ts
 * const SignParams = defineParams({
 *   title: param.string("Welcome"),
 *   body: param.string("", { multiline: true }),
 * });
 * ```
 */
function stringParam(
  defaultValue: string,
  options?: StringParamOptions & { readonly optional?: false },
): ParamKind<string>;
function stringParam(
  defaultValue: string,
  options: StringParamOptions,
): ParamKind<string | undefined>;
function stringParam(
  defaultValue: string,
  options: StringParamOptions = {},
): ParamKind<string | undefined> {
  return createBuiltInParamKind({
    name: "string",
    optional: options.optional ?? false,
    ...(options.multiline === undefined
      ? {}
      : { multiline: options.multiline }),
    defaultValue,
    validate: (value) => stringProblems(value, options.optional ?? false),
    decode: decodeOptional<string>,
    assets: () => [],
  });
}

/**
 * One of a fixed list of strings, authored and decoded as itself.
 *
 * `setup()` receives the union of the listed values, so a `switch` over them
 * is exhaustive:
 *
 * ```ts
 * const SlimeParams = defineParams({
 *   facing: param.select("left", ["left", "right"]),
 * });
 *
 * setup(params: ParamsOf<typeof SlimeParams>): void {
 *   // params.facing is "left" | "right"
 * }
 * ```
 */
function selectParam<const O extends readonly string[]>(
  defaultValue: O[number],
  values: O,
  options?: SelectParamOptions & { readonly optional?: false },
): ParamKind<O[number]>;
function selectParam<const O extends readonly string[]>(
  defaultValue: O[number],
  values: O,
  options: SelectParamOptions,
): ParamKind<O[number] | undefined>;
function selectParam<const O extends readonly string[]>(
  defaultValue: O[number],
  values: O,
  options: SelectParamOptions = {},
): ParamKind<O[number] | undefined> {
  // Copied and frozen, because the caller keeps the array it passed and a
  // later mutation of it must not change what the schema accepts.
  const accepted = Object.freeze([...values]);
  return createBuiltInParamKind({
    name: "select",
    optional: options.optional ?? false,
    options: accepted,
    defaultValue,
    validate: (value) =>
      selectProblems(value, accepted, options.optional ?? false),
    decode: decodeOptional<O[number]>,
    assets: () => [],
  });
}

/**
 * A pair of numbers, authored as `{ x, y }` and decoded to a `Vec2`.
 *
 * For a value whose two numbers belong together and are not a place: a size, a
 * factor, a velocity. {@link pointParam} is the one that is a place.
 *
 * ```ts
 * const WindParams = defineParams({
 *   drift: param.vec2({ x: 12, y: 0 }),
 * });
 * ```
 */
function vec2Param(
  defaultValue: Vec2Like,
  options?: Vec2ParamOptions & { readonly optional?: false },
): ParamKind<Vec2>;
function vec2Param(
  defaultValue: Vec2Like,
  options: Vec2ParamOptions,
): ParamKind<Vec2 | undefined>;
function vec2Param(
  defaultValue: Vec2Like,
  options: Vec2ParamOptions = {},
): ParamKind<Vec2 | undefined> {
  return createBuiltInParamKind({
    name: "vec2",
    optional: options.optional ?? false,
    defaultValue: pointValue(defaultValue),
    validate: (value) => pointProblems(value, options.optional ?? false),
    decode: decodePoint,
    assets: () => [],
  });
}

/**
 * A place in the level, authored as `{ x, y }` and decoded to a `Vec2`.
 *
 * The same JSON as {@link vec2Param} and a different promise: this one names a
 * position, which is what lets an authoring tool put a handle on it and let
 * the author point at the ground instead of typing where the ground is.
 *
 * `relative: true` stores the value in the placement's own frame, so it
 * travels with the placement when the author moves it. `space` says which
 * frame `setup()` receives, and defaults to `"world"` — so a relative point
 * arrives as a world position, ready to walk towards.
 *
 * ```ts
 * const SlimeParams = defineParams({
 *   patrolEnd: param.point({ x: 120, y: 0 }, { relative: true }),
 *   muzzle: param.point({ x: 24, y: -6 }, { relative: true, space: "local" }),
 * });
 *
 * setup(params: ParamsOf<typeof SlimeParams>): void {
 *   this.add(new Transform());
 *   this.add(new Patrol(params.patrolEnd));
 *   this.add(new Gun(params.muzzle));
 * }
 * ```
 *
 * A `space: "local"` value is an offset from the placement, so turn it into a
 * world point where it is used — `Transform.localToWorld(point)` from a
 * component's `onEnable()` or an update, after the level has placed the
 * entity.
 */
function pointParam(
  defaultValue: Vec2Like,
  options?: PointParamOptions & { readonly optional?: false },
): ParamKind<Vec2>;
function pointParam(
  defaultValue: Vec2Like,
  options: PointParamOptions,
): ParamKind<Vec2 | undefined>;
function pointParam(
  defaultValue: Vec2Like,
  options: PointParamOptions = {},
): ParamKind<Vec2 | undefined> {
  const stored: PointSpace = (options.relative ?? false) ? "local" : "world";
  const wanted = options.space ?? "world";
  return createBuiltInParamKind({
    name: "point",
    optional: options.optional ?? false,
    relative: options.relative ?? false,
    defaultValue: pointValue(defaultValue),
    validate: (value) => pointProblems(value, options.optional ?? false),
    decode: (value, context) =>
      inSpace(decodePoint(value), stored, wanted, context.worldPose),
    assets: () => [],
  });
}

/**
 * An authored point moved from the frame it is stored in to the frame the
 * declaration asked for, through the placement's authored world pose. The
 * loader composes that pose with the same steps it places the entity by, so
 * the value and the entity agree.
 */
function inSpace(
  point: Vec2 | undefined,
  stored: PointSpace,
  wanted: PointSpace,
  pose: LevelTransform,
): Vec2 | undefined {
  if (point === undefined || stored === wanted) return point;
  return wanted === "world"
    ? poseToWorld(point, pose)
    : poseToLocal(point, pose);
}

/** A point in `pose`'s frame, expressed in the world's. */
function poseToWorld(point: Vec2, pose: LevelTransform): Vec2 {
  return point.multiply(pose.scale).rotate(pose.rotation).add(pose.position);
}

/**
 * A world point expressed in `pose`'s frame. An axis whose scale is 0 draws
 * every local value at the same world place, so no local value names one there
 * and the answer on that axis is 0 — the rule `Transform.worldToLocal` follows.
 */
function poseToLocal(point: Vec2, pose: LevelTransform): Vec2 {
  const turned = point.sub(pose.position).rotate(-pose.rotation);
  return new Vec2(
    pose.scale.x === 0 ? 0 : turned.x / pose.scale.x,
    pose.scale.y === 0 ? 0 : turned.y / pose.scale.y,
  );
}

/**
 * The JSON a declared default is stored as. Written member by member, so a
 * `Vec2` and a plain object produce the same two-key object, and frozen,
 * because `describeParams` hands the one object to every reader.
 */
function pointValue(value: Vec2Like): JsonObject {
  return Object.freeze({ x: value.x, y: value.y });
}

/** A validated pair as `setup()` receives it. */
function decodePoint(value: JsonValue): Vec2 | undefined {
  if (value === null) return undefined;
  const point = value as unknown as Vec2Like;
  return new Vec2(point.x, point.y);
}

/**
 * Problems with a pair: what it is, then each member, then anything else it
 * holds. The rule a level document already applies to a position, so a
 * parameter naming a place accepts exactly what a transform does.
 */
function pointProblems(value: JsonValue, optional: boolean): readonly string[] {
  const noun = "an object with finite x and y";
  if (value === null) return optional ? [] : [`must be ${noun}`];
  if (typeof value !== "object" || Array.isArray(value)) {
    return [optional ? `must be ${noun} or null` : `must be ${noun}`];
  }
  const problems: string[] = [];
  for (const axis of ["x", "y"] as const) {
    const held = Reflect.get(value, axis) as unknown;
    if (typeof held !== "number" || !Number.isFinite(held)) {
      problems.push(`must hold a finite ${axis}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (key !== "x" && key !== "y") {
      problems.push(`must not hold ${JSON.stringify(key)}`);
    }
  }
  return problems;
}

/**
 * What a plain kind's validated JSON is at runtime: itself, and `undefined`
 * where an optional field holds nothing — the same "no value" a reference
 * parameter decodes to.
 */
function decodeOptional<T>(value: JsonValue): T | undefined {
  return value === null ? undefined : (value as T);
}

/**
 * Problems with a number: what it is, then the range it was declared in.
 * `whole` is the integer kind's extra rule.
 */
function numberProblems(
  value: JsonValue,
  options: IntegerParamOptions,
  whole: boolean,
): readonly string[] {
  const optional = options.optional ?? false;
  const noun = whole ? "a whole number" : "a number";
  if (value === null) return optional ? [] : [`must be ${noun}`];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [optional ? `must be ${noun} or null` : `must be ${noun}`];
  }
  if (whole && !Number.isInteger(value)) return ["must be a whole number"];
  const problems: string[] = [];
  if (options.min !== undefined && value < options.min) {
    problems.push(`must be at least ${String(options.min)}`);
  }
  if (options.max !== undefined && value > options.max) {
    problems.push(`must be at most ${String(options.max)}`);
  }
  return problems;
}

function booleanProblems(
  value: JsonValue,
  optional: boolean,
): readonly string[] {
  if (typeof value === "boolean") return [];
  if (value === null && optional) return [];
  return [optional ? "must be true, false or null" : "must be true or false"];
}

function stringProblems(
  value: JsonValue,
  optional: boolean,
): readonly string[] {
  if (typeof value === "string") return [];
  if (value === null && optional) return [];
  return [optional ? "must be a string or null" : "must be a string"];
}

function selectProblems(
  value: JsonValue,
  values: readonly string[],
  optional: boolean,
): readonly string[] {
  if (typeof value === "string" && values.includes(value)) return [];
  if (value === null && optional) return [];
  const accepted = values.map((one) => JSON.stringify(one)).join(", ");
  return [
    optional
      ? `must be one of ${accepted}, or null`
      : `must be one of ${accepted}`,
  ];
}

/** The parameter kinds a level can author. */
export const param = Object.freeze({
  asset: assetParam,
  entityRef: entityRefParam,
  number: numberParam,
  integer: integerParam,
  boolean: booleanParam,
  string: stringParam,
  select: selectParam,
  vec2: vec2Param,
  point: pointParam,
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

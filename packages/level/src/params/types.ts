import type { AssetHandle, EntityHandle } from "@yagejs/core";
import type { JsonValue, LevelTransform } from "../document/types.js";

/**
 * How the file an asset parameter names is cut into frames. Authoring data:
 * the editor crops a thumbnail with it, and the type that declared it spreads
 * the same object into the frame source it builds in `setup()`, so the numbers
 * are written once.
 *
 * The members are the renderer's `TextureSliceOptions`, so one object literal
 * is both this hint and the grid half of a `SheetFrameSource`. Only
 * `frameWidth`, `frameHeight`, `startX` and `startY` change which pixels a
 * thumbnail shows; the rest are carried so the author has one object rather
 * than two overlapping ones.
 */
export interface AssetFrames {
  readonly frameWidth: number;
  readonly frameHeight?: number;
  readonly startX?: number;
  readonly startY?: number;
  readonly columns?: number;
  readonly count?: number;
  readonly gapX?: number;
  readonly gapY?: number;
}

/**
 * Which control a parameter needs. A closed set: an authoring tool switches on
 * it, and a new kind is meant to fail that switch to compile.
 *
 * A value with members carries a kind name of its own and describes its
 * members as descriptions in turn, so this stays the one discriminant at every
 * depth: an `object`'s member and an `array`'s element are switched on exactly
 * as a top-level field is.
 */
export type ParamKindName =
  | "asset"
  | "entityRef"
  | "number"
  | "integer"
  | "boolean"
  | "string"
  | "select"
  | "vec2"
  | "point"
  | "object"
  | "array"
  | "json"
  | "custom"
  | "color";

/**
 * Which control a `custom` value borrows: one of the plain kinds, named on the
 * description as {@link ParamValueDescription.editor}. A tool draws that kind's
 * control and hands what it produces to the codec.
 */
export type ParamEditorKind = Extract<
  ParamKindName,
  "number" | "integer" | "boolean" | "string" | "select" | "json"
>;

/**
 * What a parameter kind may need beyond its own JSON value while decoding.
 * Built by the loader for one placement, inside the spawn batch, and handed to
 * the codec a `param.custom` declaration supplies.
 */
export interface ParamDecodeContext {
  /**
   * The entity a placement id was reserved as, as a handle on its current
   * life. Throws for an id this level does not hold.
   *
   * A codec must not call this: an id it resolves is checked against no
   * declared types when the level is prepared, drawn as no link in an editor,
   * and rewritten in no copy of the placement. Declare a reference with
   * `param.entityRef` instead.
   */
  resolveEntityRef(placementId: string): EntityHandle;
  /**
   * Where the placement holding these parameters ends up in the world: the
   * instance transform composed with every parent above it, the same
   * composition the scene graph performs once the entity is placed. A `point`
   * converts its authored value through this when the frame it is stored in is
   * not the frame the declaration asked `setup()` for.
   */
  readonly worldPose: LevelTransform;
}

/**
 * One parameter's kind: the JSON it accepts, the runtime value that JSON
 * decodes to, and the assets the value needs loaded.
 *
 * Every kind comes from {@link param}. This is a type to name — the item kind
 * `param.array` takes, a helper that returns one — not one to implement: a
 * kind built any other way is a catalog error.
 */
export interface ParamKind<T> {
  /** Stable kind name, used in messages. */
  readonly name: ParamKindName;
  /**
   * The kind of asset this parameter names, from the descriptor
   * `param.asset()` was given — `"texture"`, `"sound"`, whatever a project
   * declared. Open, because {@link defineLevelAsset} is public. Absent for a
   * kind that names no asset.
   */
  readonly assetKind?: string;
  /** How the named file is cut into frames, when the declaration said. */
  readonly frames?: AssetFrames;
  /**
   * For a reference parameter, the placement types it may point at, as
   * catalog type ids. Absent for every other kind.
   */
  readonly types?: readonly string[];
  /**
   * Whether `null` is a value here. Every kind can say so: a reference holds
   * no target, a number or a name holds nothing at all. A missing key is still
   * an error, so an absent value is written rather than implied.
   */
  readonly optional?: boolean;
  /** Smallest accepted number, for `number` and `integer`. */
  readonly min?: number;
  /** Largest accepted number, for `number` and `integer`. */
  readonly max?: number;
  /**
   * How far one press of a control moves a `number`. Authoring data: a value
   * off the step is legal.
   */
  readonly step?: number;
  /** For a `string`, whether the value is expected to span several lines. */
  readonly multiline?: boolean;
  /** For a `select`, the values it accepts, in the order they are offered. */
  readonly options?: readonly string[];
  /**
   * For a `custom`, which plain kind's control edits the JSON. The members
   * that control needs sit in the slots above, as they do on the kind itself.
   */
  readonly editor?: ParamEditorKind;
  /**
   * For a `point`, whether the value is in the placement's own frame rather
   * than the world's.
   */
  readonly relative?: boolean;
  /** For an `object`, the kinds of its members, in declaration order. */
  readonly fields?: ParamFields;
  /** For an `array`, the kind every element is. */
  readonly item?: ParamKind<unknown>;
  /**
   * The value the editor writes into a new placement. Loading never fills it
   * in: a placement that omits the field fails validation, so changing this
   * cannot change what an existing level means.
   */
  readonly defaultValue: JsonValue;
  /**
   * Problems with an authored value. Each message completes the sentence
   * "`<path>` …", and each path is measured from the value being validated —
   * empty for the value itself, and a member name or an array index for a
   * value inside it. An empty list means {@link decode} and {@link assets} may
   * run on the value.
   */
  validate(value: JsonValue): readonly ParamError[];
  /** The runtime value passed to `setup()`. Call only on a validated value. */
  decode(value: JsonValue, context: ParamDecodeContext): T;
  /** Handles the decoded value needs loaded. Call only on a validated value. */
  assets(value: JsonValue): readonly AssetHandle<unknown>[];
}

/** The parameter kinds of one schema, by parameter name. */
export type ParamFields = Readonly<Record<string, ParamKind<unknown>>>;

/**
 * @internal The kinds copied into a frozen null-prototype object, so a
 * parameter named `__proto__` becomes an own key instead of replacing the
 * prototype, and a later mutation of what the caller passed changes nothing.
 */
export function frozenFields<F extends ParamFields>(fields: F): F {
  const copied = Object.create(null) as Record<string, ParamKind<unknown>>;
  for (const [name, kind] of Object.entries(fields)) copied[name] = kind;
  return Object.freeze(copied) as F;
}

/**
 * A placeable entity's parameter schema, built by {@link defineParams}. It is
 * runtime data and the source of the `setup()` parameter type; it carries no
 * operations of its own.
 */
export interface ParamsSchema<F extends ParamFields> {
  /** @internal The kinds, copied into a frozen null-prototype object. */
  readonly _fields: F;
}

/**
 * One value an authoring tool can render: a whole field, a member of an
 * `object`, or one element of an `array`.
 *
 * A description is a tree, and {@link ParamValueDescription.kind} is flat at
 * every node of it — the members below say what one value is, never what its
 * container is, so a tool switches on `kind` the same way wherever it stands.
 */
export type ParamValueDescription = {
  /** Which control the value needs. */
  readonly kind: ParamKindName;
  /**
   * For an asset field, the kind of asset it names — the `kind` of the
   * descriptor `param.asset()` was given. Open rather than closed, because a
   * game declares its own asset kinds through {@link defineLevelAsset}, so a
   * tool matches the kinds it knows and treats the rest as paths.
   */
  readonly assetKind?: string;
  /**
   * How the named file is cut into frames, when the declaration said.
   * Authoring data rather than a control discriminant: it says what one frame
   * of the default art is, so a tool can show that frame instead of the whole
   * sheet. Absent for a parameter that names a single picture.
   */
  readonly frames?: AssetFrames;
  /**
   * For a reference field, the placement types it accepts, as catalog type
   * ids. A picker offers the level's placements of those types.
   */
  readonly types?: readonly string[];
  /**
   * Whether the field may hold `null`. A control for an optional field needs a
   * way to empty it; a required one has none.
   */
  readonly optional?: boolean;
  /**
   * Smallest accepted number, for a `number` or `integer` field, and smallest
   * accepted number of elements for an `array`.
   */
  readonly min?: number;
  /**
   * Largest accepted number, for a `number` or `integer` field, and largest
   * accepted number of elements for an `array`.
   */
  readonly max?: number;
  /**
   * How far one press of a control moves a `number` field. A typed value off
   * the step is accepted, so this sizes the control's steps and validates
   * nothing.
   */
  readonly step?: number;
  /** For a `string` field, whether to offer several lines to type into. */
  readonly multiline?: boolean;
  /** For a `select` field, the values it accepts, in the order to offer them. */
  readonly options?: readonly string[];
  /**
   * For a `custom` field, which plain kind's control edits its JSON. Always
   * there on such a field, and `"json"` — the text of the value — where the
   * declaration named no control; it is optional here only because one flat
   * shape describes every kind. Whatever that control needs is in the slots
   * above — a `select` editor's `options`, a `number` editor's `min` — so a
   * tool draws the named kind exactly as it draws a field of it.
   */
  readonly editor?: ParamEditorKind;
  /**
   * For a `point` field, whether the value is in the placement's own frame.
   * A tool that draws the value in a viewport composes it through the
   * placement's transform when this is set, and reads it as a world point
   * when it is not.
   */
  readonly relative?: boolean;
  /**
   * For an `object` field, its members in declaration order. Each is a field
   * description of its own, so a member group renders through the same code
   * that renders the top-level fields.
   */
  readonly fields?: readonly ParamFieldDescription[];
  /**
   * For an `array` field, what one element is. Elements are named by their
   * position, so the element has a description and no name.
   */
  readonly item?: ParamValueDescription;
  /**
   * The value a new placement is written with. `null` for a reference field,
   * which starts with nothing chosen.
   */
  readonly defaultValue: JsonValue;
};

/** One schema field an authoring tool can render: a value with a name. */
export type ParamFieldDescription = ParamValueDescription & {
  readonly name: string;
};

/** The decoded parameter object a schema produces — a `setup()` signature. */
export type ParamsOf<S> =
  S extends ParamsSchema<infer F>
    ? { [K in keyof F]: RuntimeValueOf<F[K]> }
    : never;

/**
 * What one kind hands `setup()`: the runtime value its authored JSON decodes
 * to. `param.object` and `param.array` are typed in terms of it.
 */
export type RuntimeValueOf<K> = K extends ParamKind<infer T> ? T : never;

/** Where a parameter problem is, and what it is. */
export interface ParamError {
  /**
   * Key segments from the parameter object down to the value. A list rather
   * than a joined string, because an authored key may contain any character.
   */
  readonly path: readonly string[];
  readonly message: string;
}

type ParamKindDefinition<T> = {
  readonly name: ParamKindName;
  readonly assetKind?: string;
  readonly frames?: AssetFrames;
  readonly types?: readonly string[];
  readonly optional?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly multiline?: boolean;
  readonly options?: readonly string[];
  readonly editor?: ParamEditorKind;
  readonly relative?: boolean;
  readonly fields?: ParamFields;
  readonly item?: ParamKind<unknown>;
  readonly defaultValue: JsonValue;
  readonly validate: (value: JsonValue) => readonly ParamError[];
  readonly decode: (value: JsonValue, context: ParamDecodeContext) => T;
  readonly assets: (value: JsonValue) => readonly AssetHandle<unknown>[];
};

/**
 * Package-private construction proof for built-in kinds. A private field is
 * tied to the exact instances this class creates and cannot be copied by
 * object spread.
 */
class BuiltInParamKind<T> implements ParamKind<T> {
  readonly #brand = true;
  readonly name: ParamKindName;
  readonly assetKind?: string;
  readonly frames?: AssetFrames;
  readonly types?: readonly string[];
  readonly optional?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly multiline?: boolean;
  readonly options?: readonly string[];
  readonly editor?: ParamEditorKind;
  readonly relative?: boolean;
  readonly fields?: ParamFields;
  readonly item?: ParamKind<unknown>;
  readonly defaultValue: JsonValue;
  readonly validate: (value: JsonValue) => readonly ParamError[];
  readonly decode: (value: JsonValue, context: ParamDecodeContext) => T;
  readonly assets: (value: JsonValue) => readonly AssetHandle<unknown>[];

  constructor(definition: ParamKindDefinition<T>) {
    this.name = definition.name;
    if (definition.assetKind !== undefined) {
      this.assetKind = definition.assetKind;
    }
    if (definition.frames !== undefined) this.frames = definition.frames;
    if (definition.types !== undefined) this.types = definition.types;
    if (definition.optional !== undefined) this.optional = definition.optional;
    if (definition.min !== undefined) this.min = definition.min;
    if (definition.max !== undefined) this.max = definition.max;
    if (definition.step !== undefined) this.step = definition.step;
    if (definition.multiline !== undefined) {
      this.multiline = definition.multiline;
    }
    if (definition.options !== undefined) this.options = definition.options;
    if (definition.editor !== undefined) this.editor = definition.editor;
    if (definition.relative !== undefined) this.relative = definition.relative;
    if (definition.fields !== undefined) this.fields = definition.fields;
    if (definition.item !== undefined) this.item = definition.item;
    this.defaultValue = definition.defaultValue;
    this.validate = definition.validate;
    this.decode = definition.decode;
    this.assets = definition.assets;
  }

  static is(value: unknown): value is ParamKind<unknown> {
    return typeof value === "object" && value !== null && #brand in value;
  }
}

/** @internal Build a package-owned parameter kind. */
export function createBuiltInParamKind<T>(
  definition: ParamKindDefinition<T>,
): ParamKind<T> {
  return Object.freeze(new BuiltInParamKind(definition));
}

/** @internal Whether a value is a parameter kind built by this package. */
export function isBuiltInParamKind(
  value: unknown,
): value is ParamKind<unknown> {
  return BuiltInParamKind.is(value);
}

/**
 * @internal How deep a parameter may nest values that have members. Four is a
 * wave of spawns of drops and one level to spare; deeper than that is a form
 * nobody can read, so the catalog reports the declaration instead.
 */
export const MAX_PARAM_DEPTH = 4;

/** One value inside a kind, and the path from that kind down to it. */
export interface ParamNode {
  /**
   * Member names, and `"0"` for the element of an array — the path an authored
   * value of that shape is reached by. Empty for the kind itself.
   */
  readonly path: readonly string[];
  readonly kind: ParamKind<unknown>;
}

/**
 * @internal A kind and every value inside it, outermost first.
 *
 * An array contributes its element once, under `"0"`: one kind is what every
 * element is, whatever the level authored. A kind this package did not build
 * is listed and not descended into, since nothing here can trust what it
 * carries.
 */
export function paramNodes(kind: ParamKind<unknown>): readonly ParamNode[] {
  const nodes: ParamNode[] = [];
  const collect = (node: ParamKind<unknown>, path: readonly string[]): void => {
    nodes.push({ path, kind: node });
    if (!isBuiltInParamKind(node)) return;
    if (node.fields !== undefined) {
      for (const [name, member] of Object.entries(node.fields)) {
        collect(member, [...path, name]);
      }
    }
    if (node.item !== undefined) collect(node.item, [...path, "0"]);
  };
  collect(kind, []);
  return nodes;
}

/**
 * @internal Problems with a declared frame grid, each a whole sentence.
 *
 * The same bounds the renderer checks when it slices a sheet, applied where a
 * developer can act on them: a schema declaration is collected once when the
 * catalog is built, and a bad grid is listed there instead of throwing out of
 * the entity module's import.
 */
export function frameProblems(frames: AssetFrames): readonly string[] {
  const problems: string[] = [];
  const bounds = [
    ["frameWidth", frames.frameWidth, 1],
    ["frameHeight", frames.frameHeight, 1],
    ["columns", frames.columns, 1],
    ["count", frames.count, 1],
    ["startX", frames.startX, 0],
    ["startY", frames.startY, 0],
    ["gapX", frames.gapX, 0],
    ["gapY", frames.gapY, 0],
  ] as const;
  for (const [name, value, min] of bounds) {
    // An absent optional member takes the renderer's own default. Only
    // `frameWidth` is required, and it is checked whatever it holds.
    if (value === undefined && name !== "frameWidth") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
      problems.push(
        `frames.${name} must be a finite number of at least ${String(min)}`,
      );
    }
  }
  return problems;
}

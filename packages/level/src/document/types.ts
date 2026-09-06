/** A JSON scalar. */
export type JsonPrimitive = boolean | number | string | null;

/** Any value JSON can carry. */
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

/** A JSON object. Level parameters, metadata, and extensions are all one. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A position or a scale, in pixels and scalar factors. */
export interface LevelPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A placement's local transform. Rotation is radians, matching `Transform`;
 * the editor's inspector is what shows degrees.
 */
export interface LevelTransform {
  readonly position: LevelPoint;
  readonly rotation: number;
  readonly scale: LevelPoint;
}

/**
 * One authored entity in a level.
 *
 * The four identity fields do separate jobs: `id` is the immutable identity
 * that parent links and entity references use, `name` is a label that need not
 * be unique, `key` is the optional developer-facing identity that becomes the
 * runtime scene key, and `type` names the entity declaration.
 */
export interface LevelPlacement {
  readonly id: string;
  readonly type: string;
  /** The parameter schema version these `params` were authored against. */
  readonly typeVersion: number;
  readonly name?: string;
  readonly key?: string;
  /** The placement this one's transform is relative to, if any. */
  readonly parent?: string;
  /**
   * The render layer this placement's visuals join, overriding the layer the
   * entity type left at its default. A visual the type deliberately put
   * somewhere else keeps that layer.
   */
  readonly layer?: string;
  readonly active: boolean;
  readonly transform: LevelTransform;
  readonly params: JsonObject;
  readonly extensions: JsonObject;
}

/** An authored level: placements, and the JSON a game or a plugin hangs off them. */
export interface LevelDocument {
  /** The schema URL an author wrote, kept as authored. */
  readonly $schema?: string;
  readonly format: "yage-level";
  readonly version: 1;
  readonly id: string;
  /** Game-readable JSON for the level as a whole. */
  readonly metadata: JsonObject;
  readonly entities: readonly LevelPlacement[];
  /** Namespaced JSON an editor plugin owns, e.g. `"my-studio.nav"`. */
  readonly extensions: JsonObject;
}

/** Where a structural problem is, and what it is. */
export interface StructuralError {
  /** JSON path to the offending value, e.g. `entities[2].transform.scale.x`. */
  readonly path: string;
  readonly message: string;
}

/**
 * What {@link readLevel} returns. Structural invalidity is data, not a throw:
 * the editor keeps showing the document it already has, and lists these.
 */
export type StructuralResult =
  | { readonly ok: true; readonly document: LevelDocument }
  | { readonly ok: false; readonly errors: readonly StructuralError[] };

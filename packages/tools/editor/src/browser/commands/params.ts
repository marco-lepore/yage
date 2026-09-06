import {
  describeParams,
  type LevelCatalog,
  type ParamValueDescription,
} from "@yagejs/level";
import type {
  JsonObject,
  JsonValue,
  LevelDocument,
  LevelPlacement,
  LevelPoint,
} from "@yagejs/level/document";
import { MISSING_VALUE, valueAtPath } from "../../shared/commands/index.js";
import { authoredPoint, placementWorld, pointToWorld } from "./pose.js";

/**
 * The value at `path` inside an authored parameter object, or nothing when the
 * object does not hold every step of it.
 *
 * The reducer's own read, so a control shows exactly what an edit at that path
 * would be measured against. An authored value is never `undefined`, so it
 * stands for the missing path here.
 */
export function valueAt(
  params: JsonObject,
  path: readonly string[],
): JsonValue | undefined {
  const value = valueAtPath(params, path);
  return value === MISSING_VALUE ? undefined : value;
}

/**
 * The default one type's declaration gives the value at `path`, or nothing
 * when it describes no such value.
 *
 * Read off the description tree rather than off a new placement's parameter
 * object, because a list's own default is usually empty: the value a new row
 * needs is the one the declaration gives an element.
 */
export function defaultAt(
  catalog: LevelCatalog | undefined,
  typeId: string,
  path: readonly string[],
): JsonValue | undefined {
  const schema = catalog?.get(typeId)?.declaration.params;
  const [name, ...rest] = path;
  if (schema === undefined || name === undefined) return undefined;
  const field = describeParams(schema).find((one) => one.name === name);
  return field === undefined ? undefined : defaultInside(field, rest);
}

/** The default at a path under one described value. */
function defaultInside(
  description: ParamValueDescription,
  path: readonly string[],
): JsonValue | undefined {
  const [segment, ...rest] = path;
  if (segment === undefined) return description.defaultValue;
  // One kind is what every element of a list is, so a position leads to it
  // whichever position it names.
  if (description.item !== undefined)
    return defaultInside(description.item, rest);
  const member = description.fields?.find((one) => one.name === segment);
  return member === undefined ? undefined : defaultInside(member, rest);
}

/** One place-valued parameter a type declares. */
export interface PointField {
  readonly name: string;
  /** Whether the value is in the placement's own frame rather than the world's. */
  readonly relative: boolean;
}

/**
 * The place-valued parameters a type declares, or none.
 *
 * The catalog is the only thing that knows a parameter is a place — the
 * document stores a pair of numbers and nothing else — so every question about
 * point handles starts here, the way every question about references starts at
 * `referenceFieldNames`.
 */
export function pointFields(
  catalog: LevelCatalog | undefined,
  typeId: string,
): readonly PointField[] {
  const schema = catalog?.get(typeId)?.declaration.params;
  if (schema === undefined) return [];
  return describeParams(schema)
    .filter((field) => field.kind === "point")
    .map((field) => ({ name: field.name, relative: field.relative === true }));
}

/** Where one place-valued parameter's handle sits, and what it holds. */
export interface PointHandle {
  readonly field: string;
  readonly relative: boolean;
  /** The value as the document holds it, in the frame `relative` names. */
  readonly value: LevelPoint;
  /** Where the handle sits in world space. */
  readonly at: LevelPoint;
  /**
   * The placement's own world origin, which a relative value is measured from.
   * Absent for a world point, which is measured from nothing.
   */
  readonly from?: LevelPoint;
}

/**
 * Every point handle one placement offers, in declaration order.
 *
 * A field holding something other than a pair of finite numbers offers no
 * handle: an optional slot emptied, or a value authored against a declaration
 * that has since changed. The inspector reports that under the field, which is
 * where a broken value belongs.
 *
 * Both the drawing and the drag read this, so where a handle is drawn and what
 * a press on it moves cannot disagree.
 */
export function pointHandles(
  document: LevelDocument,
  placement: LevelPlacement,
  fields: readonly PointField[],
): readonly PointHandle[] {
  if (fields.length === 0) return [];
  const world = placementWorld(document, placement);
  const handles: PointHandle[] = [];
  for (const field of fields) {
    const value = authoredPoint(placement.params, field.name);
    if (!value) continue;
    handles.push(
      field.relative
        ? {
            field: field.name,
            relative: true,
            value,
            at: pointToWorld(value, world),
            from: world.position,
          }
        : { field: field.name, relative: false, value, at: value },
    );
  }
  return handles;
}

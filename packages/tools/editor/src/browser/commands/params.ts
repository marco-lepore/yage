import { describeParams, type LevelCatalog } from "@yagejs/level";
import type {
  LevelDocument,
  LevelPlacement,
  LevelPoint,
} from "@yagejs/level/document";
import { authoredPoint, placementWorld, pointToWorld } from "./pose.js";

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

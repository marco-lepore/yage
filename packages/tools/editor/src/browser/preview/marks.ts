import { worldGeometryOf, type FacetReader } from "./geometry.js";
import { Transform, type Entity } from "@yagejs/core";
import { VisualComponent } from "@yagejs/renderer";
import type { EditorPoint } from "../store/index.js";

/**
 * What a mark stands for.
 *
 * A drawing per family rather than per class: a light and an occluder are
 * different enough to tell apart at a glance, two kinds of light are not.
 * `other` is what a component the editor has no drawing for gets, and it is
 * the common case in a game whose own components the editor has never heard
 * of.
 */
export type MarkKind = "ui" | "particles" | "light" | "occluder" | "other";

/** One component the editor cannot draw: what it is, and what it looks like. */
export interface ComponentMark {
  /** The component's class name, which is what a hover names. */
  readonly type: string;
  readonly kind: MarkKind;
}

/** A mark placed in the world, ready to draw and to press. */
export interface PlacedMark extends ComponentMark {
  readonly at: EditorPoint;
}

/**
 * The side of one mark's drawing, in screen pixels.
 *
 * Screen pixels, like every other overlay size, so a row of marks is the same
 * size however far the view is zoomed — what it says is that something is
 * there, and a component has no size for it to be truthful about.
 */
export const MARK_PIXELS = 14;

/**
 * Centre to centre along the row, in screen pixels. It is also the side of the
 * square a press has to land in to hit a mark, so neighbouring marks divide
 * the row between them and leave no gap.
 */
export const MARK_SPACING_PIXELS = 18;

/** Preferred distance above the origin, before layout avoids obstacles. */
export const MARK_OFFSET_PIXELS = 18;

/**
 * Which class names the editor has a drawing for.
 *
 * By name rather than by class: the editor may not import `@yagejs/ui`,
 * `@yagejs/particles` or `@yagejs/lighting`. Names hold because the editor
 * runs the project through Vite's dev server, unminified. A game that
 * subclasses one of these inherits the drawing, since the lookup walks the
 * prototype chain.
 */
const KNOWN: Readonly<Record<string, MarkKind>> = {
  UISurface: "ui",
  UIRoot: "ui",
  ParticleEmitterComponent: "particles",
  LightSource: "light",
  LightOccluder: "occluder",
};

/** The drawing a class name gets. */
export function markKindOf(type: string): MarkKind {
  return KNOWN[type] ?? "other";
}

/** The drawing a component gets: its own class, or the nearest ancestor known. */
function kindOf(component: object): MarkKind {
  for (
    let proto = Object.getPrototypeOf(component) as object | null;
    proto !== null && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    const kind = KNOWN[proto.constructor.name];
    if (kind) return kind;
  }
  return "other";
}

/**
 * The components standing in for a placement the preview draws nothing for,
 * sorted by type string. Artwork or a collider with world extent already shows
 * where the placement is. A footprint collapsed to a point still needs marks.
 *
 * Sorted so a row never reshuffles between frames: the order components were
 * added in is an implementation detail of the entity's `setup()`, and a row
 * that reorders itself while a level is being edited reads as movement.
 *
 * `Transform` is left out because the editor already shows it everywhere — the
 * crosshair, the gizmo and the transform bar are all about it. Every other
 * component is marked, including a game's own: on a placement with nothing to
 * see, a component the editor has never heard of is still what is there.
 *
 * The label is the class name. The editor never runs a minified build of the
 * project, so the name is the one the developer wrote.
 */
export function marksOf(
  entity: Entity,
  inspector?: FacetReader,
): readonly ComponentMark[] {
  const geometry = worldGeometryOf(entity, inspector);
  if (
    geometry.outlines.some(({ vertices }) => {
      const first = vertices[0];
      return first && vertices.some((v) => v.x !== first.x || v.y !== first.y);
    })
  )
    return [];
  const marks: ComponentMark[] = [];
  for (const component of entity.getAll()) {
    if (component instanceof VisualComponent) continue;
    if (component instanceof Transform) continue;
    marks.push({ type: component.constructor.name, kind: kindOf(component) });
  }
  // Compared as plain strings rather than by a collator: the order only has to
  // be the same one every frame, on every machine.
  return marks.sort((left, right) =>
    left.type < right.type ? -1 : left.type > right.type ? 1 : 0,
  );
}

/**
 * Whether a world point presses a mark drawn at `at`.
 *
 * The target is the row's own spacing square rather than the drawing, so the
 * marks tile: a press between two of them belongs to the nearer one instead of
 * falling through to whatever is behind the row.
 */
export function pressesMark(
  at: EditorPoint,
  point: EditorPoint,
  perScreenPixel: number,
): boolean {
  const half = (MARK_SPACING_PIXELS / 2) * perScreenPixel;
  return Math.abs(point.x - at.x) <= half && Math.abs(point.y - at.y) <= half;
}

import type { WorldBounds } from "../commands/index.js";
import type { EditorPoint } from "../store/index.js";
import {
  MARK_OFFSET_PIXELS,
  MARK_SPACING_PIXELS,
  type ComponentMark,
  type PlacedMark,
} from "./marks.js";

export interface MarkGroup {
  readonly id: string;
  readonly origin: EditorPoint;
  readonly marks: readonly ComponentMark[];
}

export interface PlacedMarkGroup {
  readonly id: string;
  readonly origin: EditorPoint;
  readonly center: EditorPoint;
  readonly marks: readonly PlacedMark[];
}

const GAP = 4;
const MARGIN = 2;

/** View-only offsets, shared by drawing, hover and picking; discarded on rebuild. */
export class MarkLayout {
  private offsets = new Map<string, EditorPoint>();

  place(
    groups: readonly MarkGroup[],
    perScreenPixel: number,
    viewport: WorldBounds | undefined,
    controls: readonly WorldBounds[],
  ): readonly PlacedMarkGroup[] {
    const unit = perScreenPixel;
    const screen = (point: EditorPoint): EditorPoint => ({
      x: point.x / unit,
      y: point.y / unit,
    });
    const rect = (bounds: WorldBounds): WorldBounds => ({
      minX: bounds.minX / unit,
      minY: bounds.minY / unit,
      maxX: bounds.maxX / unit,
      maxY: bounds.maxY / unit,
    });
    const view = viewport && rect(viewport);
    const occupied = controls.map(rect);
    const offsets = new Map<string, EditorPoint>();
    const placed: PlacedMarkGroup[] = [];
    // Selection and document draw order must not reorder collision resolution.
    for (const group of [...groups].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )) {
      const origin = screen(group.origin);
      if (group.marks.length === 0 || (view && !inside(origin, view))) continue;
      const columns = Math.max(
        1,
        Math.min(
          group.marks.length,
          view
            ? Math.floor(
                (view.maxX - view.minX - MARGIN * 2) / MARK_SPACING_PIXELS,
              )
            : group.marks.length,
        ),
      );
      const rows = Math.ceil(group.marks.length / columns);
      const width = columns * MARK_SPACING_PIXELS;
      const height = rows * MARK_SPACING_PIXELS;
      const candidates = this.candidates(group.id, Math.max(width, height));
      let best = origin;
      let least = Infinity;
      for (const offset of candidates) {
        const center = {
          x: clamp(origin.x + offset.x, view?.minX, view?.maxX, width),
          y: clamp(origin.y + offset.y, view?.minY, view?.maxY, height),
        };
        const bounds = around(center, width + GAP, height + GAP);
        const overlap = occupied.reduce(
          (sum, other) => sum + overlapArea(bounds, other),
          0,
        );
        if (overlap < least) {
          best = center;
          least = overlap;
        }
        if (overlap === 0) break;
      }
      occupied.push(around(best, width + GAP, height + GAP));
      offsets.set(group.id, { x: best.x - origin.x, y: best.y - origin.y });
      placed.push({
        id: group.id,
        origin: group.origin,
        center: { x: best.x * unit, y: best.y * unit },
        marks: group.marks.map((mark, index) => ({
          ...mark,
          at: {
            x:
              (best.x -
                width / 2 +
                ((index % columns) + 0.5) * MARK_SPACING_PIXELS) *
              unit,
            y:
              (best.y -
                height / 2 +
                (Math.floor(index / columns) + 0.5) * MARK_SPACING_PIXELS) *
              unit,
          },
        })),
      });
    }
    this.offsets = offsets;
    const byId = new Map(placed.map((group) => [group.id, group]));
    return groups.flatMap((group) => {
      const found = byId.get(group.id);
      return found ? [found] : [];
    });
  }

  private *candidates(id: string, size: number): Generator<EditorPoint> {
    const previous = this.offsets.get(id);
    if (previous) yield previous;
    yield { x: 0, y: -MARK_OFFSET_PIXELS };
    // A bounded search keeps crowded levels responsive; if full, least overlap wins.
    for (let ring = 1; ring <= 24; ring += 1) {
      const reach = MARK_OFFSET_PIXELS + ring * (MARK_SPACING_PIXELS + GAP);
      for (const [x, y] of [
        [0, -1],
        [1, -1],
        [-1, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [-1, 1],
        [0, 1],
      ]) {
        yield { x: x! * Math.max(reach, size / 2 + GAP), y: y! * reach };
      }
    }
  }
}

function inside(point: EditorPoint, bounds: WorldBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function clamp(
  value: number,
  min: number | undefined,
  max: number | undefined,
  size: number,
): number {
  if (min === undefined || max === undefined) return value;
  if (max - min < size + MARGIN * 2) return (min + max) / 2;
  return Math.max(
    min + size / 2 + MARGIN,
    Math.min(max - size / 2 - MARGIN, value),
  );
}

function around(
  center: EditorPoint,
  width: number,
  height: number,
): WorldBounds {
  return {
    minX: center.x - width / 2,
    minY: center.y - height / 2,
    maxX: center.x + width / 2,
    maxY: center.y + height / 2,
  };
}

function overlapArea(a: WorldBounds, b: WorldBounds): number {
  return (
    Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) *
    Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
  );
}

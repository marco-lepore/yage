/**
 * The per-axis geometry solver behind {@link createInventoryPanel}. Each axis
 * (horizontal = columns/cell width, vertical = rows/cell height) has a COUNT
 * knob and an EXTENT knob; an explicit `bounds` adds a third constraint. This
 * resolves the pair without any grid-vs-list branching:
 *
 *  - No bounds — defaults fill whatever the caller left unset; the panel takes
 *    its intrinsic size from the resulting window.
 *  - Bounds + count — the extent is derived to fit (cells share the space).
 *  - Bounds + extent — the count is derived (as many cells as fit).
 *  - Bounds + neither — auto-fit: the cell's default extent, count derived. If
 *    even one default-extent cell doesn't fit, the extent shrinks to the bounds
 *    (so a wide default row still fills a narrow embedded box instead of
 *    clipping).
 *  - Bounds + both — OVERDETERMINED: the caller pinned the box AND the cells.
 *    The declared values win, the window centers in the bounds, and the panel
 *    warns (the view emits it at mount, where a diagnostics sink exists).
 *
 * Gap is never derived — it is a fixed authored value on both axes.
 */

import type { CellDefaults } from "../adapter.js";

/** One axis's inputs. `available` is the bounds content px on this axis, or
 *  undefined when the panel is not bounds-pinned. */
export interface AxisConstraints {
  readonly count: number | undefined;
  readonly extent: number | undefined;
  readonly gap: number;
  readonly defaultCount: number;
  readonly defaultExtent: number;
  readonly available: number | undefined;
}

export interface AxisSolution {
  readonly count: number;
  readonly extent: number;
  /** Count AND extent were both given alongside bounds — declared values won;
   *  the view centers the window and warns at mount. */
  readonly overdetermined: boolean;
}

export function solveAxis(c: AxisConstraints): AxisSolution {
  const { count, extent, gap, defaultCount, defaultExtent, available } = c;

  if (available === undefined) {
    return { count: count ?? defaultCount, extent: extent ?? defaultExtent, overdetermined: false };
  }

  if (count !== undefined && extent !== undefined) {
    return { count, extent, overdetermined: true };
  }

  if (count !== undefined) {
    const derived = Math.floor((available - (count - 1) * gap) / count);
    return { count, extent: Math.max(1, derived), overdetermined: false };
  }

  if (extent !== undefined) {
    return { count: fitCount(available, extent, gap), extent, overdetermined: false };
  }

  // Neither given: auto-fit the default extent, then shrink it if a single
  // default-extent cell already overflows the bounds.
  const fitted = fitCount(available, defaultExtent, gap);
  const shrunk = fitted === 1 && defaultExtent > available ? available : defaultExtent;
  return { count: fitted, extent: shrunk, overdetermined: false };
}

/** How many `extent`-sized cells (each followed by `gap`, last one gapless)
 *  fit in `available` px. Never below 1. */
function fitCount(available: number, extent: number, gap: number): number {
  return Math.max(1, Math.floor((available + gap) / (extent + gap)));
}

/** Normalize the `gap` option to per-axis values: a single number applies to
 *  both axes; `undefined` falls back to the cell preset's default gaps. */
export function normalizeGap(
  gap: number | { readonly x: number; readonly y: number } | undefined,
  defaults: CellDefaults,
): { x: number; y: number } {
  if (gap === undefined) return { x: defaults.gapX, y: defaults.gapY };
  if (typeof gap === "number") return { x: gap, y: gap };
  return { x: gap.x, y: gap.y };
}

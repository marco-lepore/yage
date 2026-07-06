import { describe, expect, it } from "vitest";
import { createInventoryPanel } from "./createInventoryPanel.js";
import { rowCell } from "../render/rowCell.js";
import { defaultInventoryTheme } from "./defaultTheme.js";
import type { InventoryTheme } from "./theme.js";
import type { InventoryPanelOptions } from "./createInventoryPanel.js";

/**
 * Collect every number/string leaf reachable from a value (own enumerable
 * properties, depth-first, cycle-safe). Functions/booleans/undefined are
 * skipped. Used to prove a fully-populated theme (and the geometry options)
 * reach the presenter configs (private class fields are plain enumerable
 * properties at runtime, so the walk sees view configs, the cell preset config,
 * and the shared PanelLayout config).
 */
function collectLeaves(
  value: unknown,
  into: Set<number | string> = new Set(),
  seen: Set<object> = new Set(),
): Set<number | string> {
  if (typeof value === "number" || typeof value === "string") {
    into.add(value);
    return into;
  }
  if (typeof value !== "object" || value === null) return into;
  if (seen.has(value)) return into;
  seen.add(value);
  for (const v of Object.values(value as Record<string, unknown>)) collectLeaves(v, into, seen);
  return into;
}

/** Mint distinct sentinel numbers (≥ 100000, step 1000) so no arithmetic combo
 *  of values (a sum is ≥ 200000; a difference is small/negative) can collide
 *  with a single sentinel — a transformed config value never looks like an
 *  un-wired field's sentinel. */
function makeMinter(start = 100000): () => number {
  let n = start;
  return () => (n += 1000);
}

/** A theme with every leaf set to a distinct sentinel. */
function sentinelTheme(): InventoryTheme {
  const n = makeMinter();
  return {
    padding: n(),
    frameColor: n(),
    frameAlpha: n(),
    borderColor: n(),
    cornerRadius: n(),
    titleSize: n(),
    titleColor: n(),
    cellColor: n(),
    cellBorderColor: n(),
    highlightColor: n(),
    textSize: n(),
    textColor: n(),
    quantitySize: n(),
    quantityColor: n(),
    descriptionColor: n(),
    descriptionSize: n(),
    actionColor: n(),
    actionSelectedColor: n(),
    actionHighlightColor: n(),
    menu: { padding: n(), rowGap: n() },
    detailHeight: n(),
    headerGap: n(),
    detailGap: n(),
    tileColors: [n(), n()],
    tileLetterColor: n(),
    bitmapFont: "sentinel-bitmapFont",
    fontFamily: "sentinel-fontFamily",
    resolution: n(),
    layerPanel: "sentinel-layerPanel",
    layerContent: "sentinel-layerContent",
    layerOverlay: "sentinel-layerOverlay",
  };
}

describe("theme exhaustiveness (drift-guard)", () => {
  it("every theme field reaches a presenter config across both cell presets", () => {
    const theme = sentinelTheme();
    const themeLeaves = collectLeaves(theme);

    // Both presets: iconCell carries cellColor/cellBorderColor/tileColors/
    // tileLetterColor; rowCell carries textColor. Chrome/detail/menu carry the
    // rest and exist in both bundles.
    const bundles = [createInventoryPanel(theme), createInventoryPanel(theme, { cell: rowCell })];
    const configLeaves = collectLeaves(bundles);

    const missing = [...themeLeaves].filter((leaf) => !configLeaves.has(leaf));
    // If this fails, a theme field was added without mapping it into a
    // presenter config — wire it in the factory/shared helpers (and match the
    // config field name to the theme field name).
    expect(missing).toEqual([]);
  });
});

describe("geometry-option exhaustiveness (drift-guard)", () => {
  it("every geometry option reaches the slots-view config", () => {
    // Cell geometry left the theme; this is the parallel guard for it. No
    // bounds, so the solver passes the values through untransformed.
    const g = makeMinter(500000);
    const geom: InventoryPanelOptions = {
      columns: g(),
      visibleRows: g(),
      cellWidth: g(),
      cellHeight: g(),
      gap: { x: g(), y: g() },
    };
    const geomLeaves = collectLeaves(geom);
    const configLeaves = collectLeaves(createInventoryPanel(defaultInventoryTheme(), geom));

    const missing = [...geomLeaves].filter((leaf) => !configLeaves.has(leaf));
    // If this fails, a geometry option was added without threading it into the
    // SlotsView config (or the solver dropped it).
    expect(missing).toEqual([]);
  });
});

describe("defaultInventoryTheme", () => {
  it("returns a fresh object each call (spread-and-tweak safe)", () => {
    const a = defaultInventoryTheme();
    const b = defaultInventoryTheme();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

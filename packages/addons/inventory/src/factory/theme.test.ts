import { describe, expect, it } from "vitest";
import { createInventoryPanel } from "./createInventoryPanel.js";
import { rowCell } from "../render/rowCell.js";
import { defaultInventoryTheme } from "./defaultTheme.js";
import type { InventoryBundle } from "../adapter.js";
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
    borderWidth: n(),
    titleSize: n(),
    titleColor: n(),
    cellColor: n(),
    cellBorderColor: n(),
    cellRadius: n(),
    highlightColor: n(),
    highlightRadius: n(),
    rowHighlightAlpha: n(),
    hintAlpha: n(),
    textSize: n(),
    textColor: n(),
    quantitySize: n(),
    quantityColor: n(),
    descriptionColor: n(),
    descriptionSize: n(),
    actionColor: n(),
    actionSelectedColor: n(),
    actionHighlightColor: n(),
    menu: { padding: n(), rowGap: n(), highlightAlpha: n() },
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

// Access private class config objects via runtime reflection. TypeScript's
// `private` is compile-time only — the fields are plain enumerable own properties.
function cfg(obj: unknown): Record<string, unknown> {
  return (obj as Record<string, unknown>)["cfg"] as Record<string, unknown>;
}

describe("optional-derived field defaults", () => {
  // Use cornerRadius: 22 → cellRadius derives to 11, highlightRadius to 10.
  // These values are unlikely to appear elsewhere in the config.
  const baseWith22 = { ...defaultInventoryTheme(), cornerRadius: 22 };

  it("cellRadius derives from cornerRadius / 2", () => {
    const bundle = createInventoryPanel(baseWith22);
    // iconCell (default) stores cellRadius in its cfg
    const slots = bundle.slots as unknown as Record<string, unknown>;
    expect(cfg(slots["cell"]).cellRadius).toBe(11);
  });

  it("highlightRadius derives from max(cellRadius − 1, 0) (menu bar)", () => {
    const bundle = createInventoryPanel(baseWith22);
    expect(cfg(bundle.actionMenu as InventoryBundle["actionMenu"]).highlightRadius).toBe(10);
  });

  it("highlightRadius derives from max(cellRadius − 1, 0) (row bar)", () => {
    const bundle = createInventoryPanel(baseWith22, { cell: rowCell });
    const slots = bundle.slots as unknown as Record<string, unknown>;
    expect(cfg(slots["cell"]).highlightRadius).toBe(10);
  });

  it("rowHighlightAlpha defaults to 0.22", () => {
    const bundle = createInventoryPanel(defaultInventoryTheme(), { cell: rowCell });
    const slots = bundle.slots as unknown as Record<string, unknown>;
    expect(cfg(slots["cell"]).rowHighlightAlpha).toBe(0.22);
  });

  it("menu.highlightAlpha defaults to 0.45", () => {
    const bundle = createInventoryPanel(defaultInventoryTheme());
    expect(cfg(bundle.actionMenu as InventoryBundle["actionMenu"]).highlightAlpha).toBe(0.45);
  });

  it("hintAlpha defaults to 0.6", () => {
    const bundle = createInventoryPanel(defaultInventoryTheme());
    expect(cfg(bundle.slots).hintAlpha).toBe(0.6);
  });

  it("borderWidth defaults to 1.5", () => {
    const bundle = createInventoryPanel(defaultInventoryTheme());
    expect(cfg(bundle.chrome as InventoryBundle["chrome"]).borderWidth).toBe(1.5);
  });
});

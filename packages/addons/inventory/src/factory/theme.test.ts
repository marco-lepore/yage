import { describe, expect, it } from "vitest";
import { createGridInventory } from "./createGridInventory.js";
import { createListInventory } from "./createListInventory.js";
import { defaultInventoryTheme } from "./defaultTheme.js";
import type { InventoryTheme } from "./theme.js";

/**
 * Collect every number/string leaf reachable from a value (own enumerable
 * properties, depth-first, cycle-safe). Functions/booleans/undefined are
 * skipped. Used to prove a fully-populated theme reaches the presenter
 * configs (private class fields are plain enumerable properties at runtime,
 * so the walk sees view configs and the shared PanelLayout config).
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
 *  of theme values (a sum is ≥ 200000; a difference is small/negative) can
 *  collide with a single sentinel — a transformed config value never looks
 *  like an un-wired field's sentinel. */
function makeMinter(): () => number {
  let n = 100000;
  return () => (n += 1000);
}

/** A theme with every leaf set to a distinct sentinel. */
function sentinelTheme(): InventoryTheme {
  const n = makeMinter();
  return {
    panel: { width: n(), height: n() },
    padding: n(),
    frameColor: n(),
    frameAlpha: n(),
    borderColor: n(),
    cornerRadius: n(),
    titleSize: n(),
    titleColor: n(),
    cellSize: n(),
    cellGap: n(),
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
    bitmapFont: "sentinel-bitmapFont",
    fontFamily: "sentinel-fontFamily",
    resolution: n(),
    layerPanel: "sentinel-layerPanel",
    layerContent: "sentinel-layerContent",
    layerOverlay: "sentinel-layerOverlay",
  };
}

describe("theme exhaustiveness (drift-guard)", () => {
  it("every theme field reaches a presenter config across both factories", () => {
    const theme = sentinelTheme();
    const themeLeaves = collectLeaves(theme);

    const bundles = [createGridInventory(theme), createListInventory(theme)];
    const configLeaves = collectLeaves(bundles);

    const missing = [...themeLeaves].filter((leaf) => !configLeaves.has(leaf));
    // If this fails, a theme field was added without mapping it into a
    // presenter config — wire it in a factory (and match the config field
    // name to the theme field name).
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

import { describe, expect, it } from "vitest";

import { resolveActiveFrame } from "./DialogueChrome.js";
import { CHROME_STYLE_DEFAULT, CHROME_STYLE_NONE } from "../factory/theme.js";

/**
 * The box chrome picks its per-line frame from `meta.chrome`. These cover the
 * resolution policy (the actual nine-slice rendering is exercised by the
 * dialogue-addon e2e); `styles` stands in for the configured textured map.
 */
describe("resolveActiveFrame (meta.chrome → frame)", () => {
  const withStyles = new Map<string, unknown>([
    [CHROME_STYLE_DEFAULT, {}],
    ["wood", {}],
  ]);
  const noStyles = new Map<string, unknown>();

  it("selects a named textured style", () => {
    expect(resolveActiveFrame("wood", withStyles)).toEqual({ kind: "nineSlice", key: "wood" });
  });

  it("falls back to the default textured style when the line names none", () => {
    expect(resolveActiveFrame(undefined, withStyles)).toEqual({
      kind: "nineSlice",
      key: CHROME_STYLE_DEFAULT,
    });
  });

  it("falls back to the default textured style for an unknown name", () => {
    expect(resolveActiveFrame("missing", withStyles)).toEqual({
      kind: "nineSlice",
      key: CHROME_STYLE_DEFAULT,
    });
  });

  it('hides the frame for the built-in "none" style, even with no textured map', () => {
    expect(resolveActiveFrame(CHROME_STYLE_NONE, withStyles)).toEqual({ kind: "none" });
    expect(resolveActiveFrame(CHROME_STYLE_NONE, noStyles)).toEqual({ kind: "none" });
  });

  it("draws the Graphics rect when there is no textured map", () => {
    expect(resolveActiveFrame(undefined, noStyles)).toEqual({ kind: "graphics" });
    // A named style with no map also falls through to Graphics (and warns).
    expect(resolveActiveFrame("wood", noStyles)).toEqual({ kind: "graphics" });
  });

  it("draws the Graphics rect when a map has no default and the line names none", () => {
    const onlyWood = new Map<string, unknown>([["wood", {}]]);
    expect(resolveActiveFrame(undefined, onlyWood)).toEqual({ kind: "graphics" });
    expect(resolveActiveFrame("wood", onlyWood)).toEqual({ kind: "nineSlice", key: "wood" });
  });
});

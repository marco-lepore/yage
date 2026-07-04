import { describe, expect, it } from "vitest";

import { createBoxDialogue } from "./createBoxDialogue.js";
import { createBubbleDialogue } from "./createBubbleDialogue.js";
import { createMixedDialogue } from "./createMixedDialogue.js";
import { defaultDialogueTheme } from "./defaultTheme.js";
import {
  boxFrameStyles,
  defaultBubbleFrame,
  CHROME_STYLE_DEFAULT,
  type ChromeStyle,
  type DialogueTheme,
} from "./theme.js";

/**
 * Collect every number/string leaf reachable from a value (own enumerable
 * properties, depth-first, cycle-safe). Functions/booleans/undefined are
 * skipped. Used to prove a fully-populated theme reaches the presenter configs.
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
 *  collide with a single sentinel — a transformed config value never looks like
 *  an un-wired field's sentinel. */
function makeMinter(): () => number {
  let n = 100000;
  return () => (n += 1000);
}

/** A theme with every leaf set to a distinct sentinel. */
function sentinelTheme(): DialogueTheme {
  const n = makeMinter();
  return {
    box: { marginX: n(), marginY: n(), height: n() },
    padding: n(),
    frameColor: n(),
    frameAlpha: n(),
    borderColor: n(),
    cornerRadius: n(),
    nameColor: n(),
    nameSize: n(),
    indicatorColor: n(),
    caret: { blink: n(), size: { width: n(), height: n() } },
    textSize: n(),
    lineHeight: n(),
    textColor: n(),
    charsPerSec: n(),
    choiceSize: n(),
    choiceColor: n(),
    choiceSelectedColor: n(),
    highlightColor: n(),
    choiceGap: n(),
    tailLean: { x: n(), y: n() },
    bitmapFont: "sentinel-bitmapFont",
    fontFamily: "sentinel-fontFamily",
    resolution: n(),
    layerFrame: "sentinel-layerFrame",
    layerText: "sentinel-layerText",
    skipMultiplier: n(),
    textured: {
      [CHROME_STYLE_DEFAULT]: {
        frame: {
          texture: "sentinel-defaultFrameTexture",
          insets: { left: n(), top: n(), right: n(), bottom: n() },
        },
        bubble: {
          texture: "sentinel-defaultBubbleTexture",
          insets: { left: n(), top: n(), right: n(), bottom: n() },
        },
      },
      alt: {
        frame: {
          texture: "sentinel-altFrameTexture",
          insets: { left: n(), top: n(), right: n(), bottom: n() },
        },
      },
    },
  };
}

describe("theme exhaustiveness (drift-guard)", () => {
  it("every theme field reaches a presenter config across all three factories", () => {
    const theme = sentinelTheme();
    const themeLeaves = collectLeaves(theme);

    const bundles = [
      createBoxDialogue(theme),
      createBubbleDialogue(theme, { worldLayer: "sentinel-worldLayer-bubble" }),
      createMixedDialogue(theme, { worldLayer: "sentinel-worldLayer-mixed" }),
    ];
    const configLeaves = collectLeaves(bundles);

    const missing = [...themeLeaves].filter((leaf) => !configLeaves.has(leaf));
    // If this fails, a theme field was added without mapping it into a presenter
    // config — wire it in the factory (and match the config field name to the
    // theme field name).
    expect(missing).toEqual([]);
  });
});

describe("textured chrome-style wiring", () => {
  const style = (name: string): ChromeStyle => ({
    frame: { texture: `${name}-frame`, insets: { left: 8, top: 8, right: 8, bottom: 8 } },
    ...(name === CHROME_STYLE_DEFAULT
      ? { bubble: { texture: "default-bubble", insets: { left: 6, top: 6, right: 6, bottom: 6 } } }
      : {}),
  });

  it("boxFrameStyles maps each named style to its box frame", () => {
    const textured = { [CHROME_STYLE_DEFAULT]: style(CHROME_STYLE_DEFAULT), wood: style("wood") };
    const styles = boxFrameStyles(textured);
    expect(styles?.[CHROME_STYLE_DEFAULT]?.texture).toBe("default-frame");
    expect(styles?.["wood"]?.texture).toBe("wood-frame");
    expect(boxFrameStyles(undefined)).toBeUndefined();
  });

  it("defaultBubbleFrame reads only the default style's bubble", () => {
    const textured = { [CHROME_STYLE_DEFAULT]: style(CHROME_STYLE_DEFAULT), wood: style("wood") };
    expect(defaultBubbleFrame(textured)?.texture).toBe("default-bubble");
    // A textured theme with no default bubble → Graphics bubble (undefined).
    expect(defaultBubbleFrame({ wood: style("wood") })).toBeUndefined();
    expect(defaultBubbleFrame(undefined)).toBeUndefined();
  });

  it("the default (zero-asset) theme wires no textured chrome", () => {
    const theme = defaultDialogueTheme();
    expect(theme.textured).toBeUndefined();
    expect(boxFrameStyles(theme.textured)).toBeUndefined();
    expect(defaultBubbleFrame(theme.textured)).toBeUndefined();
  });
});

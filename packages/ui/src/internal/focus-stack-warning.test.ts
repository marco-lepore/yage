import { describe, expect, it, vi } from "vitest";
import { describeTree, warnMissingFocusStack } from "./focus-stack-warning.js";

/**
 * The sentence `@yagejs/ui-react`'s `UIRoot` also prints, from its own copy of
 * the wording. Held here in full so a reworded warning fails on both sides
 * rather than leaving the two packages saying different things.
 */
const SENTENCE =
  "has no focus stack, so its focus scope reads no keyboard or gamepad " +
  "input. UIPlugin registers one per scene as the scene is entered.";

describe("describeTree", () => {
  it("names a labelled tree", () => {
    expect(describeTree("Hud")).toBe('the "Hud" UI tree');
  });

  it("falls back to an unnamed tree", () => {
    expect(describeTree(undefined)).toBe("this UI tree");
  });
});

describe("warnMissingFocusStack", () => {
  it("prints the host, the cause and the remedy", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnMissingFocusStack(`UIPanel in ${describeTree("Hud")}`);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(
      `UIPanel in the "Hud" UI tree ${SENTENCE}`,
    );
    warn.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import { describeTree, warnMissingFocusStack } from "./focus-stack-warning.js";

/** `@yagejs/ui-react`'s `UIRoot` prints its own copy of this sentence. */
const SENTENCE =
  "has no focus stack, so its focus scope reads no keyboard or gamepad " +
  "input. UIPlugin registers one per scene as the scene is entered.";

describe("describeTree", () => {
  it("names a labelled tree and falls back to an unnamed one", () => {
    expect(describeTree("Hud")).toBe('the "Hud" UI tree');
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

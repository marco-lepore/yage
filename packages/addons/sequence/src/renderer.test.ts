import { describe, expect, it } from "vitest";
import type { VisualComponent } from "@yagejs/renderer";
import { SEQUENCE_VISUAL_PROPERTIES } from "./core/properties.js";
import { SEQUENCE_VISUAL_ACCESSORS } from "./renderer.js";

describe("SEQUENCE_VISUAL_ACCESSORS", () => {
  it("has one frozen accessor per visual property", () => {
    expect(Object.keys(SEQUENCE_VISUAL_ACCESSORS)).toEqual(
      Object.keys(SEQUENCE_VISUAL_PROPERTIES),
    );
    for (const accessor of Object.values(SEQUENCE_VISUAL_ACCESSORS))
      expect(Object.isFrozen(accessor)).toBe(true);
  });

  it("holds opacity at 0..1 and writes visibility and tint", () => {
    // The accessors touch only these three fields of a visual component.
    const visual = {
      alpha: 0.5,
      visible: true,
      tint: 0xffffff,
    } as unknown as VisualComponent;
    SEQUENCE_VISUAL_ACCESSORS.opacity.set(visual, 1.4);
    expect(visual.alpha).toBe(1);
    SEQUENCE_VISUAL_ACCESSORS.opacity.set(visual, -0.2);
    expect(visual.alpha).toBe(0);
    SEQUENCE_VISUAL_ACCESSORS.visible.set(visual, false);
    SEQUENCE_VISUAL_ACCESSORS.tint.set(visual, 0x112233);
    expect([
      visual.visible,
      SEQUENCE_VISUAL_ACCESSORS.tint.get(visual),
    ]).toEqual([false, 0x112233]);
  });
});

import { describe, expect, it } from "vitest";
import { createMockEntity } from "@yagejs/core";
import { VisualModifierHost, type VisualComponent } from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import { feelPositionPunch, feelScalePunch } from "./visual.js";

function visualTarget(): VisualComponent {
  return { modifiers: new VisualModifierHost() } as unknown as VisualComponent;
}

describe("Feel visual modifiers", () => {
  it("keeps overlapping plays as separate contributions", () => {
    const { entity } = createMockEntity();
    const target = visualTarget();
    const feel = entity.add(
      new Feel({
        move: {
          overlap: "allow",
          effect: feelPositionPunch({
            target,
            offset: { x: 10, y: 0 },
            duration: 1,
            peakAt: 1,
          }),
        },
      }),
    );

    const first = feel.play("move");
    feel.play("move");
    feel.update(0.5);
    expect(target.modifiers.positionOffset.x).toBe(15);
    expect(target.modifiers.size).toBe(2);

    first?.stop();
    expect(target.modifiers.positionOffset.x).toBe(7.5);
    expect(target.modifiers.size).toBe(1);

    feel.update(0.5);
    expect(target.modifiers.positionOffset.x).toBe(0);
    expect(target.modifiers.size).toBe(0);
  });

  it("removes a zero-scale contribution cleanly", () => {
    const { entity } = createMockEntity();
    const target = visualTarget();
    const feel = entity.add(
      new Feel({
        squash: feelScalePunch({
          target,
          scale: 0,
          duration: 1,
          peakAt: 1,
        }),
      }),
    );

    const playback = feel.play("squash");
    feel.update(1);

    expect(playback?.active).toBe(false);
    expect(target.modifiers.scaleFactor.x).toBe(1);
    expect(target.modifiers.size).toBe(0);
  });
});

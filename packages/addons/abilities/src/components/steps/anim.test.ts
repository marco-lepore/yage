import { describe, expect, it } from "vitest";
import {
  createMockEntity,
  KeyframeAnimator,
  ProcessComponent,
} from "@yagejs/core";
import { Abilities } from "../../core/Abilities.js";
import { anim } from "./anim.js";

function setup() {
  const { entity } = createMockEntity("anim-host");
  const pc = entity.add(new ProcessComponent());
  return { entity, pc };
}

describe("anim step", () => {
  it("plays the named KeyframeAnimator animation when the step fires", () => {
    const { entity, pc } = setup();
    const animator = entity.add(
      new KeyframeAnimator({
        swing: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 1, data: 1 },
          ],
          setter: () => {},
        },
      }),
    );
    const abilities = entity.add(
      new Abilities([
        {
          id: "swing",
          duration: 0.3,
          timeline: [anim({ at: 0, name: "swing" })],
        },
      ]),
    );

    abilities.send("swing");
    expect(animator.isPlaying("swing")).toBe(false); // fires on tick, not on play()
    pc._tick(0.01);
    expect(animator.isPlaying("swing")).toBe(true);
  });

  it("throws a clear error naming the step and animation when there is no KeyframeAnimator", () => {
    const { entity, pc } = setup();
    const abilities = entity.add(
      new Abilities([
        {
          id: "swing",
          duration: 0.3,
          timeline: [anim({ at: 0, name: "swing" })],
        },
      ]),
    );

    abilities.send("swing");
    expect(() => pc._tick(0.01)).toThrow(/"anim".*"swing"/);
  });
});

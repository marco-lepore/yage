import { expect, it } from "vitest";
import { sampleKeyframes } from "./KeyframeTrack.js";
import { easeInQuad } from "./easing.js";
it("samples without advancing or dispatching key events", () => {
  let events = 0;
  const keys = [
    {
      time: 2,
      data: 10,
      event: () => {
        events++;
      },
      easing: easeInQuad,
    },
    { time: 4, data: 30 },
  ];
  expect(sampleKeyframes(keys, 3)).toBe(15);
  expect(sampleKeyframes(keys, 1)).toBe(10);
  expect(sampleKeyframes(keys, 5)).toBe(30);
  expect(events).toBe(0);
});
it("samples one constant key and rejects an empty track", () => {
  expect(sampleKeyframes([{ time: 0, data: 7 }], 12)).toBe(7);
  expect(() => sampleKeyframes([], 1)).toThrow("at least one");
});

import { expect, it } from "vitest";
import { AudioTimeline } from "./Automation.js";
it("preserves earlier ramps when a later ramp starts exactly at their endpoint", () => {
  const timeline = new AudioTimeline(1);
  timeline.set(0, 0, 1);
  timeline.set(1, 1, 1);
  expect(timeline.valueAt(0.5)).toBeCloseTo(0.5);
  expect(timeline.valueAt(1.5)).toBeCloseTo(0.5);
  expect(timeline.integral(0, 2)).toBeCloseTo(1);
});
it("preserves the arrival value and the jump at the same timestamp", () => {
  const timeline = new AudioTimeline(1);
  timeline.set(0, 0, 1);
  timeline.set(0.5, 1);
  timeline.set(1, 1, 1);
  expect(timeline.valueAt(0.5)).toBeCloseTo(0.5);
  expect(timeline.valueAt(1)).toBeCloseTo(0.5);
  expect(timeline.valueAt(1.5)).toBeCloseTo(0.75);
});
it("retains bounded history while preserving a future ramp", () => {
  const timeline = new AudioTimeline(1);
  for (let i = 0; i < 10000; i++) {
    timeline.set(i % 2, i);
    timeline.prune(i);
  }
  timeline.set(0, 10000, 2);
  expect(timeline.events(9999).length).toBeLessThanOrEqual(4);
  expect(timeline.valueAt(10001)).toBeCloseTo(0.5);
});

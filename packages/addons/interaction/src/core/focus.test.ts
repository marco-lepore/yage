import { describe, expect, it } from "vitest";
import { selectFocus } from "./focus.js";
import type { InteractCandidate } from "./types.js";

function candidate(overrides: Partial<InteractCandidate> = {}): InteractCandidate {
  return {
    position: { x: 0, y: 0 },
    radius: 0,
    priority: 0,
    order: 0,
    ...overrides,
  };
}

describe("selectFocus", () => {
  it("returns the nearest in-range candidate", () => {
    const near = candidate({ position: { x: 10, y: 0 }, order: 0 });
    const far = candidate({ position: { x: 30, y: 0 }, order: 1 });
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 50 }, [far, near]);
    expect(winner).toBe(near);
  });

  it("returns null when every candidate is out of range", () => {
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 10 }, [
      candidate({ position: { x: 50, y: 0 } }),
    ]);
    expect(winner).toBeNull();
  });

  it("returns null for empty candidates", () => {
    expect(selectFocus({ position: { x: 0, y: 0 }, range: 10 }, [])).toBeNull();
  });

  it("a higher priority candidate wins over a nearer lower-priority one", () => {
    const near = candidate({ position: { x: 5, y: 0 }, priority: 0, order: 0 });
    const farButPrioritized = candidate({ position: { x: 20, y: 0 }, priority: 10, order: 1 });
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 50 }, [near, farButPrioritized]);
    expect(winner).toBe(farButPrioritized);
  });

  it("a priority tie breaks by nearest distance", () => {
    const near = candidate({ position: { x: 5, y: 0 }, priority: 3, order: 0 });
    const far = candidate({ position: { x: 20, y: 0 }, priority: 3, order: 1 });
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 50 }, [far, near]);
    expect(winner).toBe(near);
  });

  it("a distance tie breaks by lower registration order", () => {
    const first = candidate({ position: { x: 10, y: 0 }, order: 0 });
    const second = candidate({ position: { x: 10, y: 0 }, order: 1 });
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 50 }, [second, first]);
    expect(winner).toBe(first);
  });

  it("disabled candidates are excluded by never being passed in", () => {
    // selectFocus itself has no notion of "enabled" — the caller filters
    // before calling. Confirms an empty-after-filter set still yields null.
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 50 }, []);
    expect(winner).toBeNull();
  });

  it("radius extends the in-range test", () => {
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 10 }, [
      candidate({ position: { x: 25, y: 0 }, radius: 20 }),
    ]);
    expect(winner).not.toBeNull();
  });

  it("radius bonus is per-candidate, not shared", () => {
    const noRadius = candidate({ position: { x: 15, y: 0 }, radius: 0, order: 0 });
    const winner = selectFocus({ position: { x: 0, y: 0 }, range: 10 }, [noRadius]);
    expect(winner).toBeNull();
  });
});

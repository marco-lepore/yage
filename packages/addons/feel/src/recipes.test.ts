import { describe, expect, it, vi } from "vitest";
import type { EffectsHost } from "@yagejs/renderer";
import type { ScheduledFeelEffect } from "./core/types.js";
import { voidCollapse } from "./recipes.js";

describe("Feel recipes", () => {
  it("voidCollapse is one parallel cue with two renderer effects", () => {
    const host = { addEffect: vi.fn() } as unknown as EffectsHost;
    const recipe = voidCollapse({ host, duration: 0.8, peakAt: 0.6 });
    const scheduled: ScheduledFeelEffect[] = [];
    recipe._schedule(0, scheduled);

    expect(recipe.duration).toBe(0.8);
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((entry) => entry.at)).toEqual([0, 0]);
  });
});

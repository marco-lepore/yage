import { describe, expect, it, vi } from "vitest";
import type { EffectsHost } from "@yagejs/renderer";
import type { VisualComponent } from "@yagejs/renderer";
import type { ScheduledFeelEffect } from "./core/types.js";
import {
  damageImpact,
  dashBurst,
  impact,
  spawnPop,
  voidCollapse,
} from "./recipes.js";

function scheduledEffects(recipe: {
  _schedule(at: number, output: ScheduledFeelEffect[]): void;
}): ScheduledFeelEffect[] {
  const scheduled: ScheduledFeelEffect[] = [];
  recipe._schedule(0, scheduled);
  return scheduled;
}

function visualTarget(): VisualComponent {
  return {
    fx: { addEffect: vi.fn() },
  } as unknown as VisualComponent;
}

describe("Feel recipes", () => {
  it("voidCollapse is one parallel cue with two renderer effects", () => {
    const host = { addEffect: vi.fn() } as unknown as EffectsHost;
    const recipe = voidCollapse({ host, duration: 0.8, peakAt: 0.6 });
    const scheduled = scheduledEffects(recipe);

    expect(recipe.duration).toBe(0.8);
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((entry) => entry.at)).toEqual([0, 0]);
  });

  it("impact combines four effects under one duration", () => {
    const recipe = impact({ target: visualTarget(), duration: 0.4 });

    expect(recipe.duration).toBe(0.4);
    expect(scheduledEffects(recipe)).toHaveLength(4);
  });

  it("damageImpact adds one damage number to the standard impact", () => {
    const recipe = damageImpact({
      target: visualTarget(),
      value: 42,
      impact: { duration: 0.25 },
      number: { duration: 0.75 },
    });

    expect(recipe.duration).toBe(0.75);
    expect(scheduledEffects(recipe)).toHaveLength(5);
  });

  it("dashBurst combines stretch, blur, and flight lines", () => {
    const recipe = dashBurst({
      target: visualTarget(),
      direction: { x: 1, y: 0 },
      duration: 0.35,
    });

    expect(recipe.duration).toBe(0.35);
    expect(scheduledEffects(recipe)).toHaveLength(3);
  });

  it("spawnPop combines two springs and one glow", () => {
    const recipe = spawnPop({ target: visualTarget(), duration: 0.5 });

    expect(recipe.duration).toBe(0.5);
    expect(scheduledEffects(recipe)).toHaveLength(3);
  });

  it("rejects directions that cannot select a dash axis", () => {
    expect(() =>
      dashBurst({
        target: visualTarget(),
        direction: { x: 0, y: 0 },
      }),
    ).toThrow(/direction/);
  });
});

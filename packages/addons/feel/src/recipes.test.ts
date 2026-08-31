import { describe, expect, it, vi } from "vitest";
import { createMockEntity } from "@yagejs/core";
import { VisualModifierHost, type EffectsHost } from "@yagejs/renderer";
import type { VisualComponent } from "@yagejs/renderer";
import { Feel } from "./Feel.js";
import type { ScheduledFeelEffect } from "./core/types.js";
import {
  damageImpact,
  dashBurst,
  enemyDeath,
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
  it("voidCollapse stages blur, implosion, and color under one duration", () => {
    const host = { addEffect: vi.fn() } as unknown as EffectsHost;
    const recipe = voidCollapse({
      host,
      duration: 0.8,
      peakAt: 0.6,
      implosionDelay: 0.05,
      holdDuration: 0.1,
    });
    const scheduled = scheduledEffects(recipe);

    expect(recipe.duration).toBe(0.8);
    expect(scheduled).toHaveLength(3);
    expect(scheduled.map((entry) => entry.at)).toEqual([0, 0.05, 0]);
  });

  it("voidCollapse can omit color and rejects timing that cannot fit", () => {
    const host = { addEffect: vi.fn() } as unknown as EffectsHost;

    expect(scheduledEffects(voidCollapse({ host, color: false }))).toHaveLength(
      2,
    );
    expect(() =>
      voidCollapse({ host, duration: 0.5, peakAt: 0.5, holdDuration: 0.3 }),
    ).toThrow(/holdDuration/);
    expect(() =>
      voidCollapse({ host, duration: 0.5, peakAt: 0.1, implosionDelay: 0.1 }),
    ).toThrow(/implosionDelay/);
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

  it("enemyDeath sequences impact, dissolve, and caller cleanup", () => {
    const recipe = enemyDeath({
      target: visualTarget(),
      impactDuration: 0.2,
      dissolveDuration: 0.5,
      onComplete: vi.fn(),
    });
    const scheduled = scheduledEffects(recipe);

    expect(recipe.duration).toBe(0.7);
    expect(scheduled).toHaveLength(7);
    expect(scheduled.slice(0, 4).map((entry) => entry.at)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(scheduled.slice(4, 6).map((entry) => entry.at)).toEqual([0.2, 0.2]);
    expect(scheduled[6]?.at).toBe(0.7);
  });

  it("enemyDeath can omit its transient ring", () => {
    const recipe = enemyDeath({
      target: visualTarget(),
      ring: false,
      onComplete: vi.fn(),
    });

    expect(scheduledEffects(recipe)).toHaveLength(6);
  });

  it("enemyDeath cleans its handles before calling the completion callback", () => {
    const { entity } = createMockEntity();
    const handles = [
      { trigger: vi.fn(), remove: vi.fn() },
      { setIntensity: vi.fn(), remove: vi.fn() },
      { setIntensity: vi.fn(), remove: vi.fn() },
    ];
    let nextHandle = 0;
    const target = {
      fx: { addEffect: vi.fn(() => handles[nextHandle++]) },
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;
    let cleanupState: { handles: number[]; modifiers: number } | undefined;
    const onComplete = vi.fn(() => {
      cleanupState = {
        handles: handles.map((handle) => handle.remove.mock.calls.length),
        modifiers: target.modifiers.size,
      };
    });
    const feel = entity.add(
      new Feel({
        death: enemyDeath({
          target,
          ring: false,
          impactDuration: 0.2,
          dissolveDuration: 0.5,
          onComplete,
        }),
      }),
    );

    feel.play("death");
    feel.update(0.2);
    feel.update(0.5);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(cleanupState).toEqual({ handles: [1, 1, 1], modifiers: 0 });
  });

  it("enemyDeath does not call completion when cancelled", () => {
    const { entity } = createMockEntity();
    const handles = [
      { trigger: vi.fn(), remove: vi.fn() },
      { setIntensity: vi.fn(), remove: vi.fn() },
      { setIntensity: vi.fn(), remove: vi.fn() },
    ];
    let nextHandle = 0;
    const target = {
      fx: { addEffect: vi.fn(() => handles[nextHandle++]) },
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;
    const onComplete = vi.fn();
    const feel = entity.add(
      new Feel({
        death: enemyDeath({ target, ring: false, onComplete }),
      }),
    );

    const playback = feel.play("death");
    playback?.stop();

    expect(onComplete).not.toHaveBeenCalled();
    expect(handles[0]?.remove).toHaveBeenCalledOnce();
    expect(target.modifiers.size).toBe(0);
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

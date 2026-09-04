import { describe, expect, it, vi } from "vitest";
import { createMockEntity } from "@yagejs/core";
import {
  GraphicsComponent,
  RenderLayerManager,
  SceneRenderTreeKey,
  VisualModifierHost,
  type EffectsHost,
  type SceneRenderTree,
} from "@yagejs/renderer";
import type { VisualComponent } from "@yagejs/renderer";
import { Feel } from "./Feel.js";
import {
  damageImpact,
  dashBurst,
  enemyDeath,
  impact,
  spawnPop,
  voidCollapse,
} from "./recipes.js";

function visualTarget(): VisualComponent {
  return {
    fx: { addEffect: vi.fn() },
  } as unknown as VisualComponent;
}

function createRenderedHost() {
  const setup = createMockEntity();
  const root = new GraphicsComponent();
  const layers = new RenderLayerManager(root.graphics);
  const tree: SceneRenderTree = {
    root: root.graphics,
    get: (name) => layers.get(name),
    tryGet: (name) => layers.tryGet(name),
    getAll: () => layers.getAll(),
    get defaultLayer() {
      return layers.defaultLayer;
    },
    ensureLayer: (def, options) =>
      layers.tryGet(def.name) ?? layers.createFromDef(def, options),
    fx: root.fx,
    setMask: () => {
      throw new Error("Masks are not used by this test.");
    },
    clearMask: () => {},
  };
  setup.scene._registerScoped(SceneRenderTreeKey, tree);
  return setup;
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
    expect(recipe.duration).toBe(0.8);
  });

  it("voidCollapse can omit color and rejects timing that cannot fit", () => {
    const host = { addEffect: vi.fn() } as unknown as EffectsHost;

    expect(voidCollapse({ host, color: false }).duration).toBeCloseTo(0.85);
    expect(() =>
      voidCollapse({ host, duration: 0.5, peakAt: 0.5, holdDuration: 0.3 }),
    ).toThrow(/holdDuration/);
    expect(() =>
      voidCollapse({ host, duration: 0.5, peakAt: 0.1, implosionDelay: 0.1 }),
    ).toThrow(/implosionDelay/);
  });

  it("impact uses its configured duration", () => {
    const recipe = impact({ target: visualTarget(), duration: 0.4 });

    expect(recipe.duration).toBe(0.4);
  });

  it("damageImpact lasts for its longest parallel child", () => {
    const recipe = damageImpact({
      target: visualTarget(),
      value: 42,
      impact: { duration: 0.25 },
      number: { duration: 0.75 },
    });

    expect(recipe.duration).toBe(0.75);
  });

  it("dashBurst uses its configured duration", () => {
    const recipe = dashBurst({
      target: visualTarget(),
      direction: { x: 1, y: 0 },
      duration: 0.35,
    });

    expect(recipe.duration).toBe(0.35);
  });

  it("forwards one pulse curve to both dash pulses and keeps line timing", () => {
    const { entity, scene } = createRenderedHost();
    const blurHandle = { setIntensity: vi.fn(), remove: vi.fn() };
    const target = {
      fx: { addEffect: vi.fn(() => blurHandle) },
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;
    const attackEasing = vi.fn((progress: number) => progress);
    const releaseEasing = vi.fn((progress: number) => progress);
    const dash = dashBurst({
      target,
      direction: { x: 1, y: 0 },
      position: { x: 0, y: 0 },
      duration: 0.5,
      peakAt: 0.5,
      attackEasing,
      releaseEasing,
    });
    const feel = entity.add(new Feel({ dash }));

    const playback = feel.play("dash");
    attackEasing.mockClear();
    feel.update(0.125);
    expect(attackEasing.mock.calls).toEqual([[0.5], [0.5]]);
    expect(blurHandle.setIntensity).toHaveBeenLastCalledWith(0.5);

    feel.update(0.25);
    expect(releaseEasing.mock.calls).toEqual([[0.5], [0.5]]);
    expect(scene.findEntity("feel:flight-lines")).toBeDefined();

    feel.update(0.124);
    expect(playback?.active).toBe(true);
    feel.update(0.001);
    expect(playback?.active).toBe(false);
    expect(scene.findEntity("feel:flight-lines")).toBeUndefined();
  });

  it("spawnPop uses its configured duration", () => {
    const recipe = spawnPop({ target: visualTarget(), duration: 0.5 });

    expect(recipe.duration).toBe(0.5);
  });

  it("enemyDeath sums its sequential phase durations", () => {
    const recipe = enemyDeath({
      target: visualTarget(),
      impactDuration: 0.2,
      dissolveDuration: 0.5,
      onComplete: vi.fn(),
    });
    expect(recipe.duration).toBe(0.7);
  });

  it("enemyDeath can omit its transient ring", () => {
    const recipe = enemyDeath({
      target: visualTarget(),
      ring: false,
      onComplete: vi.fn(),
    });

    expect(recipe.duration).toBe(0.82);
  });

  it("enemyDeath cleans its handles before calling the completion callback", () => {
    const { entity } = createMockEntity();
    const handles = [
      { setIntensity: vi.fn(), trigger: vi.fn(), remove: vi.fn() },
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
      { setIntensity: vi.fn(), trigger: vi.fn(), remove: vi.fn() },
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
    expect(() =>
      dashBurst({
        target: visualTarget(),
        direction: { x: 1, y: 0 },
        duration: 0,
      }),
    ).toThrow("dashBurst: duration must be a finite number > 0, got 0.");
    expect(() =>
      dashBurst({
        target: visualTarget(),
        direction: { x: 1, y: 0 },
        peakAt: Number.NaN,
      }),
    ).toThrow(
      "dashBurst: peakAt must be a finite number between 0 and 1, got NaN.",
    );
  });
});

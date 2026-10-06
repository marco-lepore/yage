import { describe, expect, it, vi } from "vitest";
import {
  ComponentFixedUpdateSystem,
  ComponentUpdateSystem,
  ErrorBoundaryKey,
  SceneManagerKey,
  createMockScene,
} from "@yagejs/core";
import type { SceneManager, ProcessClock } from "@yagejs/core";
import { Stats } from "./core/Stats.js";
import { StatsComponent, StatsChangedEvent } from "./StatsComponent.js";

function setup(clock: ProcessClock = "fixed") {
  const { scene, context } = createMockScene();
  context.register(SceneManagerKey, {
    activeScenes: [scene],
  } as unknown as SceneManager);
  const fixed = new ComponentFixedUpdateSystem();
  fixed.onRegister(context);
  const frame = new ComponentUpdateSystem();
  frame.onRegister(context);
  const entity = scene.spawn("actor");
  const model = new Stats({ speed: { base: 100 } });
  const component = entity.add(new StatsComponent({ model, clock }));
  const effect = model.addEffect({
    modifiers: [{ stat: "speed", operation: "multiply", value: 2 }],
    duration: 2,
  })!;
  return { scene, context, entity, model, component, effect, fixed, frame };
}

describe("StatsComponent", () => {
  it("defaults to fixed time and does not double-advance on rendered frames", () => {
    const { fixed, frame, effect } = setup();
    frame.update(1);
    expect(effect.remaining).toBe(2);
    fixed.update(1);
    expect(effect.remaining).toBe(1);
  });

  it("supports the frame clock explicitly", () => {
    const { fixed, frame, effect } = setup("frame");
    fixed.update(1);
    expect(effect.remaining).toBe(2);
    frame.update(1);
    expect(effect.remaining).toBe(1);
  });

  it("uses scene and entity scales and pauses when disabled or frozen", () => {
    const { scene, entity, component, fixed, effect } = setup();
    scene.timeScale = 0.5;
    entity.timeScale = 0.5;
    fixed.update(1);
    expect(effect.remaining).toBe(1.75);
    entity.timeScale = 0;
    fixed.update(10);
    expect(effect.remaining).toBe(1.75);
    entity.timeScale = 1;
    component.enabled = false;
    fixed.update(10);
    expect(effect.remaining).toBe(1.75);
    component.enabled = true;
    fixed.update(1);
    expect(effect.remaining).toBe(1.25);
  });

  it("forwards changes while enabled and restores the model's boundary on removal", () => {
    const { entity, component, model, context } = setup();
    const changed = vi.fn();
    entity.on(StatsChangedEvent, changed);
    expect(model.errorBoundary).toBe(context.resolve(ErrorBoundaryKey));
    model.setBase("speed", 200);
    expect(changed).toHaveBeenCalledTimes(1);
    component.enabled = false;
    model.setBase("speed", 300);
    expect(changed).toHaveBeenCalledTimes(1);
    component.enabled = true;
    model.setBase("speed", 400);
    expect(changed).toHaveBeenCalledTimes(2);
    entity.remove(StatsComponent);
    model.setBase("speed", 500);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(model.errorBoundary).not.toBe(context.resolve(ErrorBoundaryKey));
  });

  it.each(["disable", "remove", "deactivate"] as const)(
    "does not forward a pending notification after %s",
    (action) => {
      const { scene } = createMockScene();
      const entity = scene.spawn("actor");
      const model = new Stats({ speed: { base: 100 } });
      const component = new StatsComponent({ model });
      model.onChange(() => {
        if (action === "disable") component.enabled = false;
        else if (action === "remove") entity.remove(StatsComponent);
        else entity.setActive(false);
      });
      entity.add(component);
      const changed = vi.fn(() => entity.get(StatsComponent).model.values());
      entity.on(StatsChangedEvent, changed);
      expect(() => model.setBase("speed", 200)).not.toThrow();
      expect(changed).not.toHaveBeenCalled();
      expect(model.get("speed")).toBe(200);
    },
  );

  it("attributes derived formula failures to the engine boundary", () => {
    const { scene, context } = createMockScene();
    const model = new Stats({
      broken: {
        derived: {
          dependencies: [],
          evaluate: () => {
            throw new Error("invalid formula");
          },
        },
      },
    });
    scene.spawn("actor").add(new StatsComponent({ model }));
    expect(() => model.get("broken")).toThrow("invalid formula");
    expect(context.resolve(ErrorBoundaryKey).getCallbackErrors()).toMatchObject(
      [{ kind: "Stats formula", event: "base:broken" }],
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { Vec2 } from "@yagejs/core";
import { VisualModifierHost } from "./VisualModifiers.js";

describe("VisualModifierHost", () => {
  it("combines contributions and removes each one without arithmetic reversal", () => {
    const host = new VisualModifierHost();
    const first = host.addTransform({
      position: { x: 4, y: 2 },
      rotation: 0.25,
      scale: { x: 2, y: 0 },
    });
    const second = host.addTransform({
      position: { x: -1, y: 3 },
      rotation: 0.5,
      scale: { x: 3, y: 4 },
    });

    expect(host.positionOffset).toEqual(new Vec2(3, 5));
    expect(host.rotationOffset).toBe(0.75);
    expect(host.scaleFactor).toEqual(new Vec2(6, 0));

    first.remove();
    expect(first.active).toBe(false);
    expect(host.positionOffset).toEqual(new Vec2(-1, 3));
    expect(host.rotationOffset).toBe(0.5);
    expect(host.scaleFactor).toEqual(new Vec2(3, 4));

    first.remove();
    second.remove();
    expect(host.positionOffset).toEqual(Vec2.ZERO);
    expect(host.rotationOffset).toBe(0);
    expect(host.scaleFactor).toEqual(Vec2.ONE);
    expect(host.size).toBe(0);
  });

  it("multiplies opacity and requires every visibility condition", () => {
    const changed = vi.fn();
    const host = new VisualModifierHost(changed);
    const dim = host.addOpacity(0.5);
    const flash = host.addOpacity(0.4);
    const hidden = host.addVisibility(false);
    const shown = host.addVisibility(true);

    expect(host.opacityFactor).toBeCloseTo(0.2);
    expect(host.visible).toBe(false);

    hidden.remove();
    dim.remove();
    expect(host.opacityFactor).toBe(0.4);
    expect(host.visible).toBe(true);
    expect(changed).toHaveBeenCalled();

    flash.remove();
    shown.remove();
  });

  it("invalidates outstanding handles when destroyed", () => {
    const host = new VisualModifierHost();
    const transform = host.addTransform();
    const opacity = host.addOpacity();
    const visibility = host.addVisibility();

    host._destroy();

    expect(transform.active).toBe(false);
    expect(opacity.active).toBe(false);
    expect(visibility.active).toBe(false);
    expect(host.size).toBe(0);
    expect(() => host.addTransform()).toThrow(/destroyed/);
  });
});

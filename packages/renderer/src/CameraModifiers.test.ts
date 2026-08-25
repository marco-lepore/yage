import { describe, expect, it } from "vitest";
import { Vec2 } from "@yagejs/core";
import { CameraModifierHost } from "./CameraModifiers.js";

describe("CameraModifierHost", () => {
  it("combines and independently removes camera contributions", () => {
    const host = new CameraModifierHost();
    const first = host.add({
      position: { x: 4, y: 2 },
      rotation: 0.25,
      zoom: 2,
    });
    const second = host.add({
      position: { x: -1, y: 3 },
      rotation: 0.5,
      zoom: 1.5,
    });

    expect(host.positionOffset).toEqual(new Vec2(3, 5));
    expect(host.rotationOffset).toBe(0.75);
    expect(host.zoomFactor).toBe(3);

    first.remove();
    expect(first.active).toBe(false);
    expect(host.positionOffset).toEqual(new Vec2(-1, 3));
    expect(host.rotationOffset).toBe(0.5);
    expect(host.zoomFactor).toBe(1.5);

    second.remove();
    expect(host.positionOffset).toEqual(Vec2.ZERO);
    expect(host.rotationOffset).toBe(0);
    expect(host.zoomFactor).toBe(1);
  });

  it("rejects zoom factors that cannot produce a usable camera", () => {
    const host = new CameraModifierHost();
    expect(() => host.add({ zoom: 0 })).toThrow(/greater than 0/);
    expect(() => host.add({ zoom: Number.NaN })).toThrow(/finite/);
  });

  it("invalidates outstanding handles when destroyed", () => {
    const host = new CameraModifierHost();
    const modifier = host.add();

    host._destroy();

    expect(modifier.active).toBe(false);
    expect(host.size).toBe(0);
    expect(() => host.add()).toThrow(/destroyed/);
  });
});

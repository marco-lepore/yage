import { describe, expect, it } from "vitest";
import { LightSource } from "./LightSource.js";

describe("LightSource", () => {
  it("uses documented defaults", () => {
    const light = new LightSource({ radius: 80 });

    expect(light.radius).toBe(80);
    expect(light.intensity).toBe(1);
    expect(light.color).toBe(0xffffff);
    expect(light.size).toBe(0);
    expect(light.coneAngle).toBe(Math.PI * 2);
    expect(light.enabled).toBe(true);
  });

  it("rejects a lamp size or a cone the light cannot hold", () => {
    expect(() => new LightSource({ radius: 80, size: -1 })).toThrow(RangeError);
    expect(() => new LightSource({ radius: 80, cone: { angle: 0 } })).toThrow(
      RangeError,
    );
    expect(
      () => new LightSource({ radius: 80, cone: { angle: Math.PI * 2.5 } }),
    ).toThrow(RangeError);

    const light = new LightSource({
      radius: 80,
      size: 12,
      cone: { angle: Math.PI / 3 },
    });
    expect(light.size).toBe(12);
    expect(light.coneAngle).toBeCloseTo(Math.PI / 3);
  });

  it("rejects invalid live values without changing current state", () => {
    const light = new LightSource({
      radius: 80,
      intensity: 0.5,
      color: 0x123456,
      size: 20,
      cone: { angle: Math.PI },
    });

    expect(() => {
      light.radius = 0;
    }).toThrow(RangeError);
    expect(() => {
      light.intensity = Number.NaN;
    }).toThrow(RangeError);
    expect(() => {
      light.color = 0x1000000;
    }).toThrow(RangeError);
    expect(() => {
      light.size = -1;
    }).toThrow(RangeError);
    expect(() => {
      light.coneAngle = Number.POSITIVE_INFINITY;
    }).toThrow(RangeError);

    expect(light.radius).toBe(80);
    expect(light.intensity).toBe(0.5);
    expect(light.color).toBe(0x123456);
    expect(light.size).toBe(20);
    expect(light.coneAngle).toBe(Math.PI);
    expect(light.enabled).toBe(true);
  });
});

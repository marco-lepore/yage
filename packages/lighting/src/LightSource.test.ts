import { describe, expect, it } from "vitest";
import { LightSource } from "./LightSource.js";

describe("LightSource", () => {
  it("uses documented defaults", () => {
    const light = new LightSource({ radius: 80 });

    expect(light.radius).toBe(80);
    expect(light.intensity).toBe(1);
    expect(light.color).toBe(0xffffff);
    expect(light.enabled).toBe(true);
  });

  it("rejects invalid live values without changing current state", () => {
    const light = new LightSource({
      radius: 80,
      intensity: 0.5,
      color: 0x123456,
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

    expect(light.radius).toBe(80);
    expect(light.intensity).toBe(0.5);
    expect(light.color).toBe(0x123456);
    expect(light.enabled).toBe(true);
  });
});

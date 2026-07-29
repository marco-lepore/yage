import { describe, expect, it } from "vitest";
import { LightSource } from "./LightSource.js";
import type { LightSourceData } from "./LightSource.js";

describe("LightSource", () => {
  it("uses documented defaults", () => {
    const light = new LightSource({ radius: 80 });

    expect(light.serialize()).toEqual({
      radius: 80,
      intensity: 1,
      color: 0xffffff,
      enabled: true,
    });
  });

  it("restores every serialized field", () => {
    const data: LightSourceData = {
      radius: 120,
      intensity: 0.65,
      color: 0xff8844,
      enabled: false,
    };

    expect(LightSource.fromSnapshot(data).serialize()).toEqual(data);
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

    expect(light.serialize()).toEqual({
      radius: 80,
      intensity: 0.5,
      color: 0x123456,
      enabled: true,
    });
  });
});

import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { Vec2 } from "@yagejs/core";
import type { CameraComponent } from "./CameraComponent.js";
import { syncCameraTransform } from "./cameraTransform.js";

describe("syncCameraTransform", () => {
  it("uses effective pose with independent binding ratios", () => {
    const target = new Container();
    const camera = {
      effectivePosition: new Vec2(10, 20),
      effectiveZoom: 3,
      effectiveRotation: Math.PI,
      viewportWidth: 640,
      viewportHeight: 360,
    } as CameraComponent;
    syncCameraTransform(target, camera, {
      layer: "world",
      translateRatio: 0.5,
      scaleRatio: 0.5,
      rotateRatio: 0.5,
    });
    expect(target.scale.x).toBe(2);
    expect(target.rotation).toBe(-Math.PI / 2);
    expect(target.position.x).toBeCloseTo(300);
    expect(target.position.y).toBeCloseTo(190);
    syncCameraTransform(target);
    expect(target.position.x).toBe(0);
    expect(target.position.y).toBe(0);
    expect(target.rotation).toBe(0);
    expect(target.scale.x).toBe(1);
  });
});

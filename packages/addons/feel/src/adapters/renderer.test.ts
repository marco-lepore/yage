import { describe, expect, it } from "vitest";
import { createMockEntity } from "@yagejs/core";
import {
  CameraModifierHost,
  VisualModifierHost,
  type CameraComponent,
  type VisualComponent,
} from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import {
  feelBlink,
  feelCameraShake,
  feelCameraZoom,
  feelOpacity,
} from "./renderer.js";

describe("Feel renderer modifiers", () => {
  it("owns camera shake and zoom through removable contributions", () => {
    const { entity } = createMockEntity();
    const camera = {
      modifiers: new CameraModifierHost(),
    } as unknown as CameraComponent;
    const feel = entity.add(
      new Feel({
        camera: {
          overlap: "allow",
          effect: feelCameraZoom({ camera, scale: 2, duration: 1, peakAt: 1 }),
        },
        shake: feelCameraShake({ camera, duration: 1 }),
      }),
    );

    const zoom = feel.play("camera");
    const shake = feel.play("shake");
    feel.update(0.5);
    expect(camera.modifiers.size).toBe(2);
    expect(camera.modifiers.zoomFactor).toBe(1.75);

    shake?.stop();
    expect(camera.modifiers.size).toBe(1);
    zoom?.stop();
    expect(camera.modifiers.size).toBe(0);
    expect(camera.modifiers.zoomFactor).toBe(1);
  });

  it("owns opacity and blink through the visual component", () => {
    const { entity } = createMockEntity();
    const target = {
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;
    const feel = entity.add(
      new Feel({
        opacity: feelOpacity({ target, alpha: 0.5, duration: 1, peakAt: 1 }),
        blink: feelBlink({ target, duration: 1, interval: 0.1 }),
      }),
    );

    const opacity = feel.play("opacity");
    const blink = feel.play("blink");
    feel.update(0.5);
    expect(target.modifiers.size).toBe(2);
    expect(target.modifiers.opacityFactor).toBe(0.625);

    opacity?.stop();
    blink?.stop();
    expect(target.modifiers.size).toBe(0);
    expect(target.modifiers.opacityFactor).toBe(1);
    expect(target.modifiers.visible).toBe(true);
  });
});

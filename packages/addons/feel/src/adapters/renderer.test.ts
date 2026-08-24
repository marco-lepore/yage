import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { ErrorBoundaryKey, createMockEntity } from "@yagejs/core";
import {
  CameraModifierHost,
  VisualModifierHost,
  type CameraComponent,
  type EffectsHost,
  type VisualComponent,
} from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import {
  feelBlink,
  feelCameraRotation,
  feelCameraShake,
  feelCameraZoom,
  feelColorize,
  feelEffect,
  feelGlow,
  feelOpacity,
  feelOutline,
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
        rotate: feelCameraRotation({
          camera,
          radians: 0.2,
          duration: 1,
          peakAt: 1,
        }),
      }),
    );

    const zoom = feel.play("camera");
    const shake = feel.play("shake");
    const rotate = feel.play("rotate");
    feel.update(0.5);
    expect(camera.modifiers.size).toBe(3);
    expect(camera.modifiers.zoomFactor).toBe(1.75);
    expect(camera.modifiers.rotationOffset).toBeCloseTo(0.15);

    shake?.stop();
    expect(camera.modifiers.size).toBe(2);
    rotate?.stop();
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

  it("pulses outline, glow, and colorize through owned effect handles", () => {
    const { entity } = createMockEntity();
    const handles = Array.from({ length: 3 }, () => ({
      setIntensity: vi.fn(),
      remove: vi.fn(),
    }));
    let nextHandle = 0;
    const target = {
      fx: {
        addEffect: vi.fn(() => handles[nextHandle++]),
      },
    } as unknown as VisualComponent;
    const feel = entity.add(
      new Feel({
        outline: feelOutline({ target, color: 0xffcc00, duration: 1 }),
        glow: feelGlow({ target, color: 0x66ccff, duration: 1 }),
        color: feelColorize({ target, color: 0xff0000, duration: 1 }),
      }),
    );

    const outline = feel.play("outline");
    const glow = feel.play("glow");
    const color = feel.play("color");
    feel.update(0.25);

    expect(target.fx.addEffect).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(target.fx.addEffect).mock.calls) {
      expect(call[1]).toEqual({ save: false });
    }
    for (const handle of handles) {
      expect(handle.setIntensity).toHaveBeenCalledWith(0);
      expect(handle.setIntensity).toHaveBeenLastCalledWith(1);
    }

    outline?.stop();
    glow?.stop();
    color?.stop();
    for (const handle of handles) expect(handle.remove).toHaveBeenCalledOnce();
  });

  it("rejects invalid effect pulse timing before attaching a filter", () => {
    const host = {
      addEffect: vi.fn(),
    } as unknown as EffectsHost;

    expect(() =>
      feelEffect(host, (() => undefined) as never, { peakAt: 2 }),
    ).toThrow(/peakAt/);
    expect(host.addEffect).not.toHaveBeenCalled();
  });

  it("attributes camera target functions as developer callbacks", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const feel = entity.add(
      new Feel({
        rotate: feelCameraRotation({
          camera: () => {
            throw new Error("missing camera");
          },
        }),
      }),
    );

    expect(() => feel.play("rotate")).toThrow("missing camera");
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (camera target source)",
    );
  });
});

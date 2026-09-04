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
  feelDissolve,
  feelEffect,
  feelGlitch,
  feelGlow,
  feelHitFlash,
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
      expect(call).toHaveLength(1);
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
    const target = {
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;

    expect(() =>
      feelEffect(host, (() => undefined) as never, { peakAt: 2 }),
    ).toThrow(
      "feelEffect: peakAt must be a finite number between 0 and 1, got 2.",
    );
    expect(() => feelHitFlash(host, { duration: Number.NaN })).toThrow(
      "feelHitFlash: duration must be a finite number >= 0, got NaN.",
    );
    expect(() => feelOpacity({ target, peakAt: -0.1 })).toThrow(
      "feelOpacity: peakAt must be a finite number between 0 and 1, got -0.1.",
    );
    expect(host.addEffect).not.toHaveBeenCalled();
  });

  it("captures pulse timing when the builder is called", () => {
    const { entity } = createMockEntity();
    const handle = { setIntensity: vi.fn(), remove: vi.fn() };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const options = { duration: 1, peakAt: 0.5 };
    const pulse = feelEffect(host, (() => undefined) as never, options);
    options.duration = 2;
    options.peakAt = 1;
    const feel = entity.add(new Feel({ pulse }));

    feel.play("pulse");
    feel.update(0.5);

    expect(pulse.duration).toBe(1);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(1);
  });

  it("preserves the ordinary ease-out pulse default", () => {
    const { entity } = createMockEntity();
    const handle = { setIntensity: vi.fn(), remove: vi.fn() };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({ pulse: feelEffect(host, (() => undefined) as never) }),
    );

    feel.play("pulse");
    feel.update(0.025);

    expect(handle.setIntensity).toHaveBeenLastCalledWith(0.75);
  });

  it("preserves the opacity pulse defaults", () => {
    const { entity } = createMockEntity();
    const target = {
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;
    const opacity = feelOpacity({ target, alpha: 0 });
    const feel = entity.add(new Feel({ opacity }));

    feel.play("opacity");
    feel.update(0.0225);

    expect(opacity.duration).toBe(0.18);
    expect(target.modifiers.opacityFactor).toBeCloseTo(0.25);
  });

  it("retimes hit flash while Feel drives its linear triangle", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      trigger: vi.fn(),
      remove: vi.fn(),
    };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const flash = feelHitFlash(host);
    const feel = entity.add(new Feel({ flash }));

    feel.play("flash", { duration: 0.24 });
    feel.update(0.06);

    expect(flash.duration).toBe(0.12);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(0.5);
    expect(handle.trigger).not.toHaveBeenCalled();
  });

  it("forwards pulse easing through hit flash and opacity", () => {
    const { entity } = createMockEntity();
    const flashHandle = {
      setIntensity: vi.fn(),
      trigger: vi.fn(),
      remove: vi.fn(),
    };
    const host = {
      addEffect: vi.fn(() => flashHandle),
    } as unknown as EffectsHost;
    const target = {
      modifiers: new VisualModifierHost(),
    } as unknown as VisualComponent;
    const flashAttack = vi.fn((progress: number) => progress * 0.4);
    const flashRelease = vi.fn((progress: number) => progress * 0.2);
    const opacityAttack = vi.fn((progress: number) => progress * 0.6);
    const opacityRelease = vi.fn((progress: number) => progress * 0.4);
    const feel = entity.add(
      new Feel({
        flash: feelHitFlash(host, {
          duration: 1,
          peakAt: 0.5,
          attackEasing: flashAttack,
          releaseEasing: flashRelease,
        }),
        opacity: feelOpacity({
          target,
          alpha: 0,
          duration: 1,
          peakAt: 0.5,
          attackEasing: opacityAttack,
          releaseEasing: opacityRelease,
        }),
      }),
    );

    feel.play("flash");
    feel.play("opacity");
    flashAttack.mockClear();
    opacityAttack.mockClear();
    feel.update(0.25);
    expect(flashAttack).toHaveBeenLastCalledWith(0.5);
    expect(opacityAttack).toHaveBeenLastCalledWith(0.5);
    expect(flashHandle.setIntensity).toHaveBeenLastCalledWith(0.2);
    expect(target.modifiers.opacityFactor).toBeCloseTo(0.7);

    feel.update(0.5);
    expect(flashRelease).toHaveBeenLastCalledWith(0.5);
    expect(opacityRelease).toHaveBeenLastCalledWith(0.5);
    expect(flashHandle.setIntensity).toHaveBeenLastCalledWith(0.9);
    expect(target.modifiers.opacityFactor).toBeCloseTo(0.2);
  });

  it.each([
    {
      name: "throwing attack",
      timing: {
        attackEasing: () => {
          throw new Error("broken pulse easing");
        },
      },
      message: "broken pulse easing",
      callback: "feelEffect attack easing",
      advance: (feel: Feel) => feel.play("pulse"),
    },
    {
      name: "non-finite release",
      timing: { releaseEasing: () => Number.NaN },
      message: "finite number",
      callback: "feelEffect release easing",
      advance: (feel: Feel) => {
        feel.play("pulse");
        feel.update(0.75);
      },
    },
  ])(
    "attributes $name pulse easing without an invalid renderer write",
    ({ timing, message, callback, advance }) => {
      const { entity, context } = createMockEntity();
      const boundary = context.resolve(ErrorBoundaryKey);
      const handle = { setIntensity: vi.fn(), remove: vi.fn() };
      const host = {
        addEffect: vi.fn(() => handle),
      } as unknown as EffectsHost;
      const feel = entity.add(
        new Feel({
          pulse: feelEffect(host, (() => undefined) as never, {
            duration: 1,
            peakAt: 0.5,
            ...timing,
          }),
        }),
      );

      expect(() => advance(feel)).toThrow(message);
      expect(boundary.getCallbackErrors().at(-1)?.kind).toBe(
        `Feel callback (${callback})`,
      );
      expect(
        handle.setIntensity.mock.calls.every(([value]) =>
          Number.isFinite(value),
        ),
      ).toBe(true);
    },
  );

  it("rejects an overflowing pulse amount before writing renderer state", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const handle = { setIntensity: vi.fn(), remove: vi.fn() };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({
        pulse: feelEffect(host, (() => undefined) as never, {
          attackEasing: () => Number.MAX_VALUE,
        }),
      }),
    );

    expect(() => feel.play("pulse", { intensity: 2 })).toThrow(
      "feelEffect: attackEasing must produce a finite amount, got Infinity.",
    );
    expect(boundary.getCallbackErrors().at(-1)?.kind).toBe(
      "Feel callback (feelEffect attack easing)",
    );
    expect(handle.setIntensity).toHaveBeenCalledOnce();
    expect(handle.setIntensity).toHaveBeenCalledWith(0);
  });

  it("attributes a supplied effect factory as a developer callback", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const host = {
      addEffect: (factory: () => unknown) => factory(),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({
        broken: feelEffect(host, () => {
          throw new Error("broken effect factory");
        }),
      }),
    );

    expect(() => feel.play("broken")).toThrow("broken effect factory");
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (effect factory)",
    );
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

  it("refreshes glitch patterns during playback and removes its handle", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
    };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({
        glitch: feelGlitch({
          host,
          duration: 1,
          peakAt: 0.25,
          refreshRate: 10,
          seed: 17,
        }),
      }),
    );

    const playback = feel.play("glitch");
    expect(host.addEffect).toHaveBeenCalledWith(expect.any(Function));
    expect(handle.refresh).toHaveBeenCalledOnce();
    expect(handle.refresh).toHaveBeenCalledWith(17);
    expect(handle.setIntensity).toHaveBeenCalledWith(0);

    feel.update(0.1);
    expect(handle.refresh).toHaveBeenCalledTimes(2);
    playback?.stop();
    expect(handle.remove).toHaveBeenCalledOnce();
  });

  it("refreshes glitch for every interval a long frame covered", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
    };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({
        glitch: feelGlitch({ host, duration: 1, refreshRate: 20, seed: 3 }),
      }),
    );

    feel.play("glitch");
    expect(handle.refresh).toHaveBeenCalledOnce();

    // 0.5s at 20 refreshes per second covers ten intervals. Refreshing once
    // and discarding the remainder would undershoot `refreshRate` and leave
    // the seeded random source at a different point.
    feel.update(0.5);
    expect(handle.refresh.mock.calls.length - 1).toBe(10);
  });

  it("uses the retimed local clock for refresh cadence", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
    };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({
        glitch: feelGlitch({ host, duration: 1, refreshRate: 20, seed: 3 }),
      }),
    );

    feel.play("glitch", { duration: 2 });
    feel.update(0.5);

    expect(handle.refresh).toHaveBeenCalledTimes(6);
  });

  it("brings glitch in quickly, holds it, then releases it", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      refresh: vi.fn(),
      remove: vi.fn(),
    };
    const host = {
      addEffect: vi.fn(() => handle),
    } as unknown as EffectsHost;
    const feel = entity.add(
      new Feel({ glitch: feelGlitch({ host, duration: 1 }) }),
    );

    feel.play("glitch");
    feel.update(0.04);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(0.75);

    feel.update(0.1);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(1);

    feel.update(0.8);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(
      expect.closeTo(0.382653, 5),
    );
  });

  it("rejects a non-positive glitch refresh rate before playback", () => {
    const host = { addEffect: vi.fn() } as unknown as EffectsHost;
    expect(() => feelGlitch({ host, refreshRate: 0 })).toThrow(/refreshRate/);
    expect(() => feelGlitch({ host, peakAt: 0.5, releaseAt: 0.25 })).toThrow(
      /releaseAt/,
    );
    expect(() => feelGlitch({ host, releaseAt: 2 })).toThrow(/releaseAt/);
    expect(host.addEffect).not.toHaveBeenCalled();
  });

  it("advances a dissolve monotonically and removes it on completion", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      remove: vi.fn(),
    };
    const target = {
      fx: { addEffect: vi.fn(() => handle) },
    } as unknown as VisualComponent;
    const feel = entity.add(
      new Feel({ dissolve: feelDissolve({ target, duration: 1 }) }),
    );

    feel.play("dissolve");
    feel.update(0.5);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(0.25);
    feel.update(0.5);
    expect(handle.setIntensity).toHaveBeenLastCalledWith(1);
    expect(handle.remove).toHaveBeenCalledOnce();
  });

  it("restores a dissolving visual when playback is cancelled", () => {
    const { entity } = createMockEntity();
    const handle = {
      setIntensity: vi.fn(),
      remove: vi.fn(),
    };
    const target = {
      fx: { addEffect: vi.fn(() => handle) },
    } as unknown as VisualComponent;
    const feel = entity.add(
      new Feel({ dissolve: feelDissolve({ target, duration: 1 }) }),
    );

    const playback = feel.play("dissolve");
    feel.update(0.4);
    playback?.stop();
    expect(handle.remove).toHaveBeenCalledOnce();
  });

  it("attributes a supplied dissolve easing as a developer callback", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const target = {
      fx: {
        addEffect: vi.fn(() => ({
          setIntensity: vi.fn(),
          remove: vi.fn(),
        })),
      },
    } as unknown as VisualComponent;
    const feel = entity.add(
      new Feel({
        dissolve: feelDissolve({
          target,
          duration: 1,
          easing: () => {
            throw new Error("broken dissolve easing");
          },
        }),
      }),
    );

    expect(() => feel.play("dissolve")).toThrow("broken dissolve easing");
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (dissolve easing)",
    );
  });
});

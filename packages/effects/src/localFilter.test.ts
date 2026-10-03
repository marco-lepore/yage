import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DOMAdapter, BlurFilter } from "pixi.js";
import type { Filter } from "pixi.js";
import {
  AdvancedBloomFilter,
  DropShadowFilter,
  GlowFilter,
  OutlineFilter,
  RGBSplitFilter,
  MotionBlurFilter,
} from "pixi-filters";
import type { Effect, EffectHandle } from "@yagejs/renderer";
import { bloom } from "./bloom.js";
import { outline } from "./outline.js";
import { glow } from "./glow.js";
import { dropShadow } from "./dropShadow.js";
import { chromaticAberration } from "./chromaticAberration.js";
import { motionBlur } from "./motionBlur.js";
import { axisBlur } from "./axisBlur.js";
import { gaussianPadding, kawasePadding } from "./localFilter.js";

const adapter = DOMAdapter.get();
beforeAll(() => {
  DOMAdapter.set({
    ...adapter,
    createCanvas: () => ({ getContext: () => null }) as never,
  });
  for (const type of [
    AdvancedBloomFilter,
    DropShadowFilter,
    GlowFilter,
    OutlineFilter,
    RGBSplitFilter,
    MotionBlurFilter,
    BlurFilter,
  ]) {
    vi.spyOn(type.prototype, "apply").mockImplementation(() => {});
  }
});
afterAll(() => {
  vi.restoreAllMocks();
  DOMAdapter.set(adapter);
});

function attach<H extends EffectHandle>(effect: Effect<H>, x = 2, y = 2) {
  const transform = { a: x, b: 0, c: 0, d: y, tx: 0, ty: 0 };
  effect.onAttach?.({
    displayObject: { worldTransform: transform } as never,
    scope: "component",
  });
  const filter = effect.filter as Filter;
  const render = (): void =>
    filter.apply({} as never, {} as never, {} as never, true);
  return { filter, render, transform };
}

describe("host-local filter units", () => {
  it("keeps fade state independent of draw-time outline conversion", () => {
    const effect = outline({ thickness: 4 })();
    const { filter, render, transform } = attach(effect);
    effect.setIntensity(0.25);
    expect(filter.padding).toBe(3);
    render();
    expect((filter as OutlineFilter).thickness).toBe(2);
    expect(effect.getIntensity()).toBe(0.25);
    effect.buildExtras?.({} as never).setThickness(8);
    render();
    expect((filter as OutlineFilter).thickness).toBe(4);
    expect(effect.getIntensity()).toBe(0.25);
    transform.a = transform.d = 3;
    expect(filter.padding).toBe(7); // Before apply, on the first resized draw.
    render();
    expect((filter as OutlineFilter).thickness).toBe(6);
    effect.onDetach?.();
    render();
    expect((filter as OutlineFilter).thickness).toBe(2);
  });

  it("scales all Kawase tap offsets and pads the complete pass chain", () => {
    const effect = bloom({ blur: 8, quality: 12 })();
    const { filter, render } = attach(effect);
    expect(filter.padding).toBe(128); // 2 * (8+7.333+...+0.666+12*0.5), plus interpolation.
    render();
    expect((filter as AdvancedBloomFilter).pixelSizeX).toBe(2);
    expect((filter as AdvancedBloomFilter).blur).toBe(8);
    const shadow = dropShadow({
      offset: { x: 10, y: -4 },
      blur: 8,
      quality: 12,
    })();
    const draw = attach(shadow, 3, 1);
    expect(draw.filter.padding).toBe(158);
    draw.render();
    expect((draw.filter as DropShadowFilter).offset).toEqual({ x: 30, y: -4 });
  });

  it("scales glow radius without rebuilding either shader program", () => {
    const effect = glow({ distance: 10 })();
    const { filter, render, transform } = attach(effect);
    const gl = filter.glProgram;
    const gpu = filter.gpuProgram;
    expect(filter.padding).toBe(21);
    render();
    expect((filter as GlowFilter).distance).toBe(20);
    transform.a = transform.d = 0.5;
    expect(filter.padding).toBe(6);
    render();
    expect((filter as GlowFilter).distance).toBe(5);
    expect(filter.glProgram).toBe(gl);
    expect(filter.gpuProgram).toBe(gpu);
    expect(gl?.fragment).toContain("uDistance / DIST");
    expect(gpu?.fragment?.source).toContain("glowUniforms.uDistance / dist");
  });

  it("converts channel offsets, motion velocity and motion sample offset", () => {
    const split = chromaticAberration({ separation: 4 })();
    const s = attach(split, 3, 1);
    split.setIntensity(0.5);
    s.render();
    expect((s.filter as RGBSplitFilter).red).toMatchObject({ x: -6, y: 0 });
    expect(split.getIntensity()).toBe(0.5);
    const motion = motionBlur({ velocity: { x: 30, y: 10 }, offset: 5 })();
    const m = attach(motion, 3, 1);
    motion.setIntensity(0.5);
    m.render();
    expect((m.filter as MotionBlurFilter).velocityX).toBe(45);
    expect((m.filter as MotionBlurFilter).velocityY).toBe(5);
    expect((m.filter as MotionBlurFilter).offset).toBe(10);
    expect(motion.getIntensity()).toBe(0.5);
    motion.setIntensity(0);
    expect(m.filter.padding).toBe(0);
  });

  it("covers wide Gaussian kernels and preserves explicit edge repetition", () => {
    const effect = axisBlur({ strength: 8, quality: 1, kernelSize: 15 })();
    const { filter, render } = attach(effect);
    expect(filter.padding).toBe(113);
    render();
    expect((filter as BlurFilter).strengthX).toBe(16);
    expect((filter as BlurFilter).strengthY).toBe(0);
    const repeated = axisBlur({ repeatEdgePixels: true })();
    expect(attach(repeated).filter.padding).toBe(0);
    expect(() =>
      effect.buildExtras?.({} as never).setAxis("wrong" as never),
    ).toThrow(/axis/);
  });

  it("uses axis magnitudes under rotation and does not accumulate conversions", () => {
    const effect = outline({ thickness: 4 })();
    const { filter, render, transform } = attach(effect);
    Object.assign(transform, { a: 0, b: 3, c: -1, d: 0 });
    render();
    render();
    expect((filter as OutlineFilter).thickness).toBe(8);
    expect(effect.getIntensity()).toBe(1);
  });

  it("rejects invalid dimensional inputs before filter construction or mutation", () => {
    expect(() => bloom({ blur: NaN })()).toThrow(/blur/);
    expect(() => glow({ distance: Infinity })()).toThrow(/distance/);
    expect(() => motionBlur({ velocity: { x: 1, y: NaN } })()).toThrow(
      /velocity.y/,
    );
    expect(() => axisBlur({ axis: "bad" as never })()).toThrow(/axis/);
    const effect = dropShadow({})();
    const offset = (effect.filter as DropShadowFilter).offset;
    expect(() => effect.buildExtras?.({} as never).setOffset(8, NaN)).toThrow(
      /offset.y/,
    );
    expect((effect.filter as DropShadowFilter).offset).toEqual(offset);
  });

  it("includes every sampling pass rather than twice the blur strength", () => {
    expect(kawasePadding(8, 12, 1)).toBeCloseTo(70);
    expect(gaussianPadding(8, 1, 15)).toBe(57);
    expect(gaussianPadding(8, 2, 15)).toBeCloseTo(
      (56 * 1.5) / Math.sqrt(1.25) + 2,
    );
  });
});

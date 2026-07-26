import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import type { Renderer } from "pixi.js";
import { createRenderTarget } from "./RenderTarget.js";
import type { RenderTargetOptions } from "./RenderTarget.js";

interface CapturedRender {
  container: Container;
  target: unknown;
  clear?: boolean;
  clearColor?: unknown;
  transform?: unknown;
}

/**
 * Stand-in for the live Pixi renderer: records what would have been drawn.
 * `resolution` mirrors a HiDPI canvas so the resolution math is visible.
 */
function fakeRenderer(resolution = 2): {
  renderer: Renderer;
  calls: CapturedRender[];
} {
  const calls: CapturedRender[] = [];
  const renderer = {
    resolution,
    render(options: CapturedRender) {
      calls.push(options);
    },
  };
  return { renderer: renderer as unknown as Renderer, calls };
}

function makeTarget(
  options?: Partial<RenderTargetOptions>,
  resolution = 2,
): {
  source: Container;
  calls: CapturedRender[];
  renderer: Renderer;
  target: ReturnType<typeof createRenderTarget>;
} {
  const { renderer, calls } = fakeRenderer(resolution);
  const source = new Container();
  const target = createRenderTarget(renderer, source, {
    width: 400,
    height: 300,
    ...options,
  });
  return { source, calls, renderer, target };
}

describe("createRenderTarget", () => {
  it("sizes the texture in source coordinates at the renderer's resolution", () => {
    const { target } = makeTarget();
    expect(target.width).toBe(400);
    expect(target.height).toBe(300);
    expect(target.resolution).toBe(2);
    expect(target.texture.source.pixelWidth).toBe(800);
    expect(target.texture.source.pixelHeight).toBe(600);
  });

  it("resolutionScale trades texels for sharpness without changing the size", () => {
    const { target } = makeTarget({ resolutionScale: 0.5 });
    // Same measured size, a quarter of the texels.
    expect(target.width).toBe(400);
    expect(target.height).toBe(300);
    expect(target.resolution).toBe(1);
    expect(target.texture.source.pixelWidth).toBe(400);
    expect(target.texture.source.pixelHeight).toBe(300);
  });

  it("rejects a non-positive size or scale", () => {
    expect(() => makeTarget({ width: 0 })).toThrow(/width/);
    expect(() => makeTarget({ height: -10 })).toThrow(/height/);
    expect(() => makeTarget({ resolutionScale: 0 })).toThrow(/resolutionScale/);
  });

  it("starts pending, renders once, then stays clean until invalidated", () => {
    const { target, calls } = makeTarget();
    expect(target.needsRender).toBe(true);

    expect(target.renderIfNeeded()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(target.needsRender).toBe(false);

    expect(target.renderIfNeeded()).toBe(false);
    expect(calls).toHaveLength(1);

    target.invalidate();
    expect(target.renderIfNeeded()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("render() draws whether or not anything is pending", () => {
    const { target, calls } = makeTarget();
    target.render();
    target.render();
    expect(calls).toHaveLength(2);
    expect(target.needsRender).toBe(false);
  });

  it("draws the source into its own texture, clearing first", () => {
    const { target, source, calls } = makeTarget({ clearColor: 0x101020 });
    target.render();
    expect(calls[0]?.container).toBe(source);
    expect(calls[0]?.target).toBe(target.texture);
    expect(calls[0]?.clear).toBe(true);
    const clearColor = calls[0]?.clearColor as number[];
    expect(clearColor).toHaveLength(4);
    expect(clearColor[0]).toBeCloseTo(16 / 255, 5);
    expect(clearColor[1]).toBeCloseTo(16 / 255, 5);
    expect(clearColor[2]).toBeCloseTo(32 / 255, 5);
    expect(clearColor[3]).toBe(1);
  });

  it("normalises an opaque-black clearColor to RGBA", () => {
    // Pixi only converts a *truthy* clearColor, so a bare `0` would reach the
    // backend as a number where an array is expected.
    const { target, calls } = makeTarget({ clearColor: 0x000000 });
    target.render();
    expect(calls[0]?.clearColor).toEqual([0, 0, 0, 1]);
  });

  it("omits clearColor when none was configured", () => {
    const { target, calls } = makeTarget();
    target.render();
    expect(calls[0]).not.toHaveProperty("clearColor");
  });

  it("draws in the source's own space — the fit and camera transforms do not reach it", () => {
    const { target, source, calls } = makeTarget();
    // Stands in for the chain the renderer really parents scenes under: the
    // fit transform on `_worldRoot` plus a camera offset.
    const fitAndCamera = new Container();
    fitAndCamera.scale.set(3);
    fitAndCamera.position.set(120, 45);
    fitAndCamera.addChild(source);

    const child = new Container();
    child.position.set(100, 50);
    source.addChild(child);

    target.render();

    // No transform is supplied, so Pixi draws with the source's own local
    // transform — identity here despite the scaled, offset ancestor.
    expect(calls[0]).not.toHaveProperty("transform");
    source.updateLocalTransform();
    expect(source.localTransform.a).toBe(1);
    expect(source.localTransform.tx).toBe(0);
    expect(source.localTransform.ty).toBe(0);
  });

  it("a moved source shifts its content inside the buffer", () => {
    const { target, source, calls } = makeTarget();
    source.position.set(25, 10);
    target.render();

    // The source's OWN transform is the one Pixi applies, so offsetting the
    // source offsets everything it holds within the texture.
    expect(calls[0]).not.toHaveProperty("transform");
    source.updateLocalTransform();
    expect(source.localTransform.tx).toBe(25);
    expect(source.localTransform.ty).toBe(10);
  });

  it("skips a hidden source and keeps the render pending", () => {
    const { target, source, calls } = makeTarget();
    source.visible = false;

    expect(target.renderIfNeeded()).toBe(false);
    expect(calls).toHaveLength(0);
    expect(target.needsRender).toBe(true);

    source.visible = true;
    expect(target.renderIfNeeded()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("a forced render on a hidden source re-arms instead of being dropped", () => {
    const { target, source, calls } = makeTarget();
    target.renderIfNeeded();
    expect(target.needsRender).toBe(false);

    // The caller changed the source and forced a draw, but it is hidden. The
    // request has to survive, or the change is lost with nothing to replay it.
    source.visible = false;
    target.render();
    expect(calls).toHaveLength(1);
    expect(target.needsRender).toBe(true);

    source.visible = true;
    expect(target.renderIfNeeded()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("resize changes the measured size and re-arms the render", () => {
    const { target } = makeTarget();
    target.renderIfNeeded();
    expect(target.needsRender).toBe(false);

    target.resize(200, 100);
    expect(target.width).toBe(200);
    expect(target.height).toBe(100);
    expect(target.resolution).toBe(2);
    expect(target.needsRender).toBe(true);
  });

  it("resize can also change the texel density", () => {
    const { target } = makeTarget();
    target.resize(200, 100, 0.25);
    expect(target.resolution).toBe(0.5);
    expect(target.texture.source.pixelWidth).toBe(100);
  });

  it("a size that lands between texels is rounded up to a whole one", () => {
    // Pixi stores whole texels, so at a reduced density the measured size is
    // quantised to the nearest size that divides evenly. Documented, not fixed:
    // rounding here would only move the discrepancy somewhere less visible.
    const { target } = makeTarget();
    target.resize(1279, 719, 0.25);
    expect(target.resolution).toBe(0.5);
    expect(target.texture.source.pixelWidth).toBe(640);
    expect(target.width).toBe(1280);
    expect(target.height).toBe(720);
  });

  it("throws a named error when the source was destroyed first", () => {
    const { target, source } = makeTarget();
    source.destroy();

    // Without the guard this surfaces as a TypeError from inside Pixi's own
    // transform update, naming nothing the caller can act on.
    expect(() => target.render()).toThrow(/source container has been destroyed/);
    expect(() => target.renderIfNeeded()).toThrow(
      /source container has been destroyed/,
    );
  });

  it("resize keeps the configured density when the renderer's resolution changes", () => {
    const { target, renderer } = makeTarget({ resolutionScale: 0.5 });
    expect(target.resolution).toBe(1); // renderer 2 x scale 0.5

    renderer.resolution = 3;
    target.resize(200, 100);
    expect(target.resolution).toBe(1.5); // renderer 3 x the SAME scale 0.5
  });

  it("resize with an explicit scale replaces the configured one", () => {
    const { target, renderer } = makeTarget({ resolutionScale: 0.5 });
    target.resize(200, 100, 0.25);
    expect(target.resolution).toBe(0.5);

    renderer.resolution = 4;
    target.resize(200, 100);
    expect(target.resolution).toBe(1); // 4 x 0.25, the replacement scale
  });

  it("destroy releases the texture and is repeatable", () => {
    const { target } = makeTarget();
    const texture = target.texture;
    target.destroy();
    expect(texture.destroyed).toBe(true);
    expect(() => target.destroy()).not.toThrow();
  });
});

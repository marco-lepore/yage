import { describe, it, expect, vi } from "vitest";

const { captured } = vi.hoisted(() => {
  const captured: { calls: unknown[] } = { calls: [] };
  return { captured };
});

vi.mock("pixi.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  FillGradient: class {
    constructor(options: unknown) {
      captured.calls.push(options);
    }
  },
}));

import { linearGradient, radialGradient } from "./gradient.js";

describe("linearGradient", () => {
  it("defaults to a vertical top-to-bottom gradient in local space", () => {
    captured.calls.length = 0;
    linearGradient({
      stops: [
        { offset: 0, color: 0x000000, alpha: 1 },
        { offset: 1, color: 0xffffff, alpha: 0 },
      ],
    });
    expect(captured.calls[0]).toMatchObject({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: "local",
    });
  });

  it("honours the horizontal axis shorthand", () => {
    captured.calls.length = 0;
    linearGradient({
      axis: "horizontal",
      stops: [
        { offset: 0, color: 0x000000 },
        { offset: 1, color: 0xffffff },
      ],
    });
    expect(captured.calls[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
    });
  });

  it("prefers explicit start/end over axis shorthand", () => {
    captured.calls.length = 0;
    linearGradient({
      axis: "horizontal",
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      space: "global",
      stops: [
        { offset: 0, color: 0x000000 },
        { offset: 1, color: 0xffffff },
      ],
    });
    expect(captured.calls[0]).toMatchObject({
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      textureSpace: "global",
    });
  });

  it("converts numeric color + alpha to rgba strings per stop", () => {
    captured.calls.length = 0;
    linearGradient({
      stops: [
        { offset: 0, color: 0xff8040, alpha: 0.5 },
        { offset: 1, color: 0x102030 },
      ],
    });
    const opts = captured.calls[0] as { colorStops: { offset: number; color: string }[] };
    expect(opts.colorStops).toEqual([
      { offset: 0, color: "rgba(255,128,64,0.5)" },
      { offset: 1, color: "rgba(16,32,48,1)" },
    ]);
  });
});

describe("radialGradient", () => {
  it("defaults to a centered local-space gradient from r=0 to r=0.5", () => {
    captured.calls.length = 0;
    radialGradient({
      stops: [
        { offset: 0, color: 0xff0000 },
        { offset: 1, color: 0x000000, alpha: 0 },
      ],
    });
    expect(captured.calls[0]).toMatchObject({
      type: "radial",
      center: { x: 0.5, y: 0.5 },
      innerRadius: 0,
      outerRadius: 0.5,
      textureSpace: "local",
    });
  });

  it("passes custom center, radii, and space through", () => {
    captured.calls.length = 0;
    radialGradient({
      center: { x: 100, y: 100 },
      innerRadius: 5,
      outerRadius: 80,
      space: "global",
      stops: [
        { offset: 0, color: 0xffffff },
        { offset: 1, color: 0x000000 },
      ],
    });
    expect(captured.calls[0]).toMatchObject({
      center: { x: 100, y: 100 },
      innerRadius: 5,
      outerRadius: 80,
      textureSpace: "global",
    });
  });

  it("defaults outerCenter to center and forwards an explicit value", () => {
    captured.calls.length = 0;
    radialGradient({
      center: { x: 50, y: 50 },
      stops: [{ offset: 0, color: 0xffffff }],
    });
    expect(captured.calls[0]).toMatchObject({
      outerCenter: { x: 50, y: 50 },
    });

    captured.calls.length = 0;
    radialGradient({
      center: { x: 0.5, y: 0.5 },
      outerCenter: { x: 0.7, y: 0.3 },
      stops: [{ offset: 0, color: 0xffffff }],
    });
    expect(captured.calls[0]).toMatchObject({
      outerCenter: { x: 0.7, y: 0.3 },
    });
  });

  it("converts numeric color + alpha to rgba strings per stop (radial)", () => {
    captured.calls.length = 0;
    radialGradient({
      stops: [
        { offset: 0, color: 0xff8040, alpha: 0.5 },
        { offset: 1, color: 0x102030 },
      ],
    });
    const opts = captured.calls[0] as {
      colorStops: { offset: number; color: string }[];
    };
    expect(opts.colorStops).toEqual([
      { offset: 0, color: "rgba(255,128,64,0.5)" },
      { offset: 1, color: "rgba(16,32,48,1)" },
    ]);
  });
});

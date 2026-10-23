import { describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import {
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
} from "@yagejs/core";
import type { SceneTransitionContext } from "@yagejs/core";
import { RendererKey } from "../types.js";
import { graphicsMask } from "../masks/graphicsMask.js";
import { createTransitionOverlay } from "./overlay.js";

function makeCtx(boundary?: ErrorBoundary) {
  const stage = new Container();
  const worldRoot = new Container();
  const renderer = {
    canvasSize: { width: 800, height: 600 },
    visibleCanvasRect: { x: -20, y: 0, width: 440, height: 300 },
    worldRoot,
    application: { stage },
  };
  const ctx = {
    elapsed: 0,
    kind: "push",
    engineContext: {
      resolve: (key: unknown) => (key === RendererKey ? renderer : undefined),
      tryResolve: (key: unknown) =>
        key === ErrorBoundaryKey ? boundary : undefined,
    },
  } as unknown as SceneTransitionContext;
  return { ctx, stage, worldRoot };
}

describe("createTransitionOverlay", () => {
  it("attributes a throwing draw callback to the overlay and rethrows it", () => {
    const boundary = new ErrorBoundary(new Logger({ level: LogLevel.Debug }));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const overlay = createTransitionOverlay(makeCtx(boundary).ctx);

    expect(() =>
      overlay.draw(() => {
        throw new Error("bad shape");
      }),
    ).toThrow("bad shape");
    expect(boundary.getCallbackErrors()).toMatchObject([
      { kind: "Transition overlay draw callback", error: "bad shape" },
    ]);
    quiet.mockRestore();
  });

  it("covers the visible canvas in virtual pixels inside the fit", () => {
    const { ctx, worldRoot } = makeCtx();
    const overlay = createTransitionOverlay(ctx);

    expect(overlay.area).toEqual({ x: -20, y: 0, width: 440, height: 300 });
    expect(worldRoot.children).toHaveLength(1);
  });

  it("covers the whole canvas in canvas pixels with coverScreen", () => {
    const { ctx, stage, worldRoot } = makeCtx();
    const overlay = createTransitionOverlay(ctx, { coverScreen: true });

    expect(overlay.area).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(stage.children).toHaveLength(1);
    expect(worldRoot.children).toHaveLength(0);
  });

  it("draws, fades, hides and masks the overlay, then frees it", () => {
    const { ctx, worldRoot } = makeCtx();
    const overlay = createTransitionOverlay(ctx);
    const container = worldRoot.children[0]!;
    const { x, y, width, height } = overlay.area;

    expect(overlay.draw((g) => g.rect(x, y, width, height).fill(0))).toBe(
      overlay,
    );
    overlay.alpha = 0.5;
    overlay.visible = false;
    expect(container.alpha).toBe(0.5);
    expect(container.visible).toBe(false);
    expect(() => {
      overlay.alpha = NaN;
    }).toThrow("TransitionOverlay.alpha: value must be finite, got NaN.");

    const mask = overlay.setMask(graphicsMask((g) => g.circle(0, 0, 10)));
    mask.setInverse(true);
    expect(container.mask).toBeTruthy();
    overlay.clearMask();
    // Pixi reads an unmasked container's mask back as undefined.
    expect(container.mask).toBeFalsy();

    overlay.destroy();
    overlay.destroy();
    expect(worldRoot.children).toHaveLength(0);
    expect(container.destroyed).toBe(true);
  });
});

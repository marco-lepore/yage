import type { Engine, ServiceKey } from "@yagejs/core";
import { describe, expect, it, vi } from "vitest";
import { captureLab } from "./labCapture.js";

interface RendererStubOptions {
  readonly bounds?: { width: number; height: number };
  readonly resolution?: number;
  readonly textureLimit?: number | undefined;
  readonly webGpu?: boolean;
  readonly startsAsRenderGroup?: boolean;
  readonly extractThrows?: boolean;
}

interface ExtractCall {
  readonly target: unknown;
  readonly frame?: { x: number; y: number; width: number; height: number };
  readonly resolution?: number;
}

function stubEngine(opts: RendererStubOptions = {}) {
  const contentDataUrl = vi
    .fn()
    .mockResolvedValue("data:image/png;base64,content");
  // Pixi promotes whatever it renders to a render group and leaves it one.
  const worldRoot = {
    label: "world",
    renderGroup: opts.startsAsRenderGroup === true ? {} : null,
    disableRenderGroup: vi.fn(() => {
      worldRoot.renderGroup = null;
    }),
  } as {
    label: string;
    renderGroup: object | null;
    disableRenderGroup: ReturnType<typeof vi.fn>;
  };
  const screen = {
    x: 10,
    y: 20,
    width: 1024,
    height: 768,
    clone() {
      return {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
      };
    },
  };
  const canvas = {
    toDataURL: vi.fn(() => "data:image/png;base64,camera"),
  };
  const extractCanvas = vi.fn((options: ExtractCall) => {
    void options;
    worldRoot.renderGroup ??= {};
    if (opts.extractThrows === true) throw new Error("extract failed");
    return canvas;
  });
  const graphics = {
    screen,
    resolution: opts.resolution ?? 1,
    extract: { canvas: extractCanvas },
    ...(opts.textureLimit === undefined
      ? {}
      : opts.webGpu === true
        ? {
            gpu: {
              device: {
                limits: { maxTextureDimension2D: opts.textureLimit },
              },
            },
          }
        : {
            gl: {
              MAX_TEXTURE_SIZE: 0x0d33,
              getParameter: () => opts.textureLimit,
            },
          }),
  };
  const renderer = {
    worldRoot,
    virtualSize: { width: 800, height: 450 },
    application: {
      renderer: graphics,
      stage: {
        getLocalBounds: () => opts.bounds ?? { width: 320, height: 180 },
      },
    },
  };
  const engine = {
    inspector: { capture: { dataURL: contentDataUrl } },
    context: {
      tryResolve: (key: ServiceKey<unknown>) =>
        key.id === "renderer" ? renderer : undefined,
    },
  };

  return {
    canvas,
    contentDataUrl,
    engine: engine as unknown as Engine,
    extractCanvas,
    worldRoot,
  };
}

describe("captureLab", () => {
  it("uses Inspector capture for the content view", async () => {
    const { contentDataUrl, engine, extractCanvas } = stubEngine();

    const result = await captureLab(engine, "content");

    expect(result.dataUrl).toBe("data:image/png;base64,content");
    expect(contentDataUrl).toHaveBeenCalledOnce();
    expect(extractCanvas).not.toHaveBeenCalled();
  });

  it("extracts the camera view at the virtual resolution", async () => {
    const { canvas, engine, extractCanvas, worldRoot } = stubEngine();

    const result = await captureLab(engine, "camera");

    expect(result.dataUrl).toBe("data:image/png;base64,camera");
    expect(extractCanvas).toHaveBeenCalledOnce();
    const options = extractCanvas.mock.calls[0]?.[0];
    expect(options).toMatchObject({ target: worldRoot, resolution: 1 });
    expect(options?.frame).toEqual({ x: 0, y: 0, width: 800, height: 450 });
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
  });

  it("leaves the fit container out of a render group it was not in", async () => {
    const { engine, worldRoot } = stubEngine();

    await captureLab(engine, "camera");

    expect(worldRoot.disableRenderGroup).toHaveBeenCalledOnce();
    expect(worldRoot.renderGroup).toBeNull();
  });

  it("restores the render group when the extract throws", async () => {
    const { engine, worldRoot } = stubEngine({ extractThrows: true });

    await expect(captureLab(engine, "camera")).rejects.toThrow(
      "extract failed",
    );

    expect(worldRoot.renderGroup).toBeNull();
  });

  it("keeps a render group the fit container already had", async () => {
    const { engine, worldRoot } = stubEngine({ startsAsRenderGroup: true });

    await captureLab(engine, "camera");

    expect(worldRoot.disableRenderGroup).not.toHaveBeenCalled();
    expect(worldRoot.renderGroup).not.toBeNull();
  });

  it.each([
    ["over the limit on both sides", 2, 3_000, 2_500, 4_096, true, false],
    ["under the limit", 2, 1_000, 900, 4_096, false, false],
    ["with no readable limit", 2, 3_000, 2_500, undefined, false, false],
    ["over a WebGPU limit", 2, 3_000, 2_500, 4_096, true, true],
  ] as const)(
    "warns about a content capture %s",
    async (_case, resolution, width, height, textureLimit, warned, webGpu) => {
      const { engine } = stubEngine({
        bounds: { width, height },
        resolution,
        textureLimit,
        webGpu,
      });

      const result = await captureLab(engine, "content");

      expect(result.warnings.length > 0).toBe(warned);
      if (warned) {
        expect(result.warnings[0]).toContain(`${width * resolution}×`);
        expect(result.warnings[0]).toContain(String(textureLimit));
        expect(result.warnings[0]).toContain("camera view");
      }
    },
  );

  it("takes no warning from the camera view", async () => {
    const { engine } = stubEngine({
      bounds: { width: 9_000, height: 9_000 },
      textureLimit: 4_096,
    });

    const result = await captureLab(engine, "camera");

    expect(result.warnings).toEqual([]);
  });
});

import { BlurFilter, Container, Filter, Sprite, Texture } from "pixi.js";
import type * as PixiModule from "pixi.js";
import type {
  DisplayContainer,
  GraphicsCapabilities,
  RenderTargetOptions,
  RendererPlugin,
} from "@yagejs/renderer";
import { createMockScene } from "@yagejs/core";
import { describe, expect, it, vi } from "vitest";
import { LightingComposite, drawnBounceBlend } from "./LightingComposite.js";
import { LightingWorld } from "./LightingWorld.js";
import type { BounceLightOptions } from "./types.js";

interface BlurOptions {
  blendMode: string;
  strength: number;
  quality: number;
  resolution: number;
}

vi.mock("pixi.js", async (importOriginal) => {
  const actual = await importOriginal<typeof PixiModule>();
  // Pixi's blur compiles its shader programs as it is constructed, which needs
  // a canvas the test environment has not got.
  class TestBlurFilter extends actual.Filter {
    constructor(readonly options: BlurOptions) {
      super({});
    }
  }
  return { ...actual, BlurFilter: TestBlurFilter };
});

interface FakeTarget {
  needsRender: boolean;
  texture: Texture;
  source: DisplayContainer;
  options: RenderTargetOptions;
  invalidate: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  renderIfNeeded: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface Harness {
  renderer: RendererPlugin;
  parent: Container;
  source: Container;
  /** One entry per `createRenderTarget` call, in creation order. */
  targets: FakeTarget[];
}

/** A context snapshot whose only interesting field is min/max blending. */
function fakeCapabilities(blendMinMax: string): GraphicsCapabilities {
  return { blendMinMax } as unknown as GraphicsCapabilities;
}

function createHarness(blendMinMax = "supported"): Harness {
  const targets: FakeTarget[] = [];
  const renderer = {
    capabilities: fakeCapabilities(blendMinMax),
    createRenderTarget: vi.fn(
      (source: DisplayContainer, options: RenderTargetOptions) => {
        const target: FakeTarget = {
          needsRender: true,
          texture: Texture.EMPTY,
          source,
          options,
          invalidate: vi.fn(() => {
            target.needsRender = true;
          }),
          render: vi.fn(() => {
            target.needsRender = false;
          }),
          renderIfNeeded: vi.fn(() => {
            const pending = target.needsRender;
            target.needsRender = false;
            return pending;
          }),
          resize: vi.fn(),
          destroy: vi.fn(),
        };
        targets.push(target);
        return target;
      },
    ),
  } as unknown as RendererPlugin;
  return {
    renderer,
    parent: new Container(),
    source: new Container(),
    targets,
  };
}

/** Hand the harness the capability snapshot of a replacement context. */
function setCapabilities(harness: Harness, blendMinMax: string): void {
  (harness.renderer as { capabilities: GraphicsCapabilities }).capabilities =
    fakeCapabilities(blendMinMax);
}

/** A world the composite reports its drawn bounce blend to. */
function createWorld(): LightingWorld {
  const { scene } = createMockScene();
  return new LightingWorld(scene, { level: 0 });
}

function createComposite(
  harness: Harness,
  bounce: BounceLightOptions | null = null,
  world: LightingWorld = createWorld(),
): LightingComposite {
  return new LightingComposite(harness.renderer, {
    world,
    source: harness.source,
    parent: harness.parent,
    width: 800,
    height: 600,
    resolutionScale: 0.5,
    antialias: true,
    bounce,
    label: "lighting:cave",
  });
}

describe("LightingComposite", () => {
  it("multiplies one light buffer over the scene", () => {
    const harness = createHarness();
    createComposite(harness);

    expect(harness.targets).toHaveLength(1);
    expect(harness.targets[0]?.source).toBe(harness.source);
    expect(harness.targets[0]?.options).toEqual({
      width: 800,
      height: 600,
      resolutionScale: 0.5,
      antialias: true,
      clearColor: 0x000000,
      label: "lighting:cave",
      followResolution: true,
    });
    const overlay = harness.parent.children[0] as Sprite;
    expect(overlay.blendMode).toBe("multiply");
    expect(overlay.width).toBe(800);
    expect(overlay.height).toBe(600);
  });

  it("reports whether the light buffer was redrawn", () => {
    const harness = createHarness();
    const composite = createComposite(harness);
    const buffer = harness.targets[0];

    expect(composite.render()).toBe(true);

    buffer?.renderIfNeeded.mockReturnValue(false);
    expect(composite.render()).toBe(false);

    composite.invalidate();
    expect(buffer?.invalidate).toHaveBeenCalledTimes(1);
  });

  it("combines a blurred copy with the buffer when bounce is configured", () => {
    const harness = createHarness();
    createComposite(harness, { strength: 0.4, radius: 18 });

    expect(harness.targets).toHaveLength(2);
    const [buffer, bounced] = harness.targets;
    // The composed buffer matches the light buffer's size and density and
    // draws sprites, so it needs no antialiasing of its own.
    expect(bounced?.options).toEqual({
      width: 800,
      height: 600,
      resolutionScale: 0.5,
      clearColor: 0x000000,
      label: "lighting:cave:bounce",
      dependsOn: [buffer],
      followResolution: true,
    });
    const [sharp, blurred] = (bounced?.source.children ?? []) as Sprite[];
    expect(sharp?.texture).toBe(buffer?.texture);
    expect(blurred?.texture).toBe(buffer?.texture);
    expect(blurred?.alpha).toBe(0.4);
    const [filter] = blurred?.filters as Filter[];
    expect(filter).toBeInstanceOf(BlurFilter);
    // A radius in virtual pixels, scaled into the texels the blur works in.
    expect((filter as unknown as { options: BlurOptions }).options).toEqual({
      strength: 18 * 0.25,
      quality: 6,
      resolution: 0.25,
      blendMode: "max",
    });

    // The scene sees the composed buffer, not the raw light.
    const overlay = harness.parent.children[0] as Sprite;
    expect(overlay.texture).toBe(bounced?.texture);
  });

  it("recomposes the bounce pass only when the light buffer was redrawn", () => {
    const harness = createHarness();
    const composite = createComposite(harness, { strength: 0.4, radius: 18 });
    const [buffer, bounced] = harness.targets;

    composite.render();
    expect(bounced?.render).toHaveBeenCalledTimes(1);

    buffer?.renderIfNeeded.mockReturnValue(false);
    composite.render();
    expect(bounced?.render).toHaveBeenCalledTimes(1);
  });

  it("resizes every buffer and sprite with the viewport", () => {
    const harness = createHarness();
    const composite = createComposite(harness, { strength: 0.4, radius: 18 });

    composite.resize(400, 300);

    for (const target of harness.targets) {
      expect(target.resize).toHaveBeenCalledWith(400, 300);
    }
    const overlay = harness.parent.children[0] as Sprite;
    expect(overlay.width).toBe(400);
    expect(overlay.height).toBe(300);
    const [sharp] = (harness.targets[1]?.source.children ?? []) as Sprite[];
    expect(sharp?.width).toBe(400);
  });

  it("draws the blurred copy with the blend the bounce names", () => {
    const blendOf = (
      bounce: BounceLightOptions,
      blendMinMax = "supported",
    ): unknown => {
      const harness = createHarness(blendMinMax);
      createComposite(harness, bounce);
      const [, blurred] = (harness.targets[1]?.source.children ??
        []) as Sprite[];
      const [filter] = blurred?.filters as Filter[];
      return (filter as unknown as { options: BlurOptions }).options.blendMode;
    };

    // Pixi draws a filtered sprite with the filter's blend mode, so the
    // filter is what has to carry it.
    expect(blendOf({ strength: 0.4, radius: 18 })).toBe("max");
    expect(blendOf({ strength: 0.4, radius: 18, blend: "max" })).toBe("max");
    expect(blendOf({ strength: 0.4, radius: 18, blend: "mix" })).toBe("normal");

    // Where the context has no min/max blending, the brighter-of-the-two
    // blend is drawn as the mix.
    expect(blendOf({ strength: 0.4, radius: 18 }, "unsupported")).toBe(
      "normal",
    );
    expect(
      blendOf({ strength: 0.4, radius: 18, blend: "mix" }, "unsupported"),
    ).toBe("normal");
  });

  it("follows the blend of the context that replaced a lost one", () => {
    const harness = createHarness("unsupported");
    const world = createWorld();
    const composite = createComposite(
      harness,
      { strength: 0.4, radius: 18 },
      world,
    );
    const [, blurred] = (harness.targets[1]?.source.children ?? []) as Sprite[];
    const filter = (blurred?.filters as Filter[])[0] as Filter;
    expect(
      (filter as unknown as { options: BlurOptions }).options.blendMode,
    ).toBe("normal");
    expect(composite.bounceBlend).toBe("mix");
    expect(world._bounceBlend).toBe("mix");

    setCapabilities(harness, "supported");
    world._followGraphicsContext();

    expect(filter.blendMode).toBe("max");
    expect(composite.bounceBlend).toBe("max");
    expect(world._bounceBlend).toBe("max");
  });

  it("names the scene once where the bounce blend is substituted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const harness = createHarness("unsupported");
      const composite = createComposite(harness, { strength: 0.4, radius: 18 });
      composite._followGraphicsContext();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('drawn as "mix"');
    } finally {
      warn.mockRestore();
    }
  });

  it("reports which blend a context draws", () => {
    expect(drawnBounceBlend("max", fakeCapabilities("supported"))).toBe("max");
    expect(drawnBounceBlend("max", fakeCapabilities("unsupported"))).toBe(
      "mix",
    );
    expect(drawnBounceBlend("max", fakeCapabilities("unknown"))).toBe("mix");
    expect(drawnBounceBlend("mix", fakeCapabilities("supported"))).toBe("mix");
    expect(drawnBounceBlend("mix", fakeCapabilities("unsupported"))).toBe(
      "mix",
    );
  });

  it("keeps both buffers at the canvas texel density", () => {
    const harness = createHarness();
    createComposite(harness, { strength: 0.4, radius: 18 });

    expect(harness.targets).toHaveLength(2);
    for (const target of harness.targets) {
      expect(target.options.followResolution).toBe(true);
    }
  });

  it("rejects a bounce setting before it allocates a buffer", () => {
    const harness = createHarness();

    expect(() => createComposite(harness, { strength: 2, radius: 18 })).toThrow(
      "LightingComposite bounce strength",
    );
    expect(() =>
      createComposite(harness, { strength: 0.4, radius: 0 }),
    ).toThrow("LightingComposite bounce radius");
    expect(() =>
      createComposite(harness, {
        strength: 0.4,
        radius: 18,
        blend: "add" as never,
      }),
    ).toThrow(
      'LightingComposite bounce blend must be "max" or "mix", got "add".',
    );
    expect(harness.targets).toHaveLength(0);
  });

  it("releases both buffers and leaves the light source alone", () => {
    const harness = createHarness();
    const composite = createComposite(harness, { strength: 0.4, radius: 18 });

    composite.destroy();
    composite.destroy();

    for (const target of harness.targets) {
      expect(target.destroy).toHaveBeenCalledTimes(1);
    }
    expect(harness.parent.children).toHaveLength(0);
    expect(harness.source.destroyed).toBe(false);
  });
});

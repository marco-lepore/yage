// @vitest-environment happy-dom
import { Container, Texture } from "pixi.js";
import type { Mesh } from "pixi.js";
import { createMockScene, Transform, Vec2, Vec2Buffer } from "@yagejs/core";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type {
  CameraComponent,
  DisplayContainer,
  GraphicsBackend,
  GraphicsCapabilities,
  RenderTargetHandle,
  RendererPlugin,
  SceneRenderTree,
} from "@yagejs/renderer";
import { describe, expect, it, vi } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import { LightSource } from "./LightSource.js";
import { LightingWorld } from "./LightingWorld.js";
import { OverlayLightingRenderer } from "./OverlayLightingRenderer.js";
import {
  ShaderLightingRenderer,
  shaderLighting,
} from "./ShaderLightingRenderer.js";
import { LightingWorldKey } from "./types.js";
import type {
  LightingRenderer,
  LightingRendererContext,
  LightingRenderFrame,
  LightOccluderShape,
} from "./types.js";

const VIEWPORT = { width: 800, height: 600 };

interface Harness {
  scene: ReturnType<typeof createMockScene>["scene"];
  world: LightingWorld;
  renderer: RendererPlugin;
  invalidate: ReturnType<typeof vi.fn>;
  resizeTarget: ReturnType<typeof vi.fn>;
  offscreen: () => DisplayContainer;
  tree: SceneRenderTree;
  context: () => LightingRendererContext;
  /** Objects the link test has not deleted, and how often it ran. */
  live: () => { shaders: number; programs: number; linkTests: number };
}

/** What the graphics context under a harness reports and does. */
interface HarnessOptions {
  readonly backend?: GraphicsBackend;
  readonly contextLost?: boolean;
  /** Whether the fake driver links the light program. */
  readonly links?: boolean;
  /** What the fake driver says when it does not. */
  readonly log?: string;
}

/** A WebGL context that records what a link test asked of it. */
function fakeGl(options: HarnessOptions): Record<string, unknown> {
  const live = { shaders: 0, programs: 0, linkTests: 0 };
  return {
    live,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    createShader: () => {
      live.shaders++;
      return {};
    },
    createProgram: () => {
      live.programs++;
      live.linkTests++;
      return {};
    },
    shaderSource: () => {},
    compileShader: () => {},
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => options.links !== false,
    getProgramInfoLog: () => options.log ?? "",
    getShaderInfoLog: () => "",
    deleteShader: () => {
      live.shaders--;
    },
    deleteProgram: () => {
      live.programs--;
    },
  };
}

function createHarness(options: HarnessOptions = {}): Harness {
  const { scene } = createMockScene();
  const layerContainer = new Container();
  const tree = {
    ensureLayer: vi.fn(() => ({
      name: "lighting",
      space: "screen",
      container: layerContainer,
    })),
  } as unknown as SceneRenderTree;
  scene.registerScoped(SceneRenderTreeKey, tree);

  const invalidate = vi.fn();
  const resizeTarget = vi.fn();
  const target = {
    texture: Texture.EMPTY,
    invalidate,
    renderIfNeeded: vi.fn(() => true),
    render: vi.fn(),
    resize: resizeTarget,
    destroy: vi.fn(),
  } as unknown as RenderTargetHandle;
  let offscreenSource: DisplayContainer | undefined;
  const backend = options.backend ?? "webgl2";
  const gl = fakeGl(options);
  // Frozen and new per harness, as the renderer reads one per context.
  const capabilities = Object.freeze({
    backend,
    maxTextureSize: 8192,
    maxRenderTargetSize: 8192,
    maxViewportWidth: 8192,
    maxViewportHeight: 8192,
    maxSamples: backend === "webgl1" ? 0 : 4,
    highpFragment: "supported",
    blendMinMax: backend === "webgl1" ? "unsupported" : "supported",
    rgba16float: Object.freeze({
      sample: "supported",
      filter: "supported",
      render: "supported",
    }),
    rgba32float: Object.freeze({
      sample: "supported",
      filter: "supported",
      render: "supported",
    }),
  }) as GraphicsCapabilities;
  const renderer = {
    virtualSize: VIEWPORT,
    capabilities,
    contextLost: options.contextLost ?? false,
    application: { renderer: { gl } },
    createRenderTarget: vi.fn((source: DisplayContainer) => {
      offscreenSource ??= source;
      return target;
    }),
  } as unknown as RendererPlugin;

  const world = new LightingWorld(scene, { level: 0 });
  scene.registerScoped(LightingWorldKey, world);

  return {
    scene,
    world,
    renderer,
    tree,
    invalidate,
    resizeTarget,
    offscreen: () => {
      if (!offscreenSource) throw new Error("render target was never created");
      return offscreenSource;
    },
    context: () => ({
      scene: world.scene,
      world,
      renderer,
      bounce: null,
    }),
    live: () =>
      gl["live"] as { shaders: number; programs: number; linkTests: number },
  };
}

function createRenderer(harness: Harness): ShaderLightingRenderer {
  return new ShaderLightingRenderer(harness.context());
}

/** A camera that maps world coordinates straight onto the viewport. */
function createCamera(): CameraComponent {
  return {
    zoom: 1,
    effectiveZoom: 1,
    effectiveRotation: 0,
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
    getEffectivePositionInto: (out: Vec2Buffer) => out.set(400, 300),
    worldToScreenInto: (out: Vec2Buffer, x: number, y: number) => out.set(x, y),
  } as unknown as CameraComponent;
}

const FRAME: LightingRenderFrame = {
  camera: null,
  width: VIEWPORT.width,
  height: VIEWPORT.height,
};

function frameWithCamera(): LightingRenderFrame {
  return {
    camera: createCamera(),
    width: VIEWPORT.width,
    height: VIEWPORT.height,
  };
}

function addLight(
  world: LightingWorld,
  options: {
    x: number;
    y: number;
    radius: number;
    size?: number;
    castShadows?: boolean;
  },
): LightSource {
  const entity = world.scene.spawn("light");
  entity.add(new Transform({ position: new Vec2(options.x, options.y) }));
  return entity.add(
    new LightSource({
      radius: options.radius,
      intensity: 0.8,
      color: 0xff8844,
      size: options.size ?? 24,
      ...(options.castShadows === undefined
        ? {}
        : { castShadows: options.castShadows }),
    }),
  );
}

function addOccluder(
  world: LightingWorld,
  shape: LightOccluderShape,
  x: number,
  y: number,
): LightOccluder {
  const entity = world.scene.spawn("occluder");
  entity.add(new Transform({ position: new Vec2(x, y) }));
  return entity.add(new LightOccluder({ shape }));
}

/** The container a renderer puts its light quads in, under the camera. */
function lightsContainer(harness: Harness): Container {
  const lights = harness.offscreen().children[1];
  if (!lights) throw new Error("the lights container is missing");
  return lights as Container;
}

/** The light quads a renderer put in the container it draws into. */
function meshes(harness: Harness): Mesh[] {
  return lightsContainer(harness).children as Mesh[];
}

/** Every uniform one quad reads. */
function uniforms(mesh: Mesh): {
  uLightColor: Float32Array;
  uReach: Float32Array;
  uCone: Float32Array;
  uEdgeSpan: Float32Array;
} {
  const group = mesh.shader?.resources["lightUniforms"] as {
    uniforms: {
      uLightColor: Float32Array;
      uReach: Float32Array;
      uCone: Float32Array;
      uEdgeSpan: Float32Array;
    };
  };
  return group.uniforms;
}

/** One quad's run: first texel, edges, discs, outlines the lamp reaches into. */
function span(mesh: Mesh): number[] {
  return Array.from(uniforms(mesh).uEdgeSpan);
}

describe("ShaderLightingRenderer", () => {
  it("draws one quad per light and drops it when the light leaves", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    const first = addLight(harness.world, { x: 100, y: 100, radius: 120 });
    addLight(harness.world, { x: 300, y: 200, radius: 120 });

    renderer.render(FRAME);
    expect(meshes(harness)).toHaveLength(2);

    harness.world.unregisterSource(first);
    renderer.render(FRAME);
    expect(meshes(harness)).toHaveLength(1);
    renderer.destroy();
  });

  it("gives a light the edges of the walls in its reach", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      140,
      100,
    );
    addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      600,
      500,
    );

    renderer.render(FRAME);

    // The near wall's four edges; the far one is out of reach.
    expect(span(meshes(harness)[0]!)).toEqual([0, 4, 0, 0]);
    renderer.destroy();
  });

  it("gives a light a circle as one disc rather than as edges", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    addOccluder(harness.world, { type: "circle", radius: 15 }, 150, 100);

    renderer.render(FRAME);

    expect(span(meshes(harness)[0]!)).toEqual([0, 0, 1, 0]);
    renderer.destroy();
  });

  it("leaves out an occluder that holds the light", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    addOccluder(
      harness.world,
      { type: "box", width: 40, height: 40 },
      100,
      100,
    );

    renderer.render(FRAME);

    expect(span(meshes(harness)[0]!)).toEqual([0, 0, 0, 0]);
    renderer.destroy();
  });

  it("leaves out every occluder for a light that ignores them", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, {
      x: 100,
      y: 100,
      radius: 120,
      castShadows: false,
    });
    addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      140,
      100,
    );

    renderer.render(FRAME);

    expect(span(meshes(harness)[0]!)).toEqual([0, 0, 0, 0]);
    renderer.destroy();
  });

  it("packs the lights' runs one after another", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    addLight(harness.world, { x: 300, y: 300, radius: 120 });
    addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      140,
      100,
    );
    addOccluder(harness.world, { type: "circle", radius: 15 }, 340, 300);

    renderer.render(FRAME);

    expect(span(meshes(harness)[0]!)).toEqual([0, 4, 0, 0]);
    expect(span(meshes(harness)[1]!)).toEqual([4, 0, 1, 0]);
    renderer.destroy();
  });

  it("leaves a light the viewport misses out of the buffer", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    const away = addLight(harness.world, { x: 5000, y: 5000, radius: 120 });
    addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      5040,
      5000,
    );

    renderer.render(frameWithCamera());

    const [near, far] = meshes(harness);
    expect(near?.visible).toBe(true);
    expect(far?.visible).toBe(false);
    expect(span(far!)).toEqual([0, 0, 0, 0]);

    // It comes back with its edges once it reaches the viewport again.
    away.entity.get(Transform).setPosition(300, 300);
    renderer.render(frameWithCamera());
    expect(meshes(harness)[1]?.visible).toBe(true);
    renderer.destroy();
  });

  it("redraws the light buffer only when something changed", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    const light = addLight(harness.world, { x: 100, y: 100, radius: 120 });

    renderer.render(FRAME);
    harness.invalidate.mockClear();

    renderer.render(FRAME);
    expect(harness.invalidate).not.toHaveBeenCalled();

    light.radius = 160;
    renderer.render(FRAME);
    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it("redraws when an occluder moves", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    const wall = addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      140,
      100,
    );

    renderer.render(FRAME);
    harness.invalidate.mockClear();

    wall.entity.get(Transform).setPosition(150, 100);
    renderer.render(FRAME);
    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it("hides a pixel inside an outline the lamp reaches into", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    // The lamp's half-width is 12 and the wall's near face is 6 away, so part
    // of the lamp sits inside the wall.
    addLight(harness.world, { x: 100, y: 100, radius: 120, size: 24 });
    addOccluder(
      harness.world,
      { type: "box", width: 40, height: 200 },
      126,
      100,
    );

    renderer.render(FRAME);

    // Four edges, no discs, and the wall listed as an outline to test against.
    expect(span(meshes(harness)[0]!)).toEqual([0, 4, 0, 1]);
    renderer.destroy();
  });

  it("leaves out an outline the lamp stops short of", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120, size: 24 });
    addOccluder(
      harness.world,
      { type: "box", width: 40, height: 200 },
      160,
      100,
    );

    renderer.render(FRAME);

    expect(span(meshes(harness)[0]!)).toEqual([0, 4, 0, 0]);
    renderer.destroy();
  });

  it("writes the lamp's half-width, its colour and its cone", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    const light = addLight(harness.world, {
      x: 100,
      y: 100,
      radius: 120,
      size: 30,
    });

    renderer.render(FRAME);
    const values = uniforms(meshes(harness)[0]!);

    expect(Array.from(values.uReach)).toEqual([120, 15]);
    // 0xff8844 at intensity 0.8.
    expect(values.uLightColor[0]).toBeCloseTo(0.8, 6);
    expect(values.uLightColor[1]).toBeCloseTo((0x88 / 255) * 0.8, 6);
    expect(values.uLightColor[2]).toBeCloseTo((0x44 / 255) * 0.8, 6);
    // A light reaching every direction is marked with cosines no direction
    // can fall short of.
    expect(Array.from(values.uCone)).toEqual([1, 0, -2, -2]);

    light.coneAngle = Math.PI / 2;
    light.coneSoftness = 0.5;
    light.entity.get(Transform).setRotation(Math.PI / 2);
    renderer.render(FRAME);

    expect(values.uCone[0]).toBeCloseTo(0, 6);
    expect(values.uCone[1]).toBeCloseTo(1, 6);
    expect(values.uCone[2]).toBeCloseTo(Math.cos(Math.PI / 4), 6);
    expect(values.uCone[3]).toBeCloseTo(Math.cos(Math.PI / 8), 6);
    renderer.destroy();
  });

  it("puts the light quads under the camera's own transform", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });

    renderer.render(frameWithCamera());

    const lights = lightsContainer(harness);
    expect(lights.pivot.x).toBe(400);
    expect(lights.pivot.y).toBe(300);
    expect(lights.scale.x).toBe(1);
    expect(lights.rotation).toBe(0);
    expect(lights.position.x).toBe(VIEWPORT.width / 2);
    expect(lights.position.y).toBe(VIEWPORT.height / 2);

    const mesh = meshes(harness)[0]!;
    expect(mesh.position.x).toBe(100);
    expect(mesh.scale.x).toBe(120);
    renderer.destroy();
  });

  it("resizes its buffer with the viewport", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });

    renderer.render(FRAME);
    harness.resizeTarget.mockClear();
    renderer.render({ camera: null, width: 1024, height: 768 });

    expect(harness.resizeTarget).toHaveBeenCalledWith(1024, 768);
    renderer.destroy();
  });

  it("moves a later light's run when an earlier one changes length", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    addLight(harness.world, { x: 100, y: 100, radius: 120 });
    addLight(harness.world, { x: 400, y: 400, radius: 120 });
    const near = addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      140,
      100,
    );
    addOccluder(
      harness.world,
      { type: "box", width: 20, height: 20 },
      440,
      400,
    );

    renderer.render(FRAME);
    expect(span(meshes(harness)[1]!)).toEqual([4, 4, 0, 0]);

    // Take the first light's wall out of its reach; the second light's run
    // starts where that wall's edges were.
    near.entity.get(Transform).setPosition(140, 900);
    renderer.render(FRAME);
    expect(span(meshes(harness)[0]!)).toEqual([0, 0, 0, 0]);
    expect(span(meshes(harness)[1]!)).toEqual([0, 4, 0, 0]);
    renderer.destroy();
  });

  it("redraws nothing when a light outside the view moves", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    const away = addLight(harness.world, { x: 5000, y: 5000, radius: 120 });

    renderer.render(frameWithCamera());
    harness.invalidate.mockClear();

    away.entity.get(Transform).setPosition(6000, 6000);
    renderer.render(frameWithCamera());
    expect(harness.invalidate).not.toHaveBeenCalled();
    renderer.destroy();
  });

  it("redraws nothing when a light with no cone turns", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    const light = addLight(harness.world, { x: 100, y: 100, radius: 120 });

    renderer.render(FRAME);
    harness.invalidate.mockClear();

    light.entity.get(Transform).setRotation(Math.PI / 3);
    renderer.render(FRAME);
    expect(harness.invalidate).not.toHaveBeenCalled();

    // A cone does point somewhere, so turning it redraws.
    light.coneAngle = Math.PI / 2;
    renderer.render(FRAME);
    harness.invalidate.mockClear();
    light.entity.get(Transform).setRotation(Math.PI / 2);
    renderer.render(FRAME);
    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  it("refuses a scene with no render tree", () => {
    const { scene } = createMockScene();
    const world = new LightingWorld(scene, { level: 0 });
    expect(
      () =>
        new ShaderLightingRenderer({
          scene,
          world,
          renderer: { virtualSize: VIEWPORT } as unknown as RendererPlugin,
          bounce: null,
        }),
    ).toThrow(/has no render tree/);
  });

  it("refuses a resolution scale of zero", () => {
    const harness = createHarness();
    expect(
      () =>
        new ShaderLightingRenderer(
          {
            scene: harness.world.scene,
            world: harness.world,
            renderer: harness.renderer,
            bounce: null,
          },
          { resolutionScale: 0 },
        ),
    ).toThrow(/resolutionScale/);
  });

  it("refuses to render after it is destroyed", () => {
    const harness = createHarness();
    const renderer = createRenderer(harness);
    renderer.destroy();
    expect(() => renderer.render(FRAME)).toThrow(/after destroy/);
  });
});

describe("shaderLighting chooses what can draw the scene", () => {
  it("builds the given fallback on a WebGL 1 context and records why", () => {
    const harness = createHarness({ backend: "webgl1" });
    const backend: LightingRenderer = { render: vi.fn(), destroy: vi.fn() };
    const fallback = vi.fn(() => backend);

    const built = shaderLighting({ fallback })(harness.context());

    expect(built).toBe(backend);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(harness.renderer.createRenderTarget).not.toHaveBeenCalled();
    expect(harness.world._fallbackRecord).toEqual({
      reason: "webgl1",
      detail: null,
    });
  });

  it("draws a WebGL 1 context with the overlay renderer when no fallback is given", () => {
    const harness = createHarness({ backend: "webgl1" });

    const built = shaderLighting({
      layer: "lights",
      order: 42,
      resolutionScale: 0.25,
    })(harness.context());

    expect(built).toBeInstanceOf(OverlayLightingRenderer);
    expect(harness.tree.ensureLayer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "lights", order: 42 }),
      expect.anything(),
    );
    expect(harness.renderer.createRenderTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolutionScale: 0.25 }),
    );
    built.destroy();
  });

  it("leaves the texel density to the overlay's own default when the shader options set none", () => {
    const harness = createHarness({ backend: "webgl1" });

    const built = shaderLighting()(harness.context());

    expect(harness.renderer.createRenderTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolutionScale: 0.5 }),
    );
    built.destroy();
  });

  it("builds the shader renderer where the driver links its program", () => {
    const harness = createHarness();
    const fallback = vi.fn();

    const built = shaderLighting({ fallback })(harness.context());

    expect(built).toBeInstanceOf(ShaderLightingRenderer);
    expect(fallback).not.toHaveBeenCalled();
    expect(harness.live()).toMatchObject({ shaders: 0, programs: 0 });
    built.destroy();
  });

  it("falls back where the driver refuses the program, keeping its log", () => {
    const harness = createHarness({ links: false, log: "  boom  " });
    const backend: LightingRenderer = { render: vi.fn(), destroy: vi.fn() };
    const fallback = vi.fn(() => backend);

    const built = shaderLighting({ fallback })(harness.context());

    expect(built).toBe(backend);
    expect(harness.world._fallbackRecord).toEqual({
      reason: "shader-rejected",
      detail: "boom",
    });
    expect(harness.live()).toMatchObject({ shaders: 0, programs: 0 });
  });

  it("tests one program per graphics context", () => {
    const harness = createHarness();
    const first = shaderLighting()(harness.context());
    const second = shaderLighting()(harness.context());

    expect(harness.live().linkTests).toBe(1);
    first.destroy();
    second.destroy();

    // A replacement context brings its own snapshot, so it is tested again.
    const replaced = createHarness({ links: false });
    const third = shaderLighting()(replaced.context());
    expect(replaced.live().linkTests).toBe(1);
    expect(third).toBeInstanceOf(OverlayLightingRenderer);
    third.destroy();
  });

  it("builds the shader renderer while the context is lost, which compiles nothing", () => {
    const harness = createHarness({ contextLost: true, links: false });

    const built = shaderLighting()(harness.context());

    expect(built).toBeInstanceOf(ShaderLightingRenderer);
    expect(harness.world._fallbackRecord).toBeNull();
    built.destroy();
  });

  it("builds the shader renderer on a WebGPU device, which it does not test", () => {
    const harness = createHarness({ backend: "webgpu", links: false });

    const built = shaderLighting()(harness.context());

    expect(built).toBeInstanceOf(ShaderLightingRenderer);
    expect(harness.world._fallbackRecord).toBeNull();
    built.destroy();
  });
});

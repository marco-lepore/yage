import { Container, Graphics, Texture } from "pixi.js";
import { createMockScene, Transform, Vec2, Vec2Buffer } from "@yagejs/core";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type * as RendererModule from "@yagejs/renderer";
import type {
  CameraComponent,
  DisplayContainer,
  RenderTargetHandle,
  RendererPlugin,
  SceneRenderTree,
} from "@yagejs/renderer";
import { describe, expect, it, vi } from "vitest";
import { LightOccluder } from "./LightOccluder.js";
import { LightSource } from "./LightSource.js";
import { LightingWorld } from "./LightingWorld.js";
import { OverlayLightingRenderer } from "./OverlayLightingRenderer.js";
import { LightingWorldKey } from "./types.js";
import type { LightOccluderShape } from "./types.js";

vi.mock("@yagejs/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof RendererModule>();
  return {
    ...actual,
    radialGradient: () => ({
      color: 0xffffff,
      alpha: 1,
      destroy: vi.fn(),
    }),
  };
});

interface Harness {
  scene: ReturnType<typeof createMockScene>["scene"];
  world: LightingWorld;
  renderer: RendererPlugin;
  layerContainer: Container;
  invalidate: ReturnType<typeof vi.fn>;
  renderIfNeeded: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  destroyTarget: ReturnType<typeof vi.fn>;
  offscreen: () => DisplayContainer;
}

function createHarness(ambientLevel = 0.2): Harness {
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
  const renderIfNeeded = vi.fn(() => true);
  const resize = vi.fn();
  const destroyTarget = vi.fn();
  const target = {
    texture: Texture.EMPTY,
    invalidate,
    renderIfNeeded,
    resize,
    destroy: destroyTarget,
  } as unknown as RenderTargetHandle;
  let offscreenSource: DisplayContainer | undefined;
  const renderer = {
    virtualSize: { width: 800, height: 600 },
    createRenderTarget: vi.fn((source: DisplayContainer) => {
      offscreenSource = source;
      return target;
    }),
  } as unknown as RendererPlugin;

  const world = new LightingWorld(scene, { level: ambientLevel });
  scene.registerScoped(LightingWorldKey, world);

  return {
    scene,
    world,
    renderer,
    layerContainer,
    invalidate,
    renderIfNeeded,
    resize,
    destroyTarget,
    offscreen: () => {
      if (!offscreenSource) throw new Error("render target was never created");
      return offscreenSource;
    },
  };
}

/** A camera whose world-to-screen projection is a fixed translation. */
function createCamera(rotation = 0): CameraComponent {
  return {
    zoom: 2,
    effectiveZoom: 2,
    effectiveRotation: rotation,
    viewportWidth: 800,
    viewportHeight: 600,
    getEffectivePositionInto: (out: Vec2Buffer) => out.set(0, 0),
    worldToScreenInto: vi.fn((out: Vec2Buffer) => out.set(44, 55)),
  } as unknown as CameraComponent;
}

function addLight(
  world: LightingWorld,
  options: {
    x: number;
    y: number;
    radius: number;
    intensity?: number;
    cone?: number;
    castShadows?: boolean;
  },
): LightSource {
  const entity = world.scene.spawn("light");
  entity.add(new Transform({ position: new Vec2(options.x, options.y) }));
  return entity.add(
    new LightSource({
      radius: options.radius,
      intensity: options.intensity ?? 0.8,
      color: 0xff8844,
      ...(options.cone === undefined ? {} : { cone: { angle: options.cone } }),
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

function addWall(
  world: LightingWorld,
  options: { x: number; y: number; width: number; height: number },
): LightOccluder {
  return addOccluder(
    world,
    { type: "box", width: options.width, height: options.height },
    options.x,
    options.y,
  );
}

interface MaskComparison {
  /** Points the query calls dark that the mask leaves lit. */
  readonly missingShadow: string[];
  /** Points the query calls lit, away from the edge, that the mask covers. */
  readonly falseShadow: string[];
  /** How many sampled points the query calls dark. */
  readonly blocked: number;
}

/**
 * Compare the drawn mask with the query over a grid of points inside one
 * light, with ambient light at zero so a level of `0` means blocked. Points
 * within a pixel of the shadow's edge are left out of the lit direction,
 * where the drawn boundary and the sampled one disagree below a pixel.
 */
function compareMaskWithQuery(
  world: LightingWorld,
  shadows: Graphics,
  light: { x: number; y: number; radius: number },
  step: number,
): MaskComparison {
  const missingShadow: string[] = [];
  const falseShadow: string[] = [];
  let blocked = 0;
  for (let y = light.y - light.radius; y < light.y + light.radius; y += step) {
    for (
      let x = light.x - light.radius;
      x < light.x + light.radius;
      x += step
    ) {
      const dx = x - light.x;
      const dy = y - light.y;
      if (dx * dx + dy * dy >= light.radius * light.radius) continue;
      const masked = shadows.containsPoint({ x, y });
      if (world.levelAt(x, y) === 0) {
        blocked++;
        if (!masked) missingShadow.push(`${x},${y}`);
        continue;
      }
      const nearEdge =
        world.levelAt(x - 1, y) === 0 ||
        world.levelAt(x + 1, y) === 0 ||
        world.levelAt(x, y - 1) === 0 ||
        world.levelAt(x, y + 1) === 0;
      if (!nearEdge && masked) falseShadow.push(`${x},${y}`);
    }
  }
  return { missingShadow, falseShadow, blocked };
}

/** Render one shape's shadow and return the mask the renderer built for it. */
function renderShadowMask(
  harness: Harness,
  shape: LightOccluderShape,
  occluderX: number,
  occluderY: number,
): Graphics {
  addOccluder(harness.world, shape, occluderX, occluderY);
  const backend = new OverlayLightingRenderer({
    scene: harness.scene,
    world: harness.world,
    renderer: harness.renderer,
    bounce: null,
  });
  backend.render({ camera: null, width: 800, height: 600 });
  const container = lightContainer(harness);
  const shadows = container.children[1] as Graphics;
  expect(container.mask).toBe(shadows);
  return shadows;
}

/** The per-light container the renderer parents under the offscreen source. */
function lightContainer(harness: Harness, index = 0): Container {
  // Child 0 is the ambient fill; one container follows per light.
  return harness.offscreen().children[index + 1] as Container;
}

describe("OverlayLightingRenderer", () => {
  it("projects lights through the camera and redraws only after visual changes", () => {
    const harness = createHarness();
    const light = addLight(harness.world, { x: 120, y: 80, radius: 30 });

    const backend = new OverlayLightingRenderer({
      scene: harness.scene,
      world: harness.world,
      renderer: harness.renderer,
      bounce: null,
    });
    const camera = createCamera();
    const frame = { camera, width: 800, height: 600 };

    backend.render(frame);

    expect(camera.worldToScreenInto).toHaveBeenCalledWith(
      expect.any(Vec2Buffer),
      120,
      80,
    );
    expect(harness.offscreen().children).toHaveLength(2);
    const lightGraphic = lightContainer(harness).children[0];
    expect(lightGraphic?.position.x).toBe(44);
    expect(lightGraphic?.position.y).toBe(55);
    expect(lightGraphic?.width).toBe(120);
    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    expect(harness.renderIfNeeded).toHaveBeenCalledTimes(1);

    backend.render(frame);
    expect(harness.invalidate).toHaveBeenCalledTimes(1);
    expect(harness.renderIfNeeded).toHaveBeenCalledTimes(2);

    light.radius = 40;
    backend.render(frame);
    expect(lightGraphic?.width).toBe(160);
    expect(harness.invalidate).toHaveBeenCalledTimes(2);

    light.enabled = false;
    backend.render(frame);
    expect(harness.offscreen().children).toHaveLength(1);
    expect(harness.invalidate).toHaveBeenCalledTimes(3);

    backend.render({ camera, width: 1024, height: 576 });
    expect(harness.resize).toHaveBeenCalledWith(1024, 576);
    expect(harness.invalidate).toHaveBeenCalledTimes(4);

    backend.destroy();
    expect(harness.destroyTarget).toHaveBeenCalledTimes(1);
    expect(harness.layerContainer.children).toHaveLength(0);
  });

  it("masks a light with the region its occluders hide", () => {
    const harness = createHarness();
    addLight(harness.world, { x: 0, y: 0, radius: 400 });
    addWall(harness.world, { x: 100, y: 0, width: 20, height: 100 });

    const backend = new OverlayLightingRenderer({
      scene: harness.scene,
      world: harness.world,
      renderer: harness.renderer,
      bounce: null,
    });
    backend.render({ camera: null, width: 800, height: 600 });

    const container = lightContainer(harness);
    const shadows = container.children[1] as Graphics;
    expect(container.mask).toBe(shadows);
    // Straight behind the wall, and beside it at the same distance.
    expect(shadows.containsPoint({ x: 300, y: 0 })).toBe(true);
    expect(shadows.containsPoint({ x: 300, y: 300 })).toBe(false);

    backend.destroy();
  });

  it("redraws a light's mask when an occluder moves and drops it when the occluder leaves", () => {
    const harness = createHarness();
    addLight(harness.world, { x: 0, y: 0, radius: 400 });
    const wall = addWall(harness.world, {
      x: 100,
      y: 0,
      width: 20,
      height: 100,
    });

    const backend = new OverlayLightingRenderer({
      scene: harness.scene,
      world: harness.world,
      renderer: harness.renderer,
      bounce: null,
    });
    const frame = { camera: null, width: 800, height: 600 };
    backend.render(frame);
    const shadows = lightContainer(harness).children[1] as Graphics;
    const invalidations = harness.invalidate.mock.calls.length;

    backend.render(frame);
    expect(harness.invalidate).toHaveBeenCalledTimes(invalidations);

    wall.entity.get(Transform).setPosition(100, 250);
    backend.render(frame);
    expect(harness.invalidate).toHaveBeenCalledTimes(invalidations + 1);
    expect(shadows.containsPoint({ x: 300, y: 0 })).toBe(false);
    // Past the wall's new place, on the ray through it from the light.
    expect(shadows.containsPoint({ x: 120, y: 300 })).toBe(true);

    wall.enabled = false;
    backend.render(frame);
    expect(lightContainer(harness).mask).toBeUndefined();

    backend.destroy();
  });

  it("covers every point the query blocks behind a wide near wall", () => {
    const harness = createHarness(0);
    const light = { x: 0, y: 0, radius: 200 };
    addLight(harness.world, { ...light, intensity: 1 });
    const shadows = renderShadowMask(
      harness,
      { type: "box", width: 20, height: 200 },
      40,
      0,
    );

    const comparison = compareMaskWithQuery(harness.world, shadows, light, 5);
    expect(comparison.blocked).toBeGreaterThan(100);
    expect(comparison.missingShadow).toEqual([]);
    expect(comparison.falseShadow).toEqual([]);
  });

  it("covers every point the query blocks behind a circle", () => {
    const harness = createHarness(0);
    const light = { x: 0, y: 0, radius: 200 };
    addLight(harness.world, { ...light, intensity: 1 });
    const shadows = renderShadowMask(
      harness,
      { type: "circle", radius: 40 },
      60,
      0,
    );

    const comparison = compareMaskWithQuery(harness.world, shadows, light, 5);
    expect(comparison.blocked).toBeGreaterThan(100);
    expect(comparison.missingShadow).toEqual([]);
    expect(comparison.falseShadow).toEqual([]);
  });

  it("covers every point the query blocks behind a concave polygon", () => {
    const harness = createHarness(0);
    const light = { x: 0, y: 0, radius: 220 };
    addLight(harness.world, { ...light, intensity: 1 });
    const shadows = renderShadowMask(
      harness,
      {
        type: "polygon",
        vertices: [
          { x: -40, y: -40 },
          { x: 40, y: -40 },
          { x: 40, y: 40 },
          { x: 0, y: 0 },
          { x: -40, y: 40 },
        ],
      },
      60,
      0,
    );

    const comparison = compareMaskWithQuery(harness.world, shadows, light, 5);
    expect(comparison.blocked).toBeGreaterThan(100);
    expect(comparison.missingShadow).toEqual([]);
    expect(comparison.falseShadow).toEqual([]);
  });

  it("draws a cone as a pie slice turned by its entity", () => {
    const harness = createHarness();
    const light = addLight(harness.world, {
      x: 0,
      y: 0,
      radius: 100,
      cone: Math.PI / 2,
    });

    const backend = new OverlayLightingRenderer({
      scene: harness.scene,
      world: harness.world,
      renderer: harness.renderer,
      bounce: null,
    });
    const frame = { camera: null, width: 800, height: 600 };
    backend.render(frame);

    const graphic = lightContainer(harness).children[0] as Graphics;
    expect(graphic.rotation).toBe(0);
    // The slice spans a quarter turn around the direction the entity faces.
    expect(graphic.containsPoint({ x: 60, y: 0 })).toBe(true);
    expect(graphic.containsPoint({ x: 60, y: 40 })).toBe(true);
    expect(graphic.containsPoint({ x: 0, y: 60 })).toBe(false);
    expect(graphic.containsPoint({ x: -60, y: 0 })).toBe(false);

    const invalidations = harness.invalidate.mock.calls.length;
    light.entity.get(Transform).setRotation(Math.PI);
    backend.render(frame);
    expect(graphic.rotation).toBeCloseTo(Math.PI);
    expect(harness.invalidate).toHaveBeenCalledTimes(invalidations + 1);

    light.coneAngle = Math.PI * 2;
    backend.render(frame);
    expect(graphic.rotation).toBe(0);
    expect(graphic.containsPoint({ x: -60, y: 0 })).toBe(true);

    backend.destroy();
  });

  it("turns a cone back by the camera's own rotation", () => {
    const harness = createHarness();
    const light = addLight(harness.world, {
      x: 0,
      y: 0,
      radius: 100,
      cone: Math.PI / 2,
    });
    light.entity.get(Transform).setRotation(Math.PI / 2);

    const backend = new OverlayLightingRenderer({
      scene: harness.scene,
      world: harness.world,
      renderer: harness.renderer,
      bounce: null,
    });
    // The camera turns the whole scene, so a lamp facing a fixed world
    // direction points somewhere else on screen.
    backend.render({
      camera: createCamera(Math.PI / 6),
      width: 800,
      height: 600,
    });

    const graphic = lightContainer(harness).children[0] as Graphics;
    expect(graphic.rotation).toBeCloseTo(Math.PI / 2 - Math.PI / 6);

    backend.render({
      camera: createCamera(Math.PI / 2),
      width: 800,
      height: 600,
    });
    expect(graphic.rotation).toBeCloseTo(0);

    backend.destroy();
  });

  it("leaves a light unmasked while it ignores shadows", () => {
    const harness = createHarness();
    const light = addLight(harness.world, {
      x: 0,
      y: 0,
      radius: 400,
      castShadows: false,
    });
    addWall(harness.world, { x: 100, y: 0, width: 20, height: 100 });

    const backend = new OverlayLightingRenderer({
      scene: harness.scene,
      world: harness.world,
      renderer: harness.renderer,
      bounce: null,
    });
    const frame = { camera: null, width: 800, height: 600 };
    backend.render(frame);
    expect(lightContainer(harness).mask).toBeUndefined();

    light.castShadows = true;
    backend.render(frame);
    expect(lightContainer(harness).mask).toBeInstanceOf(Graphics);

    backend.destroy();
  });
});

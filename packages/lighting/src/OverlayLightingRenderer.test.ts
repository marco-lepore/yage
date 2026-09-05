import { Container, Texture } from "pixi.js";
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
import { LightSource } from "./LightSource.js";
import { LightingWorld } from "./LightingWorld.js";
import { OverlayLightingRenderer } from "./OverlayLightingRenderer.js";
import { LightingWorldKey } from "./types.js";

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

describe("OverlayLightingRenderer", () => {
  it("projects lights through the camera and redraws only after visual changes", () => {
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

    const world = new LightingWorld(scene, { level: 0.2 });
    scene.registerScoped(LightingWorldKey, world);
    const lightEntity = scene.spawn("light");
    lightEntity.add(new Transform({ position: new Vec2(120, 80) }));
    const light = lightEntity.add(
      new LightSource({
        radius: 30,
        intensity: 0.8,
        color: 0xff8844,
      }),
    );

    const backend = new OverlayLightingRenderer({
      scene,
      world,
      renderer,
    });
    const camera = {
      zoom: 2,
      worldToScreenInto: vi.fn((out: Vec2Buffer) => out.set(44, 55)),
    } as unknown as CameraComponent;
    const frame = { camera, width: 800, height: 600 };

    backend.render(frame);

    expect(camera.worldToScreenInto).toHaveBeenCalledWith(
      expect.any(Vec2Buffer),
      120,
      80,
    );
    expect(offscreenSource?.children).toHaveLength(2);
    const lightGraphic = offscreenSource?.children[1];
    expect(lightGraphic?.position.x).toBe(44);
    expect(lightGraphic?.position.y).toBe(55);
    expect(lightGraphic?.width).toBe(120);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(renderIfNeeded).toHaveBeenCalledTimes(1);

    backend.render(frame);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(renderIfNeeded).toHaveBeenCalledTimes(2);

    light.radius = 40;
    backend.render(frame);
    expect(lightGraphic?.width).toBe(160);
    expect(invalidate).toHaveBeenCalledTimes(2);

    light.enabled = false;
    backend.render(frame);
    expect(offscreenSource?.children).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledTimes(3);

    backend.render({ camera, width: 1024, height: 576 });
    expect(resize).toHaveBeenCalledWith(1024, 576);
    expect(invalidate).toHaveBeenCalledTimes(4);

    backend.destroy();
    expect(destroyTarget).toHaveBeenCalledTimes(1);
    expect(layerContainer.children).toHaveLength(0);
  });
});

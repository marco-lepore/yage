import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    scale = {
      x: 1,
      y: 1,
      set(this: { x: number; y: number }, ax: number, ay?: number) {
        this.x = ax;
        this.y = ay ?? ax;
      },
    };
    rotation = 0;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    eventMode = "passive";

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }
    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }
    removeFromParent(): void {
      this.parent?.removeChild(this);
    }
    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }
    destroy(): void {
      this.removeFromParent();
    }
  }
  return { mocks: { MockContainer } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
}));

import { Transform, Vec2 } from "@yagejs/core";
import { CameraEntity } from "./CameraEntity.js";
import { CameraComponent } from "./CameraComponent.js";
import { CameraBoundsComponent } from "./CameraBoundsComponent.js";
import { CameraShake } from "./CameraShake.js";
import { createRendererTestContext } from "./test-helpers.js";
import { RendererKey } from "./types.js";

describe("CameraEntity", () => {
  it("spawns without params (no crash on params.position)", () => {
    const { scene } = createRendererTestContext();
    expect(() => scene.spawn(CameraEntity)).not.toThrow();
  });

  it("defaults to position (0,0), zoom 1 when no params given", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    expect(cam.position.x).toBe(0);
    expect(cam.position.y).toBe(0);
    expect(cam.zoom).toBe(1);
  });

  it("starts following when a target is passed", () => {
    const { scene } = createRendererTestContext();
    const target = { position: new Vec2(50, 50) };
    const cam = scene.spawn(CameraEntity, { follow: target, smoothing: 1 });
    // The CameraFollow component should have been started; sanity-check
    // by calling unfollow without throwing.
    expect(() => cam.unfollow()).not.toThrow();
  });

  it("exposes delegate getters that proxy to CameraComponent", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity, {
      position: new Vec2(10, 20),
      zoom: 2,
    });
    const comp = cam.get(CameraComponent);
    expect(cam.position).toBe(comp.position);
    expect(cam.zoom).toBe(comp.zoom);
  });

  it("screenToWorld satisfies CameraLike directly on the entity", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    const w = cam.screenToWorld(400, 300);
    // With pos (0,0), zoom 1, viewport 800x600: screen(400,300) = world(0,0)
    expect(w.x).toBe(0);
    expect(w.y).toBe(0);
  });

  it("follow() accepts a Transform (Vec2Like position)", () => {
    const { scene } = createRendererTestContext();
    const player = scene.spawn("player");
    const t = player.add(new Transform({ position: new Vec2(100, 100) }));
    const cam = scene.spawn(CameraEntity);
    expect(() => cam.follow(t, { smoothing: 0.1 })).not.toThrow();
  });

  it("worldToScreen and screenToWorld account for camera rotation", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity, { position: new Vec2(100, 50) });
    cam.rotation = Math.PI / 2;

    const screen = cam.worldToScreen(100, 150);
    expect(screen.x).toBeCloseTo(500);
    expect(screen.y).toBeCloseTo(300);

    const world = cam.screenToWorld(500, 300);
    expect(world.x).toBeCloseTo(100);
    expect(world.y).toBeCloseTo(150);
  });

  it("uses the current renderer viewport size for conversions", () => {
    const ctx = createRendererTestContext();
    const cam = ctx.scene.spawn(CameraEntity);
    const renderer = ctx.context.resolve(RendererKey) as {
      virtualSize: { width: number; height: number };
    };

    renderer.virtualSize.width = 1024;
    renderer.virtualSize.height = 768;

    const world = cam.screenToWorld(512, 384);
    expect(world.x).toBe(0);
    expect(world.y).toBe(0);
  });

  it("centers the camera when the viewport is larger than its bounds", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity, { position: new Vec2(10, 10) });
    cam.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 80 };

    cam.get(CameraBoundsComponent).update();

    expect(cam.position.x).toBe(50);
    expect(cam.position.y).toBe(40);
  });

  it("CameraShake.stop() clears active shake state immediately", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    const shake = cam.get(CameraShake);

    shake.start(10, 100, { decay: 0.5 });
    shake.update(16);
    expect(shake.offset.equals(Vec2.ZERO)).toBe(false);

    shake.stop();
    expect(shake.offset.equals(Vec2.ZERO)).toBe(true);

    shake.update(16);
    expect(shake.offset.equals(Vec2.ZERO)).toBe(true);
  });

  it("clamps decayed shake intensity at zero", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    const shake = cam.get(CameraShake);

    shake.start(10, 100, { decay: 2 });
    shake.update(90);

    expect(shake.offset.equals(Vec2.ZERO)).toBe(true);
  });
});

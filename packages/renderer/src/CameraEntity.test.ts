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

import { Transform, Vec2, Vec2Buffer, ErrorBoundaryKey } from "@yagejs/core";
import { CameraEntity } from "./CameraEntity.js";
import { CameraComponent } from "./CameraComponent.js";
import { CameraBoundsComponent } from "./CameraBoundsComponent.js";
import { CameraFollow } from "./CameraFollow.js";
import { CameraShake } from "./CameraShake.js";
import { CameraZoom } from "./CameraZoom.js";
import { ScreenFollow } from "./ScreenFollow.js";
import { createRendererTestContext } from "./test-helpers.js";
import { RendererKey } from "./types.js";

describe("CameraEntity", () => {
  it("reuses projection outputs and roundtrips with modifiers", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity, {
      position: new Vec2(30, -20),
      zoom: 2,
    });
    cam.rotation = 0.7;
    cam.modifiers.add({ position: { x: 4, y: -8 }, rotation: 0.2, zoom: 1.5 });
    const out = new Vec2Buffer();
    expect(cam.getEffectivePositionInto(out)).toBe(out);
    expect([out.x, out.y]).toEqual([
      cam.effectivePosition.x,
      cam.effectivePosition.y,
    ]);
    const expected = cam.worldToScreen(77, -55);
    expect(cam.worldToScreenInto(out, 77, -55)).toBe(out);
    expect([out.x, out.y]).toEqual([expected.x, expected.y]);
    expect(cam.screenToWorldInto(out, out.x, out.y)).toBe(out);
    expect(out.x).toBeCloseTo(77);
    expect(out.y).toBeCloseTo(-55);
    const inverse = cam.screenToWorld(19, 87);
    cam.screenToWorldInto(out, 19, 87);
    expect([out.x, out.y]).toEqual([inverse.x, inverse.y]);
  });

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
    const target = new Transform({ position: new Vec2(50, 50) });
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

  it("uses live base values plus independently removable modifiers", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity, {
      position: new Vec2(10, 20),
      zoom: 2,
    });
    cam.rotation = 0.25;
    const first = cam.modifiers.add({
      position: { x: 5, y: 3 },
      zoom: 2,
      rotation: 0.5,
    });
    const second = cam.modifiers.add({ position: { x: -2, y: 1 }, zoom: 3 });

    expect(cam.effectivePosition).toEqual(new Vec2(13, 24));
    expect(cam.effectiveZoom).toBe(12);
    expect(cam.effectiveRotation).toBe(0.75);

    cam.position = new Vec2(100, 200);
    cam.zoom = 4;
    cam.rotation = 1;
    first.remove();
    expect(cam.effectivePosition).toEqual(new Vec2(98, 201));
    expect(cam.effectiveZoom).toBe(12);
    expect(cam.effectiveRotation).toBe(1);

    second.remove();
    expect(cam.effectivePosition).toEqual(new Vec2(100, 200));
    expect(cam.effectiveZoom).toBe(4);
    expect(cam.effectiveRotation).toBe(1);
  });

  it("uses effective camera values for coordinate conversion", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    const modifier = cam.modifiers.add({
      position: { x: 100, y: 50 },
      zoom: 2,
      rotation: Math.PI / 2,
    });

    const screen = cam.worldToScreen(100, 100);
    const world = cam.screenToWorld(screen.x, screen.y);
    expect(world.x).toBeCloseTo(100);
    expect(world.y).toBeCloseTo(100);

    modifier.remove();
    expect(cam.worldToScreen(0, 0)).toEqual(new Vec2(400, 300));
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
    expect(cam.modifiers.size).toBe(1);
    shake.update(16);
    expect(shake.offset.equals(Vec2.ZERO)).toBe(false);

    shake.stop();
    expect(shake.offset.equals(Vec2.ZERO)).toBe(true);
    expect(cam.modifiers.size).toBe(0);

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

  describe("follow snap", () => {
    it("starts on the target instead of easing in from the spawn position", () => {
      const { scene } = createRendererTestContext();
      const target = new Transform({ position: new Vec2(1600, 900) });
      const cam = scene.spawn(CameraEntity, {
        follow: target,
        smoothing: 0.1,
        snap: true,
      });

      expect(cam.position.x).toBe(1600);
      expect(cam.position.y).toBe(900);
    });

    it("applies the follow offset when snapping", () => {
      const { scene } = createRendererTestContext();
      const target = new Transform({ position: new Vec2(1600, 900) });
      const cam = scene.spawn(CameraEntity, {
        follow: target,
        smoothing: 0.1,
        offset: { x: 0, y: -50 },
        snap: true,
      });

      expect(cam.position.x).toBe(1600);
      expect(cam.position.y).toBe(850);
    });

    it("eases in from the spawn position without snap", () => {
      const { scene } = createRendererTestContext();
      const target = new Transform({ position: new Vec2(1000, 0) });
      const cam = scene.spawn(CameraEntity, { follow: target, smoothing: 0.1 });

      expect(cam.position.x).toBe(0);

      // At the reference timestep the lerp factor is `smoothing` exactly.
      cam.get(CameraFollow).update(1 / 60);
      expect(cam.position.x).toBeCloseTo(100);
    });

    it("cuts to the target when snapToTarget() is called after a teleport", () => {
      const { scene } = createRendererTestContext();
      const target = new Transform({ position: new Vec2(0, 0) });
      const cam = scene.spawn(CameraEntity, { follow: target, smoothing: 0.1 });

      target.position = new Vec2(400, 300);
      cam.snapToTarget();

      expect(cam.position.x).toBe(400);
      expect(cam.position.y).toBe(300);
    });

    it("centres the target once, then the deadzone applies", () => {
      const { scene } = createRendererTestContext();
      const target = new Transform({ position: new Vec2(1600, 900) });
      const cam = scene.spawn(CameraEntity, {
        follow: target,
        smoothing: 0.1,
        deadzone: { halfWidth: 50, halfHeight: 50 },
        snap: true,
      });

      expect(cam.position.x).toBe(1600);

      // Inside the deadzone: the camera holds still.
      target.position = new Vec2(1630, 900);
      cam.get(CameraFollow).update(1 / 60);
      expect(cam.position.x).toBe(1600);

      // Outside it: the camera resumes easing after the deadzone edge.
      target.position = new Vec2(1700, 900);
      cam.get(CameraFollow).update(1 / 60);
      expect(cam.position.x).toBeCloseTo(1605);
    });

    it("leaves the camera alone when snapToTarget() runs without a target", () => {
      const { scene } = createRendererTestContext();
      const cam = scene.spawn(CameraEntity, { position: new Vec2(10, 20) });

      cam.snapToTarget();

      expect(cam.position.x).toBe(10);
      expect(cam.position.y).toBe(20);
    });
  });

  describe("fitTo", () => {
    it("centres the camera on the rect's midpoint", () => {
      // Default test viewport from createRendererTestContext: 800 × 600.
      const { scene } = createRendererTestContext();
      const cam = scene.spawn(CameraEntity, {
        fitTo: { x: 100, y: 200, width: 400, height: 300 },
      });

      expect(cam.position.x).toBe(300); // 100 + 400/2
      expect(cam.position.y).toBe(350); // 200 + 300/2
    });

    it("zooms to fit the rect inside the viewport (contain semantics)", () => {
      const { scene } = createRendererTestContext();
      // 800/400 = 2, 600/300 = 2 — both axes match, zoom = 2.
      const camMatched = scene.spawn(CameraEntity, {
        fitTo: { x: 0, y: 0, width: 400, height: 300 },
      });
      expect(camMatched.zoom).toBe(2);

      // 800/200 = 4, 600/300 = 2 — height is the limiting axis, zoom = 2.
      const camWide = scene.spawn(CameraEntity, {
        fitTo: { x: 0, y: 0, width: 200, height: 300 },
      });
      expect(camWide.zoom).toBe(2);
    });

    it("overrides explicit `position` and `zoom`", () => {
      const { scene } = createRendererTestContext();
      const cam = scene.spawn(CameraEntity, {
        position: new Vec2(10, 10),
        zoom: 5,
        fitTo: { x: 0, y: 0, width: 800, height: 600 },
      });

      // fitTo on a 800×600 rect against an 800×600 viewport: position
      // at centre, zoom at 1.
      expect(cam.position.x).toBe(400);
      expect(cam.position.y).toBe(300);
      expect(cam.zoom).toBe(1);
    });
  });
});

describe("CameraEntity follow targets", () => {
  it("projects ScreenFollow through camera modifiers and both parent transforms", () => {
    const { scene } = createRendererTestContext();
    const platform = scene.spawn("platform");
    const platformTransform = platform.add(
      new Transform({
        position: { x: 100, y: 50 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: 3 },
      }),
    );
    const target = platform.spawnChild("target");
    const targetTransform = target.add(
      new Transform({
        position: { x: 4, y: 5 },
        rotation: 0.2,
      }),
    );
    const camera = scene.spawn(CameraEntity, {
      position: new Vec2(30, -20),
      zoom: 2,
    });
    const modifier = camera.modifiers.add({
      position: { x: 5, y: 8 },
      rotation: Math.PI / 2,
      zoom: 1.5,
    });
    const panel = scene.spawn("panel");
    const panelTransform = panel.add(
      new Transform({
        position: { x: 17, y: 19 },
        rotation: Math.PI / 2,
        scale: { x: 2, y: -3 },
      }),
    );
    const label = panel.spawnChild("label");
    const labelTransform = label.add(new Transform());
    const follow = label.add(
      new ScreenFollow({
        target,
        camera,
        offset: { x: 7, y: -11 },
        trackRotation: true,
      }),
    );

    expect(targetTransform.worldPosition.x).toBeCloseTo(85);
    expect(targetTransform.worldPosition.y).toBeCloseTo(58);
    const projected = camera.worldToScreen(85, 58);
    expect(projected.x).toBeCloseTo(610);
    expect(projected.y).toBeCloseTo(150);
    follow.update();
    const firstPosition = labelTransform.worldPosition;
    expect(firstPosition.x).toBeCloseTo(617);
    expect(firstPosition.y).toBeCloseTo(139);
    expect(labelTransform.position.x).toBeCloseTo(60);
    expect(labelTransform.position.y).toBeCloseTo(200);
    expect(labelTransform.worldRotation).toBeCloseTo(Math.PI / 2 + 0.2);

    platformTransform.setPosition(120, 70);
    platformTransform.setRotation(0);
    panelTransform.setPosition(7, 10);
    panelTransform.setRotation(0);
    modifier.setPosition({ x: -2, y: 4 });
    modifier.setRotation(0);
    modifier.setZoom(0.5);
    follow.update();
    expect(labelTransform.worldPosition.x).toBeCloseTo(507);
    expect(labelTransform.worldPosition.y).toBeCloseTo(390);
    expect(labelTransform.position.x).toBeCloseTo(250);
    expect(labelTransform.position.y).toBeCloseTo(-380 / 3);
    expect(labelTransform.worldRotation).toBeCloseTo(0.2);
    expect(firstPosition.x).toBeCloseTo(617);
    expect(firstPosition.y).toBeCloseTo(139);
  });

  it("follows a target parented under a moving entity by its world position", () => {
    const { scene } = createRendererTestContext();
    const platform = scene.spawn("platform");
    platform.add(new Transform({ position: new Vec2(1000, 500) }));
    const rider = platform.spawnChild("rider");
    const riderTransform = rider.add(
      new Transform({ position: new Vec2(20, 10) }),
    );

    const cam = scene.spawn(CameraEntity, {
      follow: riderTransform,
      smoothing: 0.1,
      snap: true,
    });

    expect(cam.position.x).toBe(1020);
    expect(cam.position.y).toBe(510);
  });

  it("resolves an Entity, a Transform, a point and a function target", () => {
    const { scene } = createRendererTestContext();
    const player = scene.spawn("player");
    player.add(new Transform({ position: new Vec2(100, 200) }));

    const cam = scene.spawn(CameraEntity);
    const follow = cam.get(CameraFollow);

    cam.follow(player, { smoothing: 1, snap: true });
    expect(cam.position.x).toBe(100);

    cam.follow(player.get(Transform), { smoothing: 1, snap: true });
    expect(cam.position.y).toBe(200);

    cam.follow(new Vec2(7, 8), { smoothing: 1, snap: true });
    expect(cam.position.x).toBe(7);

    cam.follow(() => new Vec2(-3, -4), { smoothing: 1, snap: true });
    expect(cam.position.y).toBe(-4);

    expect(follow).toBe(cam.get(CameraFollow));
  });

  it("leaves the camera where it is when the target entity has no Transform", () => {
    const { scene } = createRendererTestContext();
    const marker = scene.spawn("marker");
    const cam = scene.spawn(CameraEntity, { position: new Vec2(11, 22) });

    cam.follow(marker, { smoothing: 1, snap: true });

    expect(cam.position.x).toBe(11);
    expect(cam.position.y).toBe(22);
  });

  it("attributes a throwing follow-target function to the callback", () => {
    const { scene, context } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    cam.follow(() => {
      throw new Error("bad target");
    });

    expect(() => cam.get(CameraFollow).update(1 / 60)).toThrow("bad target");
    expect(
      context.resolve(ErrorBoundaryKey).getCallbackErrors().at(-1),
    ).toMatchObject({ kind: "Follow target function" });
  });
});

describe("CameraEntity bounds and zoom ordering", () => {
  it("clamps to this frame's zoom while a zoom-out animates at a level edge", () => {
    const { scene } = createRendererTestContext();
    const bounds = { minX: 0, minY: 0, maxX: 1600, maxY: 1200 };
    const cam = scene.spawn(CameraEntity, {
      position: new Vec2(1600, 1200),
      zoom: 2,
      bounds,
    });
    const zoom = cam.get(CameraZoom);
    const boundsComp = cam.get(CameraBoundsComponent);

    expect(CameraBoundsComponent.updatePriority).toBe(10);
    expect(zoom.updatePriority).toBeLessThan(boundsComp.updatePriority);

    zoom.start(0.5, 1);
    for (let frame = 0; frame < 60; frame++) {
      // Drive the components in the order the update pass would, so the test
      // fails if the bounds priority stops holding.
      for (const component of cam._componentsInUpdateOrder()) {
        component.update?.(1 / 60);
      }

      const halfW = 800 / (2 * cam.zoom);
      const halfH = 600 / (2 * cam.zoom);
      expect(cam.position.x + halfW).toBeLessThanOrEqual(bounds.maxX + 1e-9);
      expect(cam.position.y + halfH).toBeLessThanOrEqual(bounds.maxY + 1e-9);
    }
  });
});

describe("camera numeric gates", () => {
  it("rejects a non-finite or negative follow smoothing", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    const target = new Transform({ position: new Vec2(0, 0) });

    expect(() => cam.follow(target, { smoothing: NaN })).toThrow(
      "CameraFollow.start: smoothing must be finite and >= 0, got NaN.",
    );
    expect(() => cam.follow(target, { smoothing: -1 })).toThrow(
      "smoothing must be finite and >= 0, got -1",
    );
    expect(() => cam.follow(target, { smoothing: 0 })).not.toThrow();
  });

  it("rejects a non-positive or non-finite zoom target and a bad duration", () => {
    const { scene } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);

    expect(() => cam.zoomTo(0, 1)).toThrow(
      "CameraZoom.start: target must be finite and > 0, got 0.",
    );
    expect(() => cam.zoomTo(Infinity, 1)).toThrow("target must be finite");
    expect(() => cam.zoomTo(2, NaN)).toThrow(
      "CameraZoom.start: duration must be finite and >= 0, got NaN.",
    );
    expect(() => cam.zoomTo(2, 0)).not.toThrow();
  });

  it("rejects a fitTo rect with a non-positive extent", () => {
    const { scene } = createRendererTestContext();

    expect(() =>
      scene.spawn(CameraEntity, {
        fitTo: { x: 0, y: 0, width: -100, height: 100 },
      }),
    ).toThrow(
      "CameraEntity.setup: fitTo.width must be finite and > 0, got -100.",
    );
    expect(() =>
      scene.spawn(CameraEntity, {
        fitTo: { x: 0, y: 0, width: 100, height: NaN },
      }),
    ).toThrow("fitTo.height must be finite and > 0, got NaN");
  });

  it("attributes a throwing zoom easing to the callback", () => {
    const { scene, context } = createRendererTestContext();
    const cam = scene.spawn(CameraEntity);
    cam.zoomTo(2, 1, () => {
      throw new Error("bad easing");
    });

    expect(() => cam.get(CameraZoom).update(0.5)).toThrow("bad easing");
    expect(
      context.resolve(ErrorBoundaryKey).getCallbackErrors().at(-1),
    ).toMatchObject({ kind: "Camera zoom easing" });
  });
});

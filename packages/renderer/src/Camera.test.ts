import { describe, it, expect, beforeEach } from "vitest";
import { Vec2 } from "@yagejs/core";
import { Camera } from "./Camera.js";
import type { CameraBounds } from "./Camera.js";

const DT = 16.67; // one frame at 60fps

describe("Camera", () => {
  let cam: Camera;

  beforeEach(() => {
    cam = new Camera(800, 600);
  });

  // ---- Default State ----

  describe("default state", () => {
    it("position is ZERO", () => {
      expect(cam.position.equals(Vec2.ZERO)).toBe(true);
    });

    it("zoom is 1", () => {
      expect(cam.zoom).toBe(1);
    });

    it("rotation is 0", () => {
      expect(cam.rotation).toBe(0);
    });

    it("viewport dimensions match constructor", () => {
      expect(cam.viewportWidth).toBe(800);
      expect(cam.viewportHeight).toBe(600);
    });

    it("effectivePosition equals position when no shake", () => {
      cam.position = new Vec2(100, 200);
      expect(cam.effectivePosition.equals(cam.position)).toBe(true);
    });
  });

  // ---- Follow ----

  describe("follow", () => {
    it("snaps to target with smoothing=1 (default)", () => {
      const target = { position: new Vec2(200, 300) };
      cam.follow(target);
      cam.update(DT);
      expect(cam.position.equals(new Vec2(200, 300))).toBe(true);
    });

    it("approaches target with smoothing < 1", () => {
      const target = { position: new Vec2(100, 0) };
      cam.follow(target, { smoothing: 0.5 });
      cam.update(DT);
      // Should have moved toward target but not reached it
      expect(cam.position.x).toBeGreaterThan(0);
      expect(cam.position.x).toBeLessThan(100);
    });

    it("converges over multiple frames", () => {
      const target = { position: new Vec2(100, 0) };
      cam.follow(target, { smoothing: 0.5 });
      for (let i = 0; i < 100; i++) cam.update(DT);
      expect(cam.position.x).toBeCloseTo(100, 1);
    });

    it("applies follow offset", () => {
      const target = { position: new Vec2(100, 200) };
      cam.follow(target, { offset: new Vec2(10, 20) });
      cam.update(DT);
      expect(cam.position.equals(new Vec2(110, 220))).toBe(true);
    });

    it("tracks moving target", () => {
      const target = { position: new Vec2(50, 0) };
      cam.follow(target);
      cam.update(DT);
      expect(cam.position.x).toBe(50);

      target.position = new Vec2(200, 0);
      cam.update(DT);
      expect(cam.position.x).toBe(200);
    });
  });

  // ---- Deadzone ----

  describe("deadzone", () => {
    it("camera stays still when target is inside deadzone", () => {
      cam.position = new Vec2(100, 100);
      const target = { position: new Vec2(105, 105) };
      cam.follow(target, { deadzone: { halfWidth: 20, halfHeight: 20 } });
      cam.update(DT);
      expect(cam.position.equals(new Vec2(100, 100))).toBe(true);
    });

    it("camera moves when target exits deadzone horizontally", () => {
      cam.position = new Vec2(100, 100);
      const target = { position: new Vec2(130, 100) };
      cam.follow(target, { deadzone: { halfWidth: 20, halfHeight: 20 } });
      cam.update(DT);
      // Target is 30 units right, deadzone is 20, so camera should move 10 to the right
      expect(cam.position.x).toBeCloseTo(110, 1);
    });

    it("camera moves when target exits deadzone vertically", () => {
      cam.position = new Vec2(100, 100);
      const target = { position: new Vec2(100, 70) };
      cam.follow(target, { deadzone: { halfWidth: 20, halfHeight: 20 } });
      cam.update(DT);
      // Target is 30 units up, deadzone is 20, so camera should move 10 up
      expect(cam.position.y).toBeCloseTo(90, 1);
    });

    it("deadzone with smoothing delays camera movement", () => {
      cam.position = new Vec2(100, 100);
      const target = { position: new Vec2(150, 100) };
      cam.follow(target, {
        smoothing: 0.3,
        deadzone: { halfWidth: 10, halfHeight: 10 },
      });
      cam.update(DT);
      // Camera should move toward 140 (150 - 10) but not reach it due to smoothing
      expect(cam.position.x).toBeGreaterThan(100);
      expect(cam.position.x).toBeLessThan(140);
    });
  });

  // ---- Unfollow ----

  describe("unfollow", () => {
    it("stops tracking target", () => {
      const target = { position: new Vec2(100, 100) };
      cam.follow(target);
      cam.update(DT);
      expect(cam.position.x).toBe(100);

      cam.unfollow();
      target.position = new Vec2(500, 500);
      cam.update(DT);
      // Position should not have changed
      expect(cam.position.x).toBe(100);
    });
  });

  // ---- Bounds Clamping ----

  describe("bounds clamping", () => {
    const worldBounds: CameraBounds = {
      minX: 0,
      minY: 0,
      maxX: 1000,
      maxY: 1000,
    };

    it("clamps camera to world edges (left)", () => {
      cam.bounds = worldBounds;
      cam.position = new Vec2(-100, 500);
      cam.update(DT);
      // At zoom 1, half viewport = 400, 300
      // minCamX = 0 + 400 = 400
      expect(cam.position.x).toBe(400);
    });

    it("clamps camera to world edges (right)", () => {
      cam.bounds = worldBounds;
      cam.position = new Vec2(900, 500);
      cam.update(DT);
      // maxCamX = 1000 - 400 = 600
      expect(cam.position.x).toBe(600);
    });

    it("clamps camera to world edges (top)", () => {
      cam.bounds = worldBounds;
      cam.position = new Vec2(500, -100);
      cam.update(DT);
      // minCamY = 0 + 300 = 300
      expect(cam.position.y).toBe(300);
    });

    it("clamps camera to world edges (bottom)", () => {
      cam.bounds = worldBounds;
      cam.position = new Vec2(500, 900);
      cam.update(DT);
      // maxCamY = 1000 - 300 = 700
      expect(cam.position.y).toBe(700);
    });

    it("accounts for zoom when clamping", () => {
      cam.bounds = worldBounds;
      cam.zoom = 2;
      cam.position = new Vec2(-100, 500);
      cam.update(DT);
      // halfViewW = 800 / (2*2) = 200
      // minCamX = 0 + 200 = 200
      expect(cam.position.x).toBe(200);
    });

    it("does not clamp when no bounds set", () => {
      cam.position = new Vec2(-9999, -9999);
      cam.update(DT);
      expect(cam.position.x).toBe(-9999);
    });

    it("allows free movement within bounds", () => {
      cam.bounds = worldBounds;
      cam.position = new Vec2(500, 500);
      cam.update(DT);
      expect(cam.position.x).toBe(500);
      expect(cam.position.y).toBe(500);
    });
  });

  // ---- Shake ----

  describe("shake", () => {
    it("effectivePosition diverges during shake", () => {
      cam.position = new Vec2(100, 100);
      cam.shake(10, 500);
      cam.update(DT);
      const eff = cam.effectivePosition;
      // effectivePosition should differ from position during shake
      const hasDifference =
        Math.abs(eff.x - cam.position.x) > 0.001 ||
        Math.abs(eff.y - cam.position.y) > 0.001;
      expect(hasDifference).toBe(true);
    });

    it("base position is unchanged during shake", () => {
      cam.position = new Vec2(100, 100);
      cam.shake(10, 500);
      cam.update(DT);
      expect(cam.position.equals(new Vec2(100, 100))).toBe(true);
    });

    it("returns to position after shake duration", () => {
      cam.position = new Vec2(100, 100);
      cam.shake(10, 100);
      // Advance past shake duration
      cam.update(50);
      cam.update(60);
      expect(cam.effectivePosition.equals(cam.position)).toBe(true);
    });

    it("shake with decay reduces intensity over time", () => {
      cam.shake(10, 200, { decay: 1 });
      cam.update(DT);
      const earlyOffset = cam.effectivePosition.sub(cam.position).length();

      cam.shake(10, 200, { decay: 1 });
      cam.update(180);
      const lateOffset = cam.effectivePosition.sub(cam.position).length();

      // Late offset should be smaller due to decay
      expect(lateOffset).toBeLessThan(earlyOffset);
    });

    it("zero intensity shake has no effect", () => {
      cam.position = new Vec2(50, 50);
      cam.shake(0, 100);
      cam.update(DT);
      expect(cam.effectivePosition.equals(cam.position)).toBe(true);
    });
  });

  // ---- ZoomTo ----

  describe("zoomTo", () => {
    it("interpolates over duration", () => {
      cam.zoomTo(2, 100);
      cam.update(50);
      // At half duration with linear easing, should be ~1.5
      expect(cam.zoom).toBeCloseTo(1.5, 2);
    });

    it("snaps to target on completion", () => {
      cam.zoomTo(3, 100);
      cam.update(100);
      expect(cam.zoom).toBe(3);
    });

    it("snaps if dt exceeds duration", () => {
      cam.zoomTo(0.5, 100);
      cam.update(200);
      expect(cam.zoom).toBe(0.5);
    });

    it("applies easing function", () => {
      // easeInQuad: t*t
      cam.zoomTo(2, 100, (t) => t * t);
      cam.update(50);
      // t=0.5, eased=0.25, zoom = 1 + (2-1)*0.25 = 1.25
      expect(cam.zoom).toBeCloseTo(1.25, 2);
    });

    it("can zoom down", () => {
      cam.zoom = 2;
      cam.zoomTo(0.5, 100);
      cam.update(100);
      expect(cam.zoom).toBe(0.5);
    });
  });

  // ---- Coordinate Conversion ----

  describe("screenToWorld / worldToScreen", () => {
    it("screen center maps to camera position", () => {
      cam.position = new Vec2(100, 200);
      const world = cam.screenToWorld(400, 300);
      expect(world.x).toBeCloseTo(100);
      expect(world.y).toBeCloseTo(200);
    });

    it("are exact inverses", () => {
      cam.position = new Vec2(100, 200);
      cam.zoom = 1.5;
      const worldX = 300;
      const worldY = 400;
      const screen = cam.worldToScreen(worldX, worldY);
      const back = cam.screenToWorld(screen.x, screen.y);
      expect(back.x).toBeCloseTo(worldX, 5);
      expect(back.y).toBeCloseTo(worldY, 5);
    });

    it("are exact inverses in the other direction", () => {
      cam.position = new Vec2(-50, 150);
      cam.zoom = 0.8;
      const screenX = 200;
      const screenY = 100;
      const world = cam.screenToWorld(screenX, screenY);
      const back = cam.worldToScreen(world.x, world.y);
      expect(back.x).toBeCloseTo(screenX, 5);
      expect(back.y).toBeCloseTo(screenY, 5);
    });

    it("correct at zoom 2", () => {
      cam.position = new Vec2(0, 0);
      cam.zoom = 2;
      // Screen (400, 300) is center, should map to (0,0)
      expect(cam.screenToWorld(400, 300).x).toBeCloseTo(0);
      // Screen (600, 300): (600-400)/2 + 0 = 100
      expect(cam.screenToWorld(600, 300).x).toBeCloseTo(100);
    });

    it("worldToScreen places camera position at screen center", () => {
      cam.position = new Vec2(50, 75);
      const screen = cam.worldToScreen(50, 75);
      expect(screen.x).toBeCloseTo(400);
      expect(screen.y).toBeCloseTo(300);
    });

    it("worldToScreen scales offset by zoom", () => {
      cam.position = new Vec2(0, 0);
      cam.zoom = 2;
      // world (100, 0) -> screen: (100 - 0) * 2 + 400 = 600
      const screen = cam.worldToScreen(100, 0);
      expect(screen.x).toBeCloseTo(600);
    });

    it("accounts for shake offset during conversion", () => {
      cam.position = new Vec2(100, 100);
      cam.shake(10, 500);
      cam.update(DT);

      // During shake, effectivePosition != position
      const eff = cam.effectivePosition;
      expect(eff.equals(cam.position)).toBe(false);

      // screenToWorld/worldToScreen should still be inverses
      const world = cam.screenToWorld(400, 300);
      const back = cam.worldToScreen(world.x, world.y);
      expect(back.x).toBeCloseTo(400, 5);
      expect(back.y).toBeCloseTo(300, 5);

      // Screen center should map to effectivePosition, not position
      const center = cam.screenToWorld(400, 300);
      expect(center.x).toBeCloseTo(eff.x, 5);
      expect(center.y).toBeCloseTo(eff.y, 5);
    });
  });

  // ---- Combined Behaviors ----

  describe("combined behaviors", () => {
    it("follow + bounds: clamps after following", () => {
      cam.bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
      const target = { position: new Vec2(-500, 500) };
      cam.follow(target);
      cam.update(DT);
      // Should follow to target then clamp: minCamX = 400
      expect(cam.position.x).toBe(400);
    });

    it("follow + shake: effectivePosition reflects both", () => {
      const target = { position: new Vec2(200, 200) };
      cam.follow(target);
      cam.shake(10, 500);
      cam.update(DT);
      // Position should be at target
      expect(cam.position.x).toBeCloseTo(200);
      // effectivePosition should differ due to shake
      const diff = cam.effectivePosition.sub(cam.position).length();
      expect(diff).toBeGreaterThan(0);
    });
  });
});

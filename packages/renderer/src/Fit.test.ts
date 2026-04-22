import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FitController } from "./Fit.js";
import type { Application, Container } from "pixi.js";

// ---------------------------------------------------------------------------
// Lightweight mocks — same style as test-helpers.ts, scoped to this file.
// ---------------------------------------------------------------------------

class MockContainer {
  scale = {
    x: 1,
    y: 1,
    set(this: { x: number; y: number }, sx: number, sy?: number) {
      this.x = sx;
      this.y = sy ?? sx;
    },
  };
  position = {
    x: 0,
    y: 0,
    set(this: { x: number; y: number }, px: number, py: number) {
      this.x = px;
      this.y = py;
    },
  };
}

class MockApp {
  stage = new MockContainer();
  renderer = {
    width: 800,
    height: 600,
    resize: vi.fn(function (this: { width: number; height: number }, w: number, h: number) {
      this.width = w;
      this.height = h;
    }),
  };
}

// Minimal ResizeObserver polyfill for jsdom. Captures the callback so tests
// can manually fire resize events with specific sizes.
type RoEntry = { contentRect: { width: number; height: number } };
type RoCallback = (entries: RoEntry[]) => void;

const observers: MockResizeObserver[] = [];

class MockResizeObserver {
  private readonly cb: RoCallback;
  disconnected = false;
  observed: Element | null = null;

  constructor(cb: RoCallback) {
    this.cb = cb;
    observers.push(this);
  }

  observe(el: Element): void {
    this.observed = el;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  fire(width: number, height: number): void {
    this.cb([{ contentRect: { width, height } }]);
  }
}

function makeTarget(width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  } as unknown as HTMLElement;
}

// ---------------------------------------------------------------------------

describe("FitController", () => {
  let originalRO: typeof globalThis.ResizeObserver | undefined;

  beforeEach(() => {
    observers.length = 0;
    originalRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
      MockResizeObserver;
  });

  afterEach(() => {
    if (originalRO) {
      globalThis.ResizeObserver = originalRO;
    } else {
      delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  function makeFit(
    mode: "letterbox" | "cover" | "stretch",
    vW: number,
    vH: number,
    hostW: number,
    hostH: number,
  ): { fit: FitController; app: MockApp; target: HTMLElement } {
    const app = new MockApp();
    const target = makeTarget(hostW, hostH);
    const fit = new FitController(
      app as unknown as Application,
      app.stage as unknown as Container,
      vW,
      vH,
      mode,
      target,
      app.renderer.width,
      app.renderer.height,
    );
    return { fit, app, target };
  }

  describe("letterbox", () => {
    it("uses uniform min-scale and centers pillarbox on wider hosts", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();

      // scale = min(1000/400, 600/300) = min(2.5, 2) = 2
      expect(app.stage.scale.x).toBe(2);
      expect(app.stage.scale.y).toBe(2);
      // offsetX = (1000 - 400*2) / 2 = 100; offsetY = 0
      expect(app.stage.position.x).toBe(100);
      expect(app.stage.position.y).toBe(0);
      // Pixi renderer resized to host size
      expect(app.renderer.resize).toHaveBeenCalledWith(1000, 600);
      expect(fit.canvasSize).toEqual({ width: 1000, height: 600 });
    });

    it("centers letterbox bars on taller hosts", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 800, 800);
      fit.start();

      // scale = min(800/400, 800/300) = 2
      expect(app.stage.scale.x).toBe(2);
      // offsetY = (800 - 300*2) / 2 = 100; offsetX = 0
      expect(app.stage.position.x).toBe(0);
      expect(app.stage.position.y).toBe(100);
    });

    it("fills exactly when host matches virtual aspect", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();

      expect(app.stage.scale.x).toBe(2);
      expect(app.stage.position.x).toBe(0);
      expect(app.stage.position.y).toBe(0);
    });
  });

  describe("cover", () => {
    it("uses uniform max-scale so the canvas fills even with aspect mismatch", () => {
      const { fit, app } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();

      // scale = max(1000/400, 600/300) = max(2.5, 2) = 2.5
      expect(app.stage.scale.x).toBe(2.5);
      // offsetX = (1000 - 400*2.5) / 2 = 0; offsetY = (600 - 300*2.5) / 2 = -75
      expect(app.stage.position.x).toBe(0);
      expect(app.stage.position.y).toBe(-75);
    });
  });

  describe("stretch", () => {
    it("uses non-uniform scale and zero offset", () => {
      const { fit, app } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();

      expect(app.stage.scale.x).toBe(2.5);
      expect(app.stage.scale.y).toBe(2);
      expect(app.stage.position.x).toBe(0);
      expect(app.stage.position.y).toBe(0);
    });
  });

  describe("canvasToVirtual", () => {
    it("round-trips points under letterbox", () => {
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();

      // virtual (0,0) → screen (100, 0)
      expect(fit.canvasToVirtual(100, 0).x).toBe(0);
      expect(fit.canvasToVirtual(100, 0).y).toBe(0);
      // virtual (400, 300) → screen (100 + 400*2, 300*2) = (900, 600)
      expect(fit.canvasToVirtual(900, 600).x).toBe(400);
      expect(fit.canvasToVirtual(900, 600).y).toBe(300);
      // center of bars maps to center of virtual
      expect(fit.canvasToVirtual(500, 300).x).toBe(200);
      expect(fit.canvasToVirtual(500, 300).y).toBe(150);
    });

    it("round-trips under cover (points in bars produce negative virtual coords)", () => {
      const { fit } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();

      // center of canvas == center of virtual
      expect(fit.canvasToVirtual(500, 300).x).toBe(200);
      expect(fit.canvasToVirtual(500, 300).y).toBe(150);
      // screen top-left shows virtual y=30 (top 30 virtual px are cropped above the canvas)
      const tl = fit.canvasToVirtual(0, 0);
      expect(tl.x).toBe(0);
      expect(tl.y).toBe(30);
    });

    it("round-trips under stretch", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();

      // canvas top-left maps to virtual (0,0)
      expect(fit.canvasToVirtual(0, 0).x).toBe(0);
      expect(fit.canvasToVirtual(0, 0).y).toBe(0);
      // canvas bottom-right maps to virtual (400, 300)
      expect(fit.canvasToVirtual(1000, 600).x).toBe(400);
      expect(fit.canvasToVirtual(1000, 600).y).toBe(300);
    });
  });

  describe("ResizeObserver", () => {
    it("re-applies transform and resizes renderer on host resize", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();

      app.renderer.resize.mockClear();
      observers[0]!.fire(1600, 900);

      // new scale = min(1600/400, 900/300) = min(4, 3) = 3
      expect(app.stage.scale.x).toBe(3);
      // offsetX = (1600 - 400*3) / 2 = 200
      expect(app.stage.position.x).toBe(200);
      expect(app.renderer.resize).toHaveBeenCalledWith(1600, 900);
      expect(fit.canvasSize).toEqual({ width: 1600, height: 900 });
    });

    it("ignores zero-size resize events", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();

      const scaleBefore = app.stage.scale.x;
      observers[0]!.fire(0, 0);
      observers[0]!.fire(100, 0);
      observers[0]!.fire(0, 100);

      expect(app.stage.scale.x).toBe(scaleBefore);
    });

    it("skips re-apply when host size is unchanged", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();
      // Initial apply + one observer fire is pending; clear and fire same size
      app.renderer.resize.mockClear();
      observers[0]!.fire(800, 600);
      expect(app.renderer.resize).not.toHaveBeenCalled();
    });

    it("stop() disconnects the observer", () => {
      const { fit } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();
      expect(observers[0]!.disconnected).toBe(false);
      fit.stop();
      expect(observers[0]!.disconnected).toBe(true);
    });

    it("start() is idempotent — second call does not leak an observer", () => {
      const { fit } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();
      fit.start();
      expect(observers).toHaveLength(1);
    });
  });

  describe("null target (headless)", () => {
    it("applies a one-shot transform using initial canvas size and installs no observer", () => {
      const app = new MockApp();
      const fit = new FitController(
        app as unknown as Application,
        app.stage as unknown as Container,
        400,
        300,
        "letterbox",
        null,
        1000,
        600,
      );
      fit.start();

      // scale = min(1000/400, 600/300) = 2
      expect(app.stage.scale.x).toBe(2);
      expect(app.stage.position.x).toBe(100);
      // No observer installed — observers array should still be empty
      expect(observers).toHaveLength(0);
      // renderer.resize still called once for the initial apply
      expect(app.renderer.resize).toHaveBeenCalledWith(1000, 600);
    });

    it("stop() is a no-op when no observer was installed", () => {
      const app = new MockApp();
      const fit = new FitController(
        app as unknown as Application,
        app.stage as unknown as Container,
        400,
        300,
        "letterbox",
        null,
        800,
        600,
      );
      fit.start();
      expect(() => fit.stop()).not.toThrow();
    });
  });

  describe("reconfigure", () => {
    it("changes mode without rebuilding the observer", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      const obs = observers[0]!;

      fit.reconfigure("cover", fit.currentTarget);
      expect(fit.currentMode).toBe("cover");
      // cover scale = max(1000/400, 600/300) = 2.5
      expect(app.stage.scale.x).toBe(2.5);
      expect(obs.disconnected).toBe(false); // same target, same observer
    });

    it("rewires observer when target changes", () => {
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      const firstObs = observers[0]!;

      const newTarget = makeTarget(640, 480);
      fit.reconfigure("letterbox", newTarget);
      expect(firstObs.disconnected).toBe(true);
      expect(observers[1]!.observed).toBe(newTarget);
    });
  });
});

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
  // Children / mask support for the letterbox-clip path. The real Pixi
  // Container has many more responsibilities; we capture only what
  // FitController touches.
  children: unknown[] = [];
  mask: unknown = null;
  addChild(child: unknown): void {
    this.children.push(child);
  }
  removeChild(child: unknown): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
  }
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
    mode: "letterbox" | "expand" | "cover" | "stretch",
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

    it("installs a stage mask that clips world content to the virtual rect", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();

      // Mask is applied to stage and is a child of stage so it inherits the
      // same transform — drawn at virtual-local (0,0,vW,vH) it lands on the
      // virtual rect after the stage scale/offset is applied.
      expect(app.stage.mask).not.toBeNull();
      expect(app.stage.children).toContain(app.stage.mask);
    });

    it("removes the mask on stop()", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(app.stage.mask).not.toBeNull();

      fit.stop();
      expect(app.stage.mask).toBeNull();
      expect(app.stage.children).toHaveLength(0);
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

  describe("expand", () => {
    it("uses the same transform as letterbox on a wider host", () => {
      const { fit, app } = makeFit("expand", 400, 300, 1000, 600);
      fit.start();

      // scale = min(1000/400, 600/300) = 2 — same as letterbox
      expect(app.stage.scale.x).toBe(2);
      expect(app.stage.scale.y).toBe(2);
      expect(app.stage.position.x).toBe(100);
      expect(app.stage.position.y).toBe(0);
    });

    it("uses the same transform as letterbox on a taller host", () => {
      const { fit, app } = makeFit("expand", 400, 300, 800, 800);
      fit.start();

      expect(app.stage.scale.x).toBe(2);
      expect(app.stage.position.x).toBe(0);
      expect(app.stage.position.y).toBe(100);
    });

    it("does not install a stage mask — the game is expected to draw into bars", () => {
      const { fit, app } = makeFit("expand", 400, 300, 1000, 600);
      fit.start();
      expect(app.stage.mask).toBeNull();
      expect(app.stage.children).toHaveLength(0);
    });

    it("keeps visibleVirtualRect at the full virtual rect regardless of aspect", () => {
      const { fit } = makeFit("expand", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleVirtualRect).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
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

  describe("visibleVirtualRect", () => {
    it("returns the full virtual rect under letterbox", () => {
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleVirtualRect).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
    });

    it("returns the full virtual rect under stretch", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleVirtualRect).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
    });

    it("returns the cropped sub-rect under cover", () => {
      // scale = max(1000/400, 600/300) = 2.5
      // offsetY = (600 - 300*2.5) / 2 = -75  ⇒ 30 virtual px cropped top & bottom
      const { fit } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleVirtualRect).toEqual({
        x: 0,
        y: 30,
        width: 400,
        height: 240,
      });
    });

    it("clamps to the virtual rect when host matches virtual aspect exactly", () => {
      // Perfect aspect — cover scale = 2, offsets = 0, visible = full virtual
      const { fit } = makeFit("cover", 400, 300, 800, 600);
      fit.start();
      expect(fit.visibleVirtualRect).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
    });
  });

  describe("croppedVirtualRects", () => {
    it("is empty under letterbox (full virtual always visible)", () => {
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(fit.croppedVirtualRects).toEqual([]);
    });

    it("is empty under stretch", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();
      expect(fit.croppedVirtualRects).toEqual([]);
    });

    it("is empty under cover when aspect matches exactly", () => {
      const { fit } = makeFit("cover", 400, 300, 800, 600);
      fit.start();
      expect(fit.croppedVirtualRects).toEqual([]);
    });

    it("returns top + bottom strips under cover on a wide host", () => {
      // scale = max(1000/400, 600/300) = 2.5 ⇒ visible y = 30..270
      const { fit } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();
      expect(fit.croppedVirtualRects).toEqual([
        { x: 0, y: 0, width: 400, height: 30 },
        { x: 0, y: 270, width: 400, height: 30 },
      ]);
    });

    it("returns left + right strips under cover on a tall host", () => {
      // vW=400, vH=300, host 400×600 ⇒ scale = max(400/400, 600/300) = 2
      // offsetX = (400 - 400*2)/2 = -200, offsetY = (600 - 300*2)/2 = 0
      // visibleVirtualRect = { x: 100, y: 0, w: 200, h: 300 }
      const { fit } = makeFit("cover", 400, 300, 400, 600);
      fit.start();
      expect(fit.croppedVirtualRects).toEqual([
        { x: 0, y: 0, width: 100, height: 300 },
        { x: 300, y: 0, width: 100, height: 300 },
      ]);
    });
  });

  describe("virtualCanvasRect", () => {
    it("equals the centered virtual footprint under letterbox", () => {
      // scale=2, offsetX=100, offsetY=0
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(fit.virtualCanvasRect).toEqual({
        x: 100,
        y: 0,
        width: 800,
        height: 600,
      });
    });

    it("matches letterbox under expand", () => {
      const { fit: letter } = makeFit("letterbox", 400, 300, 1000, 600);
      letter.start();
      const { fit: exp } = makeFit("expand", 400, 300, 1000, 600);
      exp.start();
      expect(exp.virtualCanvasRect).toEqual(letter.virtualCanvasRect);
    });

    it("extends past the canvas under cover", () => {
      // scale=2.5, offsetY=-75
      const { fit } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();
      expect(fit.virtualCanvasRect).toEqual({
        x: 0,
        y: -75,
        width: 1000,
        height: 750,
      });
    });

    it("fills the canvas under stretch (non-uniform scale)", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();
      expect(fit.virtualCanvasRect).toEqual({
        x: 0,
        y: 0,
        width: 1000,
        height: 600,
      });
    });
  });

  describe("visibleCanvasRect", () => {
    it("extends past virtual on the bar axis under letterbox", () => {
      // scale=2, offsetX=100: canvas in virtual = { -50, 0, 500, 300 }
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleCanvasRect).toEqual({
        x: -50,
        y: 0,
        width: 500,
        height: 300,
      });
    });

    it("matches letterbox under expand", () => {
      const { fit: letter } = makeFit("letterbox", 400, 300, 800, 800);
      letter.start();
      const { fit: exp } = makeFit("expand", 400, 300, 800, 800);
      exp.start();
      expect(exp.visibleCanvasRect).toEqual(letter.visibleCanvasRect);
    });

    it("equals visibleVirtualRect under cover (canvas fits inside virtual)", () => {
      const { fit } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleCanvasRect).toEqual(fit.visibleVirtualRect);
    });

    it("equals the virtual rect under stretch", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();
      expect(fit.visibleCanvasRect).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
    });

    it("equals the virtual rect when host aspect matches virtual", () => {
      const { fit } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();
      expect(fit.visibleCanvasRect).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
    });
  });

  describe("extendedVirtualRects", () => {
    it("is empty under letterbox when host aspect matches virtual", () => {
      const { fit } = makeFit("letterbox", 400, 300, 800, 600);
      fit.start();
      expect(fit.extendedVirtualRects).toEqual([]);
    });

    it("returns left + right bars under letterbox on a wider host", () => {
      // scale=2, offsetX=100: canvas in virtual = {-50, 0, 500, 300}
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(fit.extendedVirtualRects).toEqual([
        { x: -50, y: 0, width: 50, height: 300 },
        { x: 400, y: 0, width: 50, height: 300 },
      ]);
    });

    it("returns top + bottom bars under letterbox on a taller host", () => {
      // vW=400, vH=300, host 800×800: scale=2, offsetY=100
      // canvas in virtual = { 0, -50, 400, 400 }
      const { fit } = makeFit("letterbox", 400, 300, 800, 800);
      fit.start();
      expect(fit.extendedVirtualRects).toEqual([
        { x: 0, y: -50, width: 400, height: 50 },
        { x: 0, y: 300, width: 400, height: 50 },
      ]);
    });

    it("matches letterbox under expand", () => {
      const { fit: letter } = makeFit("letterbox", 400, 300, 1000, 600);
      letter.start();
      const { fit: exp } = makeFit("expand", 400, 300, 1000, 600);
      exp.start();
      expect(exp.extendedVirtualRects).toEqual(letter.extendedVirtualRects);
    });

    it("is empty under cover (virtual covers canvas entirely)", () => {
      const { fit } = makeFit("cover", 400, 300, 1000, 600);
      fit.start();
      expect(fit.extendedVirtualRects).toEqual([]);
    });

    it("is empty under stretch (virtual exactly fills canvas)", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();
      expect(fit.extendedVirtualRects).toEqual([]);
    });
  });

  describe("virtualToCanvas", () => {
    it("round-trips with canvasToVirtual under letterbox", () => {
      const { fit } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();

      // Virtual (0,0) → canvas (100, 0)
      expect(fit.virtualToCanvas(0, 0).x).toBe(100);
      expect(fit.virtualToCanvas(0, 0).y).toBe(0);
      // Virtual (400, 300) → canvas (900, 600)
      expect(fit.virtualToCanvas(400, 300).x).toBe(900);
      expect(fit.virtualToCanvas(400, 300).y).toBe(600);
      // Round-trip
      const p = fit.virtualToCanvas(173, 91);
      const back = fit.canvasToVirtual(p.x, p.y);
      expect(back.x).toBeCloseTo(173);
      expect(back.y).toBeCloseTo(91);
    });

    it("round-trips under stretch (non-uniform)", () => {
      const { fit } = makeFit("stretch", 400, 300, 1000, 600);
      fit.start();

      expect(fit.virtualToCanvas(200, 150).x).toBe(500);
      expect(fit.virtualToCanvas(200, 150).y).toBe(300);
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

    it("removes the letterbox mask when switching to expand", () => {
      const { fit, app } = makeFit("letterbox", 400, 300, 1000, 600);
      fit.start();
      expect(app.stage.mask).not.toBeNull();

      fit.reconfigure("expand", fit.currentTarget);
      expect(app.stage.mask).toBeNull();
      expect(app.stage.children).toHaveLength(0);
    });

    it("installs the letterbox mask when switching from expand to letterbox", () => {
      const { fit, app } = makeFit("expand", 400, 300, 1000, 600);
      fit.start();
      expect(app.stage.mask).toBeNull();

      fit.reconfigure("letterbox", fit.currentTarget);
      expect(app.stage.mask).not.toBeNull();
      expect(app.stage.children).toContain(app.stage.mask);
    });
  });
});

import { Vec2 } from "@yagejs/core";
import type { Application, Container } from "pixi.js";
import type { FitMode } from "./types.js";

/** The stage transform currently applied by a {@link FitController}. */
export interface FitTransform {
  scaleX: number;
  scaleY: number;
  /** Screen-space pixel offset where virtual (0, 0) lands on the canvas. */
  offsetX: number;
  offsetY: number;
}

/** A rectangle in virtual-space pixels. */
export interface VirtualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Owns the stage transform + canvas size under responsive fit.
 *
 * On `start()`, observes the target element and re-applies both
 * `app.renderer.resize(hostW, hostH)` and a stage scale/position that maps
 * the virtual rectangle into the new canvas according to the fit mode. Guards
 * against zero-size firings (detached / `display:none` hosts).
 *
 * With a null target (headless environments, tests without a DOM), applies
 * the transform once against a fixed host size and installs no observer.
 */
export class FitController {
  private observer: ResizeObserver | null = null;
  private transform: FitTransform = {
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
  };
  private canvasW: number;
  private canvasH: number;

  constructor(
    private readonly app: Application,
    private readonly stage: Container,
    private readonly virtualWidth: number,
    private readonly virtualHeight: number,
    private mode: FitMode,
    private target: HTMLElement | null,
    initialCanvasW: number,
    initialCanvasH: number,
  ) {
    this.canvasW = initialCanvasW;
    this.canvasH = initialCanvasH;
  }

  /**
   * Apply the current host size synchronously, then start observing it for
   * subsequent resizes. Idempotent: a second call while already observing
   * is a no-op. Pair with {@link stop} to disconnect.
   * With a null target, applies once using the initial canvas size and does
   * not observe.
   */
  start(): void {
    if (this.observer) return;

    if (!this.target) {
      this.apply(this.canvasW, this.canvasH);
      return;
    }

    const { width, height } = this.measure(this.target);
    if (width > 0 && height > 0) {
      this.apply(width, height);
    }

    if (typeof ResizeObserver === "undefined") return;
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const size = entry.contentBoxSize?.[0];
      const w = size ? size.inlineSize : entry.contentRect.width;
      const h = size ? size.blockSize : entry.contentRect.height;
      if (w <= 0 || h <= 0) return;
      if (w === this.canvasW && h === this.canvasH) return;
      this.apply(w, h);
    });
    this.observer.observe(this.target);
  }

  /** Stop observing and release the ResizeObserver. Leaves stage transform untouched. */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Update mode and/or target without rebuilding the controller. */
  reconfigure(mode: FitMode, target: HTMLElement | null): void {
    const targetChanged = target !== this.target;
    this.mode = mode;
    this.target = target;
    if (targetChanged) {
      this.observer?.disconnect();
      this.observer = null;
      this.start();
    } else if (this.target) {
      const { width, height } = this.measure(this.target);
      if (width > 0 && height > 0) this.apply(width, height);
    } else {
      this.apply(this.canvasW, this.canvasH);
    }
  }

  get currentMode(): FitMode {
    return this.mode;
  }

  get currentTarget(): HTMLElement | null {
    return this.target;
  }

  get canvasSize(): { width: number; height: number } {
    return { width: this.canvasW, height: this.canvasH };
  }

  get currentTransform(): Readonly<FitTransform> {
    return this.transform;
  }

  /** CSS pixels relative to the canvas → virtual-space pixels. */
  canvasToVirtual(x: number, y: number): Vec2 {
    const { scaleX, scaleY, offsetX, offsetY } = this.transform;
    return new Vec2((x - offsetX) / scaleX, (y - offsetY) / scaleY);
  }

  /**
   * The sub-rectangle of the declared virtual space (0..virtualWidth,
   * 0..virtualHeight) that is actually on-screen, clamped to the virtual
   * bounds. Use this to anchor HUD / UI to what the player can see, while
   * gameplay continues to use the full `virtualSize` as its play area.
   *
   * - `letterbox` / `stretch`: always the full virtual rect (no cropping).
   * - `cover`: a strict sub-rect — the long axis is cropped by the canvas
   *   edges. Example: under 1000×600 host with 400×300 virtual, cover
   *   scales to 2.5 and crops 30 virtual pixels off each of top / bottom,
   *   so `visibleVirtualRect` is `{ x: 0, y: 30, width: 400, height: 240 }`.
   */
  get visibleVirtualRect(): VirtualRect {
    const { scaleX, scaleY, offsetX, offsetY } = this.transform;
    // Inverse-transform the canvas corners back into virtual space.
    const xStart = -offsetX / scaleX;
    const xEnd = (this.canvasW - offsetX) / scaleX;
    const yStart = -offsetY / scaleY;
    const yEnd = (this.canvasH - offsetY) / scaleY;
    // Clamp to the declared virtual rect — matters for `cover`; no-op
    // otherwise since letterbox/stretch already stay within bounds.
    const x = Math.max(0, xStart);
    const y = Math.max(0, yStart);
    const width = Math.max(0, Math.min(this.virtualWidth, xEnd) - x);
    const height = Math.max(0, Math.min(this.virtualHeight, yEnd) - y);
    return { x, y, width, height };
  }

  /**
   * Rectangles of virtual space that are currently off-screen (inside
   * `virtualSize` but outside `visibleVirtualRect`). Gameplay still runs
   * in these regions — they are just clipped by the canvas edges.
   *
   * - `letterbox` / `stretch`: always `[]` (nothing cropped inside virtual).
   * - `cover`: 1 or 2 strips on the cropped axis (top + bottom on a wide
   *   host; left + right on a tall host). Example: under 1000×600 host with
   *   400×300 virtual, cover crops 30 px off top/bottom, so the rects are
   *   `[{x:0,y:0,w:400,h:30}, {x:0,y:270,w:400,h:30}]`.
   *
   * Strips are returned in axis order: top-then-bottom or left-then-right.
   * Zero-sized strips are omitted.
   */
  get croppedVirtualRects(): readonly VirtualRect[] {
    const vis = this.visibleVirtualRect;
    const vw = this.virtualWidth;
    const vh = this.virtualHeight;
    const out: VirtualRect[] = [];
    // Top strip
    if (vis.y > 0) {
      out.push({ x: 0, y: 0, width: vw, height: vis.y });
    }
    // Bottom strip
    const bottomStart = vis.y + vis.height;
    if (bottomStart < vh) {
      out.push({
        x: 0,
        y: bottomStart,
        width: vw,
        height: vh - bottomStart,
      });
    }
    // Left strip (only if not already captured by top/bottom which span full width)
    if (vis.x > 0) {
      out.push({ x: 0, y: vis.y, width: vis.x, height: vis.height });
    }
    // Right strip
    const rightStart = vis.x + vis.width;
    if (rightStart < vw) {
      out.push({
        x: rightStart,
        y: vis.y,
        width: vw - rightStart,
        height: vis.height,
      });
    }
    return out;
  }

  private measure(el: HTMLElement): { width: number; height: number } {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  private apply(hostW: number, hostH: number): void {
    const vW = this.virtualWidth;
    const vH = this.virtualHeight;

    let scaleX: number;
    let scaleY: number;
    let offsetX: number;
    let offsetY: number;

    if (this.mode === "stretch") {
      scaleX = hostW / vW;
      scaleY = hostH / vH;
      offsetX = 0;
      offsetY = 0;
    } else {
      const scale =
        this.mode === "cover"
          ? Math.max(hostW / vW, hostH / vH)
          : Math.min(hostW / vW, hostH / vH);
      scaleX = scale;
      scaleY = scale;
      offsetX = (hostW - vW * scale) / 2;
      offsetY = (hostH - vH * scale) / 2;
    }

    this.app.renderer.resize(hostW, hostH);
    this.stage.scale.set(scaleX, scaleY);
    this.stage.position.set(offsetX, offsetY);

    this.canvasW = hostW;
    this.canvasH = hostH;
    this.transform = { scaleX, scaleY, offsetX, offsetY };
  }
}

import { createContext } from "react";
import { Container } from "pixi.js";
import { ServiceKey } from "@yagejs/core";
import type { UIElement } from "@yagejs/ui";
import type { SceneRenderTree } from "@yagejs/renderer";
import { getRootInstances } from "./reconciler.js";
import { computePosition } from "./positioning.js";
import type { Placement } from "./positioning.js";

/**
 * Per-floating-element config. All optional; the floating layer fills
 * sensible defaults (`computePosition` defaults: center placement, flip +
 * shift on). `maxWidth` caps content width; it always also clamps to the
 * space available at the resolved side so a bubble can't run off-screen.
 */
export interface FloatConfig {
  placement?: Placement | undefined;
  offset?: number | undefined;
  padding?: number | undefined;
  maxWidth?: number | undefined;
  flip?: boolean | undefined;
  shift?: boolean | undefined;
}

/**
 * One live floating element. The owner portals React content into
 * `container`; the overlay re-anchors it to `getReference()` every frame.
 */
export interface FloatingHandle {
  readonly container: Container;
  setReference(get: () => UIElement | null): void;
  setConfig(cfg: FloatConfig): void;
  /** Show/position (`true`) or hide (`false`) without releasing. */
  setActive(active: boolean): void;
  /** Restack above all current floats (call when (re)opening). */
  bringToFront(): void;
  release(): void;
}

interface Entry {
  container: Container;
  getReference: () => UIElement | null;
  config: FloatConfig;
  active: boolean;
  z: number;
}

const OVERLAY_LAYER = "ui-overlay";
const OVERLAY_LAYER_ORDER = 1_000_000;
const ZERO = { x: 0, y: 0 } as const;

/**
 * One screen-space, top-most overlay per scene that every floating element
 * (tooltip, popover, menu, …) portals into. Decoupled from any single
 * `UIRoot`: triggers are projected into the overlay's coordinate space via
 * `toLocal`, so world-space / camera-transformed triggers anchor correctly,
 * and z-order is managed across all roots. Positioning is delegated to the
 * pure `computePosition` engine (offset → flip → shift → size).
 */
export class FloatingOverlay {
  private layer: Container | null = null;
  private readonly entries = new Set<Entry>();
  private zSeq = 1;

  /** Idempotently ensure the overlay layer exists in this scene's tree. */
  attach(tree: SceneRenderTree): void {
    if (this.layer) return;
    const layer = tree.ensureLayer(
      { name: OVERLAY_LAYER, order: OVERLAY_LAYER_ORDER },
      { space: "screen" },
    );
    layer.container.sortableChildren = true;
    this.layer = layer.container;
  }

  acquire(): FloatingHandle {
    const container = new Container();
    container.visible = false;
    const entry: Entry = {
      container,
      getReference: () => null,
      config: {},
      active: false,
      z: 0,
    };
    this.entries.add(entry);
    if (this.layer) this.layer.addChild(container);

    return {
      container,
      setReference: (get) => {
        entry.getReference = get;
      },
      setConfig: (cfg) => {
        entry.config = cfg;
      },
      setActive: (active) => {
        entry.active = active;
        if (!active) container.visible = false;
      },
      bringToFront: () => {
        entry.z = this.zSeq++;
        container.zIndex = entry.z;
      },
      release: () => {
        this.entries.delete(entry);
        container.removeFromParent();
        container.destroy({ children: true });
      },
    };
  }

  /** Re-anchor every active float. Driven once per frame after UI layout. */
  update(viewport: { width: number; height: number }): void {
    if (!this.layer) return;
    for (const e of this.entries) {
      if (!e.active) continue;
      const ref = e.getReference();
      const insts = getRootInstances(e.container);
      if (!ref || !insts || insts.length === 0) {
        e.container.visible = false;
        continue;
      }

      const triggerRect = this.referenceRect(ref);
      if (!triggerRect) {
        e.container.visible = false;
        continue;
      }

      const cfg = e.config;
      // Natural size (shrink-to-content, capped only by an explicit
      // maxWidth), then re-cap to the space available at the resolved side
      // so a wide bubble wraps instead of running off-screen.
      let size = layoutFloat(insts, cfg.maxWidth);
      let pos = computePosition(triggerRect, size, viewport, cfg);
      const effMax = Math.min(cfg.maxWidth ?? Infinity, pos.available.width);
      if (size.width > effMax + 0.5) {
        size = layoutFloat(insts, effMax);
        pos = computePosition(triggerRect, size, viewport, cfg);
      }

      e.container.position.set(pos.x, pos.y);
      e.container.visible = true;
    }
  }

  destroy(): void {
    for (const e of this.entries) {
      e.container.removeFromParent();
      e.container.destroy({ children: true });
    }
    this.entries.clear();
    this.layer = null;
  }

  /** Trigger box projected into the overlay's coordinate space. */
  private referenceRect(
    ref: UIElement,
  ): { x: number; y: number; width: number; height: number } | null {
    const layer = this.layer;
    if (!layer) return null;
    const w = ref.yogaNode.getComputedWidth();
    const h = ref.yogaNode.getComputedHeight();
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    const a = layer.toLocal(ZERO, ref.displayObject);
    const b = layer.toLocal({ x: w, y: h }, ref.displayObject);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }
}

/**
 * Lay out a float's portal roots shrink-to-content (optionally capped by
 * `maxWidth`, which wraps text). Returns the stacked content size.
 */
function layoutFloat(
  insts: UIElement[],
  maxWidth: number | undefined,
): { width: number; height: number } {
  let totalH = 0;
  let maxW = 0;
  for (const inst of insts) {
    if (!inst.displayObject.visible) continue;
    inst.yogaNode.setMaxWidth(
      maxWidth === undefined || !Number.isFinite(maxWidth)
        ? undefined
        : maxWidth,
    );
    inst.yogaNode.calculateLayout(undefined, undefined);
    inst.applyLayout?.();
    const w = inst.yogaNode.getComputedWidth();
    const h = inst.yogaNode.getComputedHeight();
    inst.displayObject.position.set(0, totalH);
    totalH += h;
    maxW = Math.max(maxW, w);
  }
  return { width: maxW, height: totalH };
}

/** Per-scene key, registered by `UIReactPlugin`'s scene hooks. */
export const FloatingOverlayKey = new ServiceKey<FloatingOverlay>(
  "floatingOverlay",
  { scope: "scene" },
);

/**
 * Provided by `UIRoot` (resolved scene-scoped). Absent → headless consumers
 * fall back to inline rendering (e.g. a bare reconciler tree in tests).
 */
export const FloatingOverlayCtx = createContext<FloatingOverlay | null>(null);

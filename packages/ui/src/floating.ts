import { Container } from "pixi.js";
import { ServiceKey } from "@yagejs/core";
import type { DisplayContainer, SceneRenderTree } from "@yagejs/renderer";
import type { UIElement } from "./types.js";
import { computePosition } from "./positioning.js";
import type { Dimensions, Placement, Rect } from "./positioning.js";
import { runUICallback } from "./error-boundary.js";

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
 * One live floating element. The owner parents content into `container`;
 * the overlay re-anchors it to `getReference()` every frame and asks the
 * owner-supplied `setLayout` callback for the content's shrink-to-content
 * size — so the overlay stays agnostic of how that content is built (React
 * reconciler tree, hand-built `UIPanel`s, …).
 */
export interface FloatingHandle {
  readonly container: DisplayContainer;
  setReference(get: () => UIElement | null): void;
  setConfig(cfg: FloatConfig): void;
  /**
   * Supply how the float's content is laid out shrink-to-content for a given
   * `maxWidth` (`undefined` → natural width). Returns the stacked size. The
   * React side feeds reconciler roots through `layoutFloat`; the imperative
   * side lays out the node it parented in.
   */
  setLayout(fn: (maxWidth: number | undefined) => Dimensions): void;
  /**
   * Re-run content layout on the next overlay update.
   *
   * Call this after changing content without replacing the layout callback.
   * Trigger movement, viewport changes, config changes, and reopening are
   * detected automatically.
   */
  invalidateLayout(): void;
  /** Show/position (`true`) or hide (`false`) without releasing. */
  setActive(active: boolean): void;
  /** Restack above all current floats (call when (re)opening). */
  bringToFront(): void;
  release(): void;
}

interface Entry {
  container: DisplayContainer;
  getReference: () => UIElement | null;
  config: FloatConfig;
  layout: (maxWidth: number | undefined) => Dimensions;
  active: boolean;
  z: number;
  dirty: boolean;
  referenceRect: Rect | null;
  viewportWidth: number;
  viewportHeight: number;
}

const OVERLAY_LAYER = "ui-overlay";
const OVERLAY_LAYER_ORDER = 1_000_000;
const ZERO = { x: 0, y: 0 } as const;
const EMPTY_SIZE: Dimensions = { width: 0, height: 0 };

function sameRect(a: Rect | null, b: Rect): boolean {
  return (
    a !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * One screen-space, top-most overlay per scene that every floating element
 * (tooltip, popover, menu, …) parents into. Decoupled from any single
 * `UIRoot`: triggers are projected into the overlay's coordinate space via
 * `toLocal`, so world-space / camera-transformed triggers anchor correctly,
 * and z-order is managed across all roots. Positioning is delegated to the
 * pure `computePosition` engine (offset → flip → shift → size); content
 * layout is delegated to a per-handle `setLayout` callback so the overlay
 * knows nothing about React or specific node types.
 */
export class FloatingOverlay {
  private layer: DisplayContainer | null = null;
  private readonly entries = new Set<Entry>();
  private readonly referenceTopLeft = { x: 0, y: 0 };
  private readonly referenceBottomRight = { x: 0, y: 0 };
  private readonly referenceBottomRightInput = { x: 0, y: 0 };
  private readonly currentReferenceRect: Rect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
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
    // Parent any slots acquired before attach (order-independent).
    for (const e of this.entries) this.layer.addChild(e.container);
  }

  acquire(): FloatingHandle {
    const container = new Container();
    container.visible = false;
    const entry: Entry = {
      container,
      getReference: () => null,
      config: {},
      layout: () => EMPTY_SIZE,
      active: false,
      z: 0,
      dirty: true,
      referenceRect: null,
      viewportWidth: Number.NaN,
      viewportHeight: Number.NaN,
    };
    this.entries.add(entry);
    if (this.layer) this.layer.addChild(container);

    return {
      container,
      setReference: (get) => {
        entry.getReference = get;
        entry.dirty = true;
      },
      setConfig: (cfg) => {
        entry.config = { ...cfg };
        entry.dirty = true;
      },
      setLayout: (fn) => {
        entry.layout = fn;
        entry.dirty = true;
      },
      invalidateLayout: () => {
        entry.dirty = true;
      },
      setActive: (active) => {
        if (active && !entry.active) entry.dirty = true;
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
      if (!ref) {
        e.container.visible = false;
        e.dirty = true;
        continue;
      }

      if (!this.readReferenceRect(ref, this.currentReferenceRect)) {
        e.container.visible = false;
        e.dirty = true;
        continue;
      }

      const triggerRect = this.currentReferenceRect;
      const inputsChanged =
        e.dirty ||
        !sameRect(e.referenceRect, triggerRect) ||
        e.viewportWidth !== viewport.width ||
        e.viewportHeight !== viewport.height;
      if (!inputsChanged) {
        e.container.visible = true;
        continue;
      }

      const cfg = e.config;
      // Natural size (shrink-to-content, capped only by an explicit
      // maxWidth), then re-cap to the space available at the resolved side
      // so a wide bubble wraps instead of running off-screen.
      let size = EMPTY_SIZE;
      runUICallback("UI floating layout", () => {
        size = e.layout(cfg.maxWidth);
      });
      let pos = computePosition(triggerRect, size, viewport, cfg);
      const effMax = Math.min(cfg.maxWidth ?? Infinity, pos.available.width);
      if (size.width > effMax + 0.5) {
        runUICallback("UI floating layout", () => {
          size = e.layout(effMax);
        });
        pos = computePosition(triggerRect, size, viewport, cfg);
      }

      e.container.position.set(pos.x, pos.y);
      e.container.visible = true;
      e.referenceRect ??= { x: 0, y: 0, width: 0, height: 0 };
      e.referenceRect.x = triggerRect.x;
      e.referenceRect.y = triggerRect.y;
      e.referenceRect.width = triggerRect.width;
      e.referenceRect.height = triggerRect.height;
      e.viewportWidth = viewport.width;
      e.viewportHeight = viewport.height;
      e.dirty = false;
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
  private readReferenceRect(ref: UIElement, out: Rect): boolean {
    const layer = this.layer;
    if (!layer) return false;
    const w = ref.yogaNode.getComputedWidth();
    const h = ref.yogaNode.getComputedHeight();
    if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
    this.referenceBottomRightInput.x = w;
    this.referenceBottomRightInput.y = h;
    const a = layer.toLocal(ZERO, ref.displayObject, this.referenceTopLeft);
    const b = layer.toLocal(
      this.referenceBottomRightInput,
      ref.displayObject,
      this.referenceBottomRight,
    );
    out.x = Math.min(a.x, b.x);
    out.y = Math.min(a.y, b.y);
    out.width = Math.abs(b.x - a.x);
    out.height = Math.abs(b.y - a.y);
    return true;
  }
}

/**
 * Lay out a stack of UI nodes shrink-to-content (optionally capped by
 * `maxWidth`, which wraps text). Returns the stacked content size. Shared by
 * `attachTooltip` (a single node) and the React side (reconciler roots).
 */
export function layoutFloat(
  insts: readonly UIElement[],
  maxWidth: number | undefined,
): Dimensions {
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

/** Per-scene key, registered by `UIPlugin`'s scene hooks. */
export const FloatingOverlayKey = new ServiceKey<FloatingOverlay>(
  "floatingOverlay",
  { scope: "scene" },
);

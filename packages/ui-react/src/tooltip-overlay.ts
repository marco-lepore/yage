import { createContext } from "react";
import type { ReactNode } from "react";
import type { Container } from "pixi.js";
import type { UIElement } from "@yagejs/ui";

/** Side of the trigger the bubble is placed on. */
export type TooltipPlacement = "top" | "bottom" | "left" | "right";

/**
 * One live tooltip the overlay is responsible for. `getTrigger` returns the
 * wrapper element the tooltip is attached to (a `UIElement`, resolved via a
 * React ref); `bubbleEl` is filled in by the host once the bubble mounts.
 */
export interface TooltipEntry {
  id: number;
  node: ReactNode;
  placement: TooltipPlacement;
  offset: number;
  getTrigger: () => UIElement | null;
  bubbleEl: UIElement | null;
}

/**
 * Cross-axis-start placement math (matches the documented Tooltip
 * behaviour). Returns the bubble's top-left in the same coordinate space the
 * `trigger` rect is given in. Pure — unit-tested in isolation.
 */
export function tooltipBubbleXY(
  trigger: { x: number; y: number; w: number; h: number },
  bubble: { w: number; h: number },
  placement: TooltipPlacement,
  offset: number,
): { x: number; y: number } {
  switch (placement) {
    case "bottom":
      return { x: trigger.x, y: trigger.y + trigger.h + offset };
    case "top":
      return { x: trigger.x, y: trigger.y - bubble.h - offset };
    case "right":
      return { x: trigger.x + trigger.w + offset, y: trigger.y };
    case "left":
      return { x: trigger.x - bubble.w - offset, y: trigger.y };
  }
}

const ZERO = { x: 0, y: 0 } as const;

/**
 * Per-`UIRoot` registry that owns the floating tooltip bubbles. Tooltips
 * `register()` while hovered; the overlay host renders one absolutely-
 * positioned bubble per entry inside a viewport-sized, top-most, unclipped
 * container (so bubbles never get occluded by later siblings, clipped by a
 * `ScrollView` mask, or wrap-constrained by a small trigger). Each frame
 * `position()` re-derives every bubble's screen point from its trigger's
 * post-layout geometry and writes it straight to the Pixi display object —
 * no React churn per frame.
 */
export class TooltipController {
  private readonly entries = new Map<number, TooltipEntry>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private snapshot: TooltipEntry[] = [];

  register(e: Omit<TooltipEntry, "id" | "bubbleEl">): number {
    const id = this.nextId++;
    this.entries.set(id, { ...e, id, bubbleEl: null });
    this.rebuild();
    return id;
  }

  update(id: number, e: Omit<TooltipEntry, "id" | "bubbleEl">): void {
    const cur = this.entries.get(id);
    if (!cur) return;
    this.entries.set(id, { ...cur, ...e });
    this.rebuild();
  }

  unregister(id: number): void {
    if (this.entries.delete(id)) this.rebuild();
  }

  /** Host wires the mounted bubble element back so `position()` can move it. */
  attachBubble(id: number, el: UIElement | null): void {
    const e = this.entries.get(id);
    if (e) e.bubbleEl = el;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** Stable reference between mutations so `useSyncExternalStore` bails out. */
  getSnapshot = (): TooltipEntry[] => this.snapshot;

  /**
   * Re-anchor every bubble. `root` is the `UIRoot` container — the shared
   * coordinate space for both the trigger tree and the overlay, so a
   * trigger's position relative to it maps straight onto the overlay.
   */
  position(root: Container): void {
    for (const e of this.entries.values()) {
      const trigger = e.getTrigger();
      const bubble = e.bubbleEl;
      if (!trigger || !bubble) continue;
      const tl = root.toLocal(ZERO, trigger.displayObject);
      const tw = trigger.yogaNode.getComputedWidth();
      const th = trigger.yogaNode.getComputedHeight();
      const bw = bubble.yogaNode.getComputedWidth();
      const bh = bubble.yogaNode.getComputedHeight();
      const pos = tooltipBubbleXY(
        { x: tl.x, y: tl.y, w: tw, h: th },
        { w: bw, h: bh },
        e.placement,
        e.offset,
      );
      bubble.displayObject.position.set(pos.x, pos.y);
    }
  }

  private rebuild(): void {
    this.snapshot = [...this.entries.values()];
    for (const cb of this.listeners) cb();
  }
}

/**
 * Provided by `UIRoot` so `<Tooltip>` can hoist its bubble into the root's
 * top overlay. Absent (e.g. a `<Tooltip>` rendered without a `UIRoot`) →
 * the component falls back to inline rendering.
 */
export const TooltipOverlayCtx = createContext<TooltipController | null>(null);

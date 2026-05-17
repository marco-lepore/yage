import { describe, it, expect, vi } from "vitest";
import type { Container } from "pixi.js";
import type { UIElement } from "@yagejs/ui";
import { TooltipController, tooltipBubbleXY } from "./tooltip-overlay.js";

describe("tooltipBubbleXY", () => {
  const trigger = { x: 100, y: 50, w: 60, h: 24 };
  const bubble = { w: 120, h: 30 };
  const off = 6;

  it("bottom: directly below, start-aligned", () => {
    expect(tooltipBubbleXY(trigger, bubble, "bottom", off)).toEqual({
      x: 100,
      y: 50 + 24 + 6,
    });
  });

  it("top: lifted by the bubble's own height + offset", () => {
    expect(tooltipBubbleXY(trigger, bubble, "top", off)).toEqual({
      x: 100,
      y: 50 - 30 - 6,
    });
  });

  it("right: past the trigger's right edge", () => {
    expect(tooltipBubbleXY(trigger, bubble, "right", off)).toEqual({
      x: 100 + 60 + 6,
      y: 50,
    });
  });

  it("left: shifted left by the bubble's own width + offset", () => {
    expect(tooltipBubbleXY(trigger, bubble, "left", off)).toEqual({
      x: 100 - 120 - 6,
      y: 50,
    });
  });
});

/** Minimal UIElement stand-in with a controllable computed size + position. */
function fakeEl(w: number, h: number): {
  el: UIElement;
  pos: { x: number; y: number };
} {
  const pos = { x: 0, y: 0 };
  const el = {
    displayObject: { position: { set: (x: number, y: number) => { pos.x = x; pos.y = y; } } },
    yogaNode: { getComputedWidth: () => w, getComputedHeight: () => h },
  } as unknown as UIElement;
  return { el, pos };
}

describe("TooltipController", () => {
  it("register / unregister drive a stable snapshot reference", () => {
    const c = new TooltipController();
    const s0 = c.getSnapshot();
    expect(s0).toEqual([]);

    const id = c.register({
      node: null,
      placement: "top",
      offset: 6,
      getTrigger: () => null,
    });
    const s1 = c.getSnapshot();
    expect(s1).toHaveLength(1);
    // Same reference until the next mutation (so useSyncExternalStore bails).
    expect(c.getSnapshot()).toBe(s1);

    c.unregister(id);
    expect(c.getSnapshot()).toEqual([]);
  });

  it("notifies subscribers on register and unregister", () => {
    const c = new TooltipController();
    const cb = vi.fn();
    const unsub = c.subscribe(cb);
    const id = c.register({ node: null, placement: "top", offset: 6, getTrigger: () => null });
    c.unregister(id);
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("position() writes the bubble display position from trigger geometry", () => {
    const c = new TooltipController();
    const trigger = fakeEl(60, 24).el;
    const bubble = fakeEl(120, 30);

    const id = c.register({
      node: null,
      placement: "top",
      offset: 6,
      getTrigger: () => trigger,
    });
    c.attachBubble(id, bubble.el);

    // Root maps the trigger's origin to (200, 80) in overlay space.
    const root = {
      toLocal: vi.fn(() => ({ x: 200, y: 80 })),
    } as unknown as Container;

    c.position(root);

    // top placement → x = triggerX, y = triggerY - bubbleH - offset.
    expect(bubble.pos).toEqual({ x: 200, y: 80 - 30 - 6 });
  });

  it("position() skips entries whose trigger or bubble is missing", () => {
    const c = new TooltipController();
    c.register({ node: null, placement: "bottom", offset: 4, getTrigger: () => null });
    const root = { toLocal: vi.fn() } as unknown as Container;
    expect(() => c.position(root)).not.toThrow();
    expect((root.toLocal as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

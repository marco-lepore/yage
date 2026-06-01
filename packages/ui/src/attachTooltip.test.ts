import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js Container so `FloatingOverlay.acquire()` (and `attachTooltip`)
// run without a real renderer. `toLocal` returns the point unchanged — the
// trigger sits at the overlay origin — so positioning is the pure
// `computePosition` output for the reported reference rect.
const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    visible = false;
    zIndex = 0;
    sortableChildren = false;
    destroyed = false;
    position = {
      x: 0,
      y: 0,
      set(this: { x: number; y: number }, ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

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

    toLocal(p: { x: number; y: number }): { x: number; y: number } {
      return { x: p.x, y: p.y };
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }
  }
  return { mocks: { MockContainer } };
});

vi.mock("pixi.js", () => ({ Container: mocks.MockContainer }));

import { FloatingOverlay, FloatingOverlayKey } from "./floating.js";
import { attachTooltip } from "./attachTooltip.js";
import type { TooltipTrigger } from "./attachTooltip.js";
import type { UIElement } from "./types.js";

// A UIElement standing in for the laid-out tooltip content. Its yoga node
// reports a fixed size so `layoutFloat` produces a deterministic bubble.
function makeContent(width = 80, height = 24): UIElement {
  const displayObject = new mocks.MockContainer() as unknown as UIElement["displayObject"];
  let destroyed = false;
  return {
    displayObject,
    yogaNode: {
      setMaxWidth: () => undefined,
      calculateLayout: () => undefined,
      getComputedWidth: () => width,
      getComputedHeight: () => height,
    } as unknown as UIElement["yogaNode"],
    get visible() {
      return true;
    },
    set visible(_v: boolean) {
      /* noop */
    },
    applyLayout: () => undefined,
    update: () => undefined,
    destroy: () => {
      destroyed = true;
      (displayObject as unknown as { destroy(): void }).destroy();
    },
    get _destroyed() {
      return destroyed;
    },
  } as unknown as UIElement;
}

// A trigger that fans hover out to its own `onHover` (optional) plus any
// additive `watchHover` subscribers — mirroring the real PointerEvents
// two-tier model. `ownHover` lets a test assert the trigger's own handler
// survives a tooltip attach/dispose (the clobber regression). `watcherCount`
// asserts the tooltip's subscription is added on attach and dropped on
// dispose, without it ever owning the trigger's `onHover` slot.
function makeTrigger(ownHover?: (h: boolean) => void): TooltipTrigger & {
  hover(h: boolean): void;
  watcherCount(): number;
} {
  const displayObject = new mocks.MockContainer() as unknown as UIElement["displayObject"];
  const watchers = new Set<(h: boolean) => void>();
  return {
    displayObject,
    yogaNode: {
      getComputedWidth: () => 40,
      getComputedHeight: () => 40,
    } as unknown as UIElement["yogaNode"],
    visible: true,
    watchHover(fn: (h: boolean) => void): () => void {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    destroy: () => undefined,
    hover(h: boolean) {
      ownHover?.(h);
      for (const fn of [...watchers]) fn(h);
    },
    watcherCount() {
      return watchers.size;
    },
  } as TooltipTrigger & {
    hover(h: boolean): void;
    watcherCount(): number;
  };
}

// A scene-like object exposing only `_resolveScoped`, returning a real
// overlay already attached to a layer with a `toLocal`.
function makeScene(overlay: FloatingOverlay | undefined) {
  const layer = new mocks.MockContainer();
  if (overlay) {
    overlay.attach({
      ensureLayer: () => ({ container: layer }),
    } as never);
  }
  return {
    scene: {
      _resolveScoped: <T>(key: { id: string }): T | undefined =>
        key === (FloatingOverlayKey as unknown as { id: string })
          ? (overlay as unknown as T)
          : undefined,
    } as never,
    layer,
    overlay,
  };
}

const VIEWPORT = { width: 800, height: 600 };

describe("attachTooltip", () => {
  let overlay: FloatingOverlay;

  beforeEach(() => {
    overlay = new FloatingOverlay();
  });

  it("hover shows + positions the bubble; pointer-out hides it", () => {
    const { scene } = makeScene(overlay);
    const trigger = makeTrigger();
    const content = makeContent(80, 24);

    attachTooltip(trigger, scene, {
      content: () => content,
      placement: "bottom",
      offset: 6,
    });

    // Not hovered → tick keeps it hidden.
    overlay.update(VIEWPORT);
    expect(content.displayObject.parent).not.toBeNull(); // parented eagerly

    // Hover → active; next overlay tick positions + shows it.
    trigger.hover(true);
    overlay.update(VIEWPORT);

    const bubble = content.displayObject.parent!;
    expect(bubble.visible).toBe(true);
    // bottom placement: y = ref.y(0) + ref.h(40) + offset(6) = 46.
    expect(bubble.position.y).toBe(46);

    // Pointer-out → hidden on the next tick.
    trigger.hover(false);
    overlay.update(VIEWPORT);
    expect(bubble.visible).toBe(false);
  });

  it("dispose detaches hover + releases the overlay slot", () => {
    const { scene } = makeScene(overlay);
    const trigger = makeTrigger();
    const content = makeContent();

    const dispose = attachTooltip(trigger, scene, { content: () => content });
    expect(trigger.watcherCount()).toBe(1);
    const bubble = content.displayObject.parent!;

    dispose();

    expect(trigger.watcherCount()).toBe(0);
    // Slot released → its container destroyed and no longer ticked.
    expect((bubble as unknown as { destroyed: boolean }).destroyed).toBe(true);
    // A post-dispose hover does nothing (subscription dropped).
    trigger.hover(true);
    overlay.update(VIEWPORT);
    expect(bubble.visible).toBe(false);
  });

  it("composes with — does not clobber — the trigger's own onHover", () => {
    const { scene } = makeScene(overlay);
    const own = vi.fn();
    const trigger = makeTrigger(own);
    const content = makeContent();

    const dispose = attachTooltip(trigger, scene, { content: () => content });
    const bubble = content.displayObject.parent!;

    // Hover drives BOTH the trigger's own handler and the tooltip.
    trigger.hover(true);
    overlay.update(VIEWPORT);
    expect(own).toHaveBeenLastCalledWith(true);
    expect(bubble.visible).toBe(true);

    trigger.hover(false);
    overlay.update(VIEWPORT);
    expect(own).toHaveBeenLastCalledWith(false);
    expect(bubble.visible).toBe(false);

    // Dispose drops only the tooltip's subscription — the own handler lives on.
    dispose();
    own.mockClear();
    trigger.hover(true);
    overlay.update(VIEWPORT);
    expect(own).toHaveBeenCalledWith(true); // still firing
    expect(bubble.visible).toBe(false); // tooltip gone
  });

  it("throws when the scene has no FloatingOverlay", () => {
    const { scene } = makeScene(undefined);
    const trigger = makeTrigger();
    expect(() =>
      attachTooltip(trigger, scene, { content: () => makeContent() }),
    ).toThrow(/FloatingOverlay/);
  });
});

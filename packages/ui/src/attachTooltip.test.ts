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

// A trigger that records hover wiring and reports a fixed on-screen rect.
function makeTrigger(): TooltipTrigger & {
  hover(h: boolean): void;
  onHoverHandler: ((h: boolean) => void) | undefined;
} {
  const displayObject = new mocks.MockContainer() as unknown as UIElement["displayObject"];
  let onHoverHandler: ((h: boolean) => void) | undefined;
  return {
    displayObject,
    yogaNode: {
      getComputedWidth: () => 40,
      getComputedHeight: () => 40,
    } as unknown as UIElement["yogaNode"],
    visible: true,
    update: (props: { onHover?: ((h: boolean) => void) | undefined }) => {
      if ("onHover" in props) onHoverHandler = props.onHover;
    },
    destroy: () => undefined,
    hover(h: boolean) {
      onHoverHandler?.(h);
    },
    get onHoverHandler() {
      return onHoverHandler;
    },
  } as TooltipTrigger & {
    hover(h: boolean): void;
    onHoverHandler: ((h: boolean) => void) | undefined;
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
    expect(trigger.onHoverHandler).toBeDefined();
    const bubble = content.displayObject.parent!;

    dispose();

    expect(trigger.onHoverHandler).toBeUndefined();
    // Slot released → its container destroyed and no longer ticked.
    expect((bubble as unknown as { destroyed: boolean }).destroyed).toBe(true);
    // A post-dispose hover does nothing (handler cleared).
    trigger.hover(true);
    overlay.update(VIEWPORT);
    expect(bubble.visible).toBe(false);
  });

  it("throws when the scene has no FloatingOverlay", () => {
    const { scene } = makeScene(undefined);
    const trigger = makeTrigger();
    expect(() =>
      attachTooltip(trigger, scene, { content: () => makeContent() }),
    ).toThrow(/FloatingOverlay/);
  });
});

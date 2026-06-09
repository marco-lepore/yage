import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pixi.js Container so `FloatingOverlay.acquire()` (and `attachTooltip`)
// run without a real renderer. `toLocal` returns the point unchanged — the
// anchor sits at the overlay origin — so positioning is the pure
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
import { UIPanel } from "./UIPanel.js";
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

// A pure-geometry anchor: reports a fixed on-screen rect and counts any
// `update()` calls — so a test can prove `attachTooltip` only reads the
// anchor's geometry and never wires hover (or anything else) onto it.
function makeAnchor(): UIElement & { readonly updateCalls: number } {
  const displayObject = new mocks.MockContainer() as unknown as UIElement["displayObject"];
  let updateCalls = 0;
  return {
    displayObject,
    yogaNode: {
      getComputedWidth: () => 40,
      getComputedHeight: () => 40,
    } as unknown as UIElement["yogaNode"],
    visible: true,
    update: () => {
      updateCalls += 1;
    },
    destroy: () => undefined,
    get updateCalls() {
      return updateCalls;
    },
  } as unknown as UIElement & { readonly updateCalls: number };
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

  it("setActive shows + positions the bubble; setActive(false) hides it", () => {
    const { scene } = makeScene(overlay);
    const anchor = makeAnchor();
    const content = makeContent(80, 24);

    const tip = attachTooltip(anchor, scene, {
      content: () => content,
      placement: "bottom",
      offset: 6,
    });

    // Inert until driven → a tick keeps it hidden (but parented eagerly).
    overlay.update(VIEWPORT);
    expect(content.displayObject.parent).not.toBeNull();
    const bubble = content.displayObject.parent!;
    expect(bubble.visible).toBe(false);

    // setActive(true) → next overlay tick positions + shows it.
    tip.setActive(true);
    overlay.update(VIEWPORT);
    expect(bubble.visible).toBe(true);
    // bottom placement: y = ref.y(0) + ref.h(40) + offset(6) = 46.
    expect(bubble.position.y).toBe(46);

    // setActive(false) → hidden on the next tick.
    tip.setActive(false);
    overlay.update(VIEWPORT);
    expect(bubble.visible).toBe(false);
  });

  it("wires no input on the anchor — activation is the caller's", () => {
    const { scene } = makeScene(overlay);
    const anchor = makeAnchor();

    attachTooltip(anchor, scene, { content: () => makeContent() });

    // The decouple guarantee: `attachTooltip` only reads the anchor's
    // geometry — it never calls `update()` / wires `onHover` — so it cannot
    // clobber the anchor's own handlers. Composition is the caller's
    // explicit `anchor.update({ onHover: tip.setActive })`.
    expect(anchor.updateCalls).toBe(0);
  });

  it("accepts a root UIPanel and anchors to its node", () => {
    const { scene } = makeScene(overlay);
    // A UIPanel is a Component wrapping a PanelNode. Stand one in without a
    // real Yoga/Pixi build (Object.create skips the constructor), then point
    // its `_node` at our geometry stub so we can assert attachTooltip unwraps.
    const node = makeAnchor();
    const panel = Object.create(UIPanel.prototype) as UIPanel;
    (panel as unknown as { _node: UIElement })._node = node;
    const content = makeContent(80, 24);

    const tip = attachTooltip(panel, scene, {
      content: () => content,
      placement: "bottom",
      offset: 6,
    });
    tip.setActive(true);
    overlay.update(VIEWPORT);

    const bubble = content.displayObject.parent!;
    expect(bubble.visible).toBe(true);
    // Positioned from the node's 40×40 geometry — proof the panel was unwrapped:
    // bottom placement y = ref.y(0) + ref.h(40) + offset(6) = 46.
    expect(bubble.position.y).toBe(46);
  });

  it("dispose releases the overlay slot and is safe to over-drive", () => {
    const { scene } = makeScene(overlay);
    const anchor = makeAnchor();
    const content = makeContent();

    const tip = attachTooltip(anchor, scene, { content: () => content });
    const bubble = content.displayObject.parent!;

    tip.dispose();

    // Slot released → its container destroyed and no longer ticked.
    expect((bubble as unknown as { destroyed: boolean }).destroyed).toBe(true);
    // A stale `onHover: tip.setActive` wiring can outlive the tooltip; the
    // guard makes post-dispose activation a no-op (never touches the freed
    // slot) and dispose() idempotent.
    expect(() => {
      tip.setActive(true);
      tip.setActive(false);
      tip.dispose();
    }).not.toThrow();
    overlay.update(VIEWPORT);
    expect(bubble.visible).toBe(false);
  });

  it("throws when the scene has no FloatingOverlay", () => {
    const { scene } = makeScene(undefined);
    const anchor = makeAnchor();
    expect(() =>
      attachTooltip(anchor, scene, { content: () => makeContent() }),
    ).toThrow(/FloatingOverlay/);
  });
});

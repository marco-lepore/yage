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
    private _listeners = new Map<string, Set<() => void>>();
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

    once(event: string, listener: () => void): this {
      const onceListener = (): void => {
        this.off(event, onceListener);
        listener();
      };
      const listeners = this._listeners.get(event) ?? new Set();
      listeners.add(onceListener);
      this._listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: () => void): this {
      this._listeners.get(event)?.delete(listener);
      return this;
    }

    emit(event: string): void {
      for (const listener of [...(this._listeners.get(event) ?? [])])
        listener();
    }

    toLocal(
      p: { x: number; y: number },
      from?: MockContainer,
      out?: { x: number; y: number },
    ): { x: number; y: number } {
      const result = out ?? { x: 0, y: 0 };
      result.x = p.x + (from?.position.x ?? 0);
      result.y = p.y + (from?.position.y ?? 0);
      return result;
    }

    destroy(): void {
      this.emit("destroyed");
      this.destroyed = true;
      this.removeFromParent();
    }
  }
  return { mocks: { MockContainer } };
});

vi.mock("pixi.js", () => ({ Container: mocks.MockContainer }));

import { FloatingOverlay, FloatingOverlayKey } from "./floating.js";
import { attachTooltip } from "./attachTooltip.js";
import { UISurface } from "./UISurface.js";
import type { UIElement } from "./types.js";

// A UIElement standing in for the laid-out tooltip content. Its yoga node
// reports a fixed size so `layoutFloat` produces a deterministic bubble.
function makeContent(width = 80, height = 24): UIElement {
  const displayObject =
    new mocks.MockContainer() as unknown as UIElement["displayObject"];
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
  const displayObject =
    new mocks.MockContainer() as unknown as UIElement["displayObject"];
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
    destroy: () => {
      (displayObject as unknown as { destroy(): void }).destroy();
    },
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

  it("skips stable layout and invalidates for content, trigger, viewport, and reopening", () => {
    const { layer } = makeScene(overlay);
    const anchor = makeAnchor();
    const handle = overlay.acquire();
    const layout = vi.fn(() => ({ width: 80, height: 24 }));
    handle.setReference(() => anchor);
    handle.setLayout(layout);
    handle.setConfig({ placement: "bottom" });
    handle.setActive(true);

    overlay.update(VIEWPORT);
    overlay.update(VIEWPORT);
    expect(layout).toHaveBeenCalledTimes(1);

    handle.setConfig({ placement: "bottom" });
    overlay.update(VIEWPORT);
    expect(layout).toHaveBeenCalledTimes(2);

    handle.setLayout(layout);
    overlay.update(VIEWPORT);
    expect(layout).toHaveBeenCalledTimes(3);

    handle.setReference(() => anchor);
    overlay.update(VIEWPORT);
    expect(layout).toHaveBeenCalledTimes(4);

    handle.invalidateLayout();
    overlay.update(VIEWPORT);
    expect(layout).toHaveBeenCalledTimes(5);

    const anchorDisplay = anchor.displayObject as unknown as InstanceType<
      typeof mocks.MockContainer
    >;
    anchorDisplay.position.x = 20;
    overlay.update(VIEWPORT);
    expect(layout).toHaveBeenCalledTimes(6);

    overlay.update({ width: 640, height: 480 });
    expect(layout).toHaveBeenCalledTimes(7);

    handle.setActive(false);
    handle.setActive(true);
    overlay.update({ width: 640, height: 480 });
    expect(layout).toHaveBeenCalledTimes(8);
    expect(layer.children).toContain(handle.container);
  });

  it("repositions after imperative content invalidates its cached layout", () => {
    makeScene(overlay);
    const anchor = makeAnchor();
    const handle = overlay.acquire();
    let width = 80;
    handle.setReference(() => anchor);
    handle.setLayout(() => ({ width, height: 24 }));
    handle.setConfig({ placement: "top", shift: false });
    handle.setActive(true);

    overlay.update(VIEWPORT);
    const initialX = handle.container.position.x;
    width = 160;
    overlay.update(VIEWPORT);
    expect(handle.container.position.x).toBe(initialX);

    handle.invalidateLayout();
    overlay.update(VIEWPORT);
    expect(handle.container.position.x).toBe(initialX - 40);
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

  it("anchors an entity-mounted surface via its root panel", () => {
    const { scene } = makeScene(overlay);
    // A UISurface is a Component owning a root UIPanel element. Stand one in
    // without a real Yoga/Pixi build (Object.create skips the constructor),
    // then point its `root` at our geometry stub — a caller holding a
    // surface passes `surface.root` as the anchor.
    const node = makeAnchor();
    const surface = Object.create(UISurface.prototype) as UISurface;
    (surface as unknown as { root: UIElement }).root = node;
    const content = makeContent(80, 24);

    const tip = attachTooltip(surface.root, scene, {
      content: () => content,
      placement: "bottom",
      offset: 6,
    });
    tip.setActive(true);
    overlay.update(VIEWPORT);

    const bubble = content.displayObject.parent!;
    expect(bubble.visible).toBe(true);
    // Positioned from the root's 40×40 geometry:
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

  it("disposes the tooltip when its anchor is destroyed", () => {
    const { scene } = makeScene(overlay);
    const anchor = makeAnchor();
    const content = makeContent();
    const tip = attachTooltip(anchor, scene, { content: () => content });
    tip.setActive(true);
    overlay.update(VIEWPORT);
    const bubble = content.displayObject.parent!;

    anchor.destroy();

    expect((content as unknown as { _destroyed: boolean })._destroyed).toBe(
      true,
    );
    expect((bubble as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(() => overlay.update(VIEWPORT)).not.toThrow();
  });

  it("throws when the scene has no FloatingOverlay", () => {
    const { scene } = makeScene(undefined);
    const anchor = makeAnchor();
    expect(() =>
      attachTooltip(anchor, scene, { content: () => makeContent() }),
    ).toThrow(/FloatingOverlay/);
  });
});

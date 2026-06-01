import { describe, it, expect, vi } from "vitest";
import type { Container } from "pixi.js";
import { PointerEvents } from "./pointer-events.js";

/** Minimal Pixi-Container stand-in: just the EventEmitter surface used here. */
class MockContainer {
  eventMode = "passive"; // Pixi's default for a fresh Container
  private _listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  on(event: string, fn: (...a: unknown[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(fn);
    return this;
  }
  emit(event: string): void {
    for (const fn of this._listeners.get(event) ?? []) fn();
  }
}

function setup(): { c: MockContainer; container: Container } {
  const c = new MockContainer();
  return { c, container: c as unknown as Container };
}

describe("PointerEvents", () => {
  it("routes pointerover/pointerout to onPointerOver/onPointerOut", () => {
    const { c, container } = setup();
    const onPointerOver = vi.fn();
    const onPointerOut = vi.fn();
    new PointerEvents(container, { onPointerOver, onPointerOut });

    c.emit("pointerover");
    c.emit("pointerout");

    expect(onPointerOver).toHaveBeenCalledTimes(1);
    expect(onPointerOut).toHaveBeenCalledTimes(1);
  });

  it("fires onHover(true) on enter and onHover(false) on leave", () => {
    const { c, container } = setup();
    const onHover = vi.fn();
    new PointerEvents(container, { onHover });

    c.emit("pointerover");
    c.emit("pointerout");

    expect(onHover.mock.calls).toEqual([[true], [false]]);
  });

  it("fans out to both the granular and combined callbacks together", () => {
    const { c, container } = setup();
    const onPointerOver = vi.fn();
    const onHover = vi.fn();
    new PointerEvents(container, { onPointerOver, onHover });

    c.emit("pointerover");

    expect(onPointerOver).toHaveBeenCalledTimes(1);
    expect(onHover).toHaveBeenCalledWith(true);
  });

  it("suppresses callbacks while inert (e.g. a disabled button)", () => {
    const { c, container } = setup();
    const onHover = vi.fn();
    let disabled = true;
    new PointerEvents(container, { onHover }, () => disabled);

    c.emit("pointerover");
    expect(onHover).not.toHaveBeenCalled();

    disabled = false;
    c.emit("pointerover");
    expect(onHover).toHaveBeenCalledWith(true);
  });

  it("set() swaps callbacks in place without rebinding listeners", () => {
    const { c, container } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const pe = new PointerEvents(container, { onHover: first });

    pe.set({ onHover: second });
    c.emit("pointerover");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(true);
  });

  it("set() clears a handler when the key is present but undefined", () => {
    // The shape the React reconciler emits when a JSX prop is removed:
    // `{ onHover: undefined }`. Must stop the stale callback firing.
    const { c, container } = setup();
    const onHover = vi.fn();
    const pe = new PointerEvents(container, { onHover });

    pe.set({ onHover: undefined });
    c.emit("pointerover");

    expect(onHover).not.toHaveBeenCalled();
  });

  it("upgrades a passive container to static so it is hit-tested", () => {
    // Regression: <Panel consumeInput={false} onHover> has no interactive
    // children; a passive container is not a hit-test target itself, so the
    // listener would silently never fire.
    const { c, container } = setup();
    expect(c.eventMode).toBe("passive");
    new PointerEvents(container, { onHover: vi.fn() });
    expect(c.eventMode).toBe("static");
  });

  it("leaves an explicit eventMode intact (e.g. a disabled button's none)", () => {
    const { c, container } = setup();
    c.eventMode = "none";
    new PointerEvents(container, { onHover: vi.fn() });
    expect(c.eventMode).toBe("none");
  });

  it("set() leaves an untouched handler intact (absent key = keep)", () => {
    const { c, container } = setup();
    const onHover = vi.fn();
    const onPointerOut = vi.fn();
    const pe = new PointerEvents(container, { onHover });

    // An update that only changes onPointerOut must not clear onHover.
    pe.set({ onPointerOut });
    c.emit("pointerover");
    c.emit("pointerout");

    expect(onHover).toHaveBeenCalledWith(true);
    expect(onPointerOut).toHaveBeenCalledTimes(1);
  });

  it("watchHover fires alongside the onHover prop, not instead of it", () => {
    const { c, container } = setup();
    const onHover = vi.fn();
    const watcher = vi.fn();
    const pe = new PointerEvents(container, { onHover });

    pe.watchHover(watcher);
    c.emit("pointerover");
    c.emit("pointerout");

    // Both channels fan out together — the watcher does not displace the prop.
    expect(onHover.mock.calls).toEqual([[true], [false]]);
    expect(watcher.mock.calls).toEqual([[true], [false]]);
  });

  it("watchHover unsubscribe drops only that watcher, leaving onHover intact", () => {
    const { c, container } = setup();
    const onHover = vi.fn();
    const watcher = vi.fn();
    const pe = new PointerEvents(container, { onHover });

    const unwatch = pe.watchHover(watcher);
    unwatch();
    c.emit("pointerover");

    expect(watcher).not.toHaveBeenCalled();
    expect(onHover).toHaveBeenCalledWith(true); // the prop survives
  });

  it("supports multiple independent watchers", () => {
    const { c, container } = setup();
    const a = vi.fn();
    const b = vi.fn();
    const pe = new PointerEvents(container, {});

    const unwatchA = pe.watchHover(a);
    pe.watchHover(b);
    unwatchA();
    c.emit("pointerover");

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(true);
  });

  it("suppresses watchers while inert", () => {
    const { c, container } = setup();
    const watcher = vi.fn();
    let disabled = true;
    const pe = new PointerEvents(container, {}, () => disabled);

    pe.watchHover(watcher);
    c.emit("pointerover");
    expect(watcher).not.toHaveBeenCalled();

    disabled = false;
    c.emit("pointerover");
    expect(watcher).toHaveBeenCalledWith(true);
  });

  it("a watcher may unsubscribe itself mid-emit without skipping others", () => {
    const { c, container } = setup();
    const pe = new PointerEvents(container, {});
    const seen: string[] = [];

    const unwatchSelf = pe.watchHover(() => {
      seen.push("self");
      unwatchSelf();
    });
    pe.watchHover(() => seen.push("other"));

    // The snapshot in _emitWatchers means the self-removal doesn't drop "other".
    c.emit("pointerover");
    expect(seen).toEqual(["self", "other"]);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { Container } from "pixi.js";
import { PointerEvents } from "./pointer-events.js";

/** Minimal Pixi-Container stand-in: just the EventEmitter surface used here. */
class MockContainer {
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
});

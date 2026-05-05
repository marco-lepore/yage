import { describe, it, expect, vi } from "vitest";
import { createAtom } from "./Atom.js";

describe("createAtom", () => {
  it("get() returns initial value", () => {
    const a = createAtom(7);
    expect(a.get()).toBe(7);
  });

  it("set() updates value and notifies subscribers", () => {
    const a = createAtom(0);
    const listener = vi.fn();
    a.subscribe(listener);
    a.set(1);
    expect(a.get()).toBe(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("set() is a no-op when value is identical (Object.is)", () => {
    const a = createAtom(5);
    const listener = vi.fn();
    a.subscribe(listener);
    a.set(5);
    expect(listener).not.toHaveBeenCalled();
  });

  it("treats NaN as equal to NaN (Object.is semantics)", () => {
    const a = createAtom(NaN);
    const listener = vi.fn();
    a.subscribe(listener);
    a.set(NaN);
    expect(listener).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers", () => {
    const a = createAtom(0);
    const x = vi.fn();
    const y = vi.fn();
    a.subscribe(x);
    a.subscribe(y);
    a.set(1);
    expect(x).toHaveBeenCalledTimes(1);
    expect(y).toHaveBeenCalledTimes(1);
  });

  it("subscribe returns an unsubscribe", () => {
    const a = createAtom(0);
    const listener = vi.fn();
    const off = a.subscribe(listener);
    a.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    a.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies with the new value", () => {
    const a = createAtom("a");
    let received: string | null = null;
    a.subscribe((v) => {
      received = v;
    });
    a.set("b");
    expect(received).toBe("b");
  });
});

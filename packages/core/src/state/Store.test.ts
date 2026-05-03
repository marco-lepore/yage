import { describe, it, expect, vi } from "vitest";
import { createStore } from "./Store.js";

describe("createStore", () => {
  it("get() returns frozen initial state", () => {
    const store = createStore({ score: 0, hp: 100 });
    const snap = store.get();
    expect(snap).toEqual({ score: 0, hp: 100 });
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("set() merges partial state and notifies subscribers", () => {
    const store = createStore({ score: 0, hp: 100 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ score: 50 });

    expect(store.get()).toEqual({ score: 50, hp: 100 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("set() is a no-op when values are the same (Object.is)", () => {
    const store = createStore({ score: 0, hp: 100 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ score: 0 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("set() detects change even when some keys are same", () => {
    const store = createStore({ a: 1, b: 2, c: 3 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ a: 1, c: 99 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ a: 1, b: 2, c: 99 });
  });

  it("subscribe returns unsubscribe function", () => {
    const store = createStore({ v: 0 });
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.set({ v: 1 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    store.set({ v: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports multiple subscribers", () => {
    const store = createStore({ v: 0 });
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);

    store.set({ v: 1 });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("get() returns a new frozen snapshot after set()", () => {
    const store = createStore({ v: 0 });
    const snap1 = store.get();
    store.set({ v: 1 });
    const snap2 = store.get();

    expect(snap1).not.toBe(snap2);
    expect(snap1.v).toBe(0);
    expect(snap2.v).toBe(1);
    expect(Object.isFrozen(snap2)).toBe(true);
  });

  it("snapshot reference is stable when set() is a no-op", () => {
    const store = createStore({ v: 0 });
    const snap1 = store.get();
    store.set({ v: 0 });
    const snap2 = store.get();
    expect(snap1).toBe(snap2);
  });
});

import { describe, it, expect } from "vitest";
import { StatsStore } from "./StatsStore.js";

describe("StatsStore", () => {
  it("returns 0 for unknown keys", () => {
    const store = new StatsStore();
    expect(store.average("nope")).toBe(0);
    expect(store.latest("nope")).toBe(0);
    expect(store.min("nope")).toBe(0);
    expect(store.max("nope")).toBe(0);
  });

  it("computes average", () => {
    const store = new StatsStore();
    store.push("fps", 60);
    store.push("fps", 30);
    expect(store.average("fps")).toBe(45);
  });

  it("tracks latest value", () => {
    const store = new StatsStore();
    store.push("fps", 60);
    store.push("fps", 30);
    expect(store.latest("fps")).toBe(30);
  });

  it("computes min and max", () => {
    const store = new StatsStore();
    store.push("fps", 60);
    store.push("fps", 30);
    store.push("fps", 90);
    expect(store.min("fps")).toBe(30);
    expect(store.max("fps")).toBe(90);
  });

  it("wraps around the ring buffer", () => {
    const store = new StatsStore();
    for (let i = 0; i < 130; i++) {
      store.push("x", i);
    }
    expect(store.latest("x")).toBe(129);
    // Window is 120, so oldest value is 130-120=10
    expect(store.min("x")).toBe(10);
    expect(store.max("x")).toBe(129);
  });

  it("handles single value", () => {
    const store = new StatsStore();
    store.push("v", 42);
    expect(store.average("v")).toBe(42);
    expect(store.latest("v")).toBe(42);
    expect(store.min("v")).toBe(42);
    expect(store.max("v")).toBe(42);
  });

  it("tracks independent keys", () => {
    const store = new StatsStore();
    store.push("a", 10);
    store.push("b", 20);
    expect(store.average("a")).toBe(10);
    expect(store.average("b")).toBe(20);
  });
});

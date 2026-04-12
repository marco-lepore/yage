import { describe, it, expect } from "vitest";
import { DebugRegistryImpl } from "./DebugRegistryImpl.js";
import type { DebugContributor } from "./types.js";

function makeContributor(
  name: string,
  flags: string[] = [],
): DebugContributor {
  return { name, flags };
}

describe("DebugRegistryImpl", () => {
  it("registers a contributor", () => {
    const reg = new DebugRegistryImpl();
    reg.register(makeContributor("test"));
    expect(reg.contributors.has("test")).toBe(true);
  });

  it("is idempotent for the same name", () => {
    const reg = new DebugRegistryImpl();
    const c1 = makeContributor("test");
    const c2 = makeContributor("test");
    reg.register(c1);
    reg.register(c2);
    expect(reg.contributors.get("test")).toBe(c1);
  });

  it("defaults flags to true", () => {
    const reg = new DebugRegistryImpl();
    reg.register(makeContributor("test", ["a", "b"]));
    expect(reg.isFlagEnabled("test", "a")).toBe(true);
    expect(reg.isFlagEnabled("test", "b")).toBe(true);
  });

  it("returns true for unknown flags", () => {
    const reg = new DebugRegistryImpl();
    expect(reg.isFlagEnabled("unknown", "flag")).toBe(true);
  });

  it("toggles global enabled state", () => {
    const reg = new DebugRegistryImpl();
    expect(reg.isEnabled()).toBe(false);
    reg.toggle();
    expect(reg.isEnabled()).toBe(true);
    reg.toggle();
    expect(reg.isEnabled()).toBe(false);
  });

  it("toggles individual flags", () => {
    const reg = new DebugRegistryImpl();
    reg.register(makeContributor("test", ["a"]));
    expect(reg.isFlagEnabled("test", "a")).toBe(true);
    reg.toggleFlag("test", "a");
    expect(reg.isFlagEnabled("test", "a")).toBe(false);
    reg.toggleFlag("test", "a");
    expect(reg.isFlagEnabled("test", "a")).toBe(true);
  });

  it("sets flags explicitly", () => {
    const reg = new DebugRegistryImpl();
    reg.register(makeContributor("test", ["a"]));
    reg.setFlag("test", "a", false);
    expect(reg.isFlagEnabled("test", "a")).toBe(false);
    reg.setFlag("test", "a", true);
    expect(reg.isFlagEnabled("test", "a")).toBe(true);
  });
});

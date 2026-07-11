import { describe, expect, it } from "vitest";
import { createMockScene } from "@yagejs/core";
import { interactableRegistryFor } from "./registry.js";
import type { Interactable } from "../Interactable.js";

// The registry only needs object identity from its members — a plain object
// stands in for `Interactable` here so these tests stay in `core/` with no
// dependency on the Component-based class.
function fakeInteractable(): Interactable {
  return {} as Interactable;
}

describe("interactableRegistryFor", () => {
  it("returns the same instance for repeated calls on one scene", () => {
    const { scene } = createMockScene();
    expect(interactableRegistryFor(scene)).toBe(interactableRegistryFor(scene));
  });

  it("returns a distinct instance per scene", () => {
    const { scene: sceneA } = createMockScene("a");
    const { scene: sceneB } = createMockScene("b");
    expect(interactableRegistryFor(sceneA)).not.toBe(interactableRegistryFor(sceneB));
  });

  it("iterating reflects the live registered set", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const a = fakeInteractable();
    const b = fakeInteractable();
    registry.register(a);
    registry.register(b);
    expect([...registry]).toEqual([a, b]);
  });

  it("register returns increasing registration order", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    expect(registry.register(fakeInteractable())).toBe(0);
    expect(registry.register(fakeInteractable())).toBe(1);
    expect(registry.register(fakeInteractable())).toBe(2);
  });

  it("unregister removes only the matching instance", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const a = fakeInteractable();
    const b = fakeInteractable();
    registry.register(a);
    registry.register(b);
    registry.unregister(a);
    expect([...registry]).toEqual([b]);
  });

  it("unregister of a non-member is a no-op", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const a = fakeInteractable();
    registry.register(a);
    registry.unregister(fakeInteractable());
    expect([...registry]).toEqual([a]);
  });
});

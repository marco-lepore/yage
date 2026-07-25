import { describe, expect, it } from "vitest";
import { createMockScene } from "@yagejs/core";
import { interactableRegistryFor, interactablesIn } from "./registry.js";
import type { Interactable } from "../Interactable.js";

// The registry needs object identity plus the host's destroyed flag (the live
// filter `interactablesIn` applies). A plain object stands in for `Interactable`
// here so these tests stay in `core/` with no dependency on the Component class.
function fakeInteractable(isDestroyed = false): Interactable {
  return { entity: { isDestroyed } } as Interactable;
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

  it("claimOrder hands out increasing registration order", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    expect(registry.claimOrder()).toBe(0);
    expect(registry.claimOrder()).toBe(1);
    expect(registry.claimOrder()).toBe(2);
  });

  it("re-registering the same interactable does not duplicate it", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const a = fakeInteractable();
    registry.register(a);
    registry.unregister(a);
    registry.register(a);
    expect([...registry]).toEqual([a]);
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

  it("has reflects membership", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const a = fakeInteractable();
    registry.register(a);
    expect(registry.has(a)).toBe(true);
    registry.unregister(a);
    expect(registry.has(a)).toBe(false);
    expect(registry.has(fakeInteractable())).toBe(false);
  });
});

describe("interactablesIn", () => {
  it("returns every registered interactable in the scene, in registration order", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const a = fakeInteractable();
    const b = fakeInteractable();
    registry.register(a);
    registry.register(b);
    expect(interactablesIn(scene)).toEqual([a, b]);
  });

  it("is empty for a scene with no interactables", () => {
    const { scene } = createMockScene();
    expect(interactablesIn(scene)).toEqual([]);
  });

  it("excludes interactables whose host is already destroyed", () => {
    const { scene } = createMockScene();
    const registry = interactableRegistryFor(scene);
    const live = fakeInteractable();
    const destroyed = fakeInteractable(true);
    registry.register(live);
    registry.register(destroyed);

    // A destroyed entity stays registered until the end-of-frame teardown, so
    // the scene query has to filter it out itself.
    expect(interactablesIn(scene)).toEqual([live]);
  });
});

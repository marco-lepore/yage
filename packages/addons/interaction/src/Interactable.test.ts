import { describe, expect, it, vi } from "vitest";
import { createMockScene, Transform } from "@yagejs/core";
import { Interactable } from "./Interactable.js";
import { interactableRegistryFor } from "./core/registry.js";

describe("Interactable", () => {
  it("registers into the scene registry on add and unregisters on destroy", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(new Interactable({ onInteract: () => {} }));

    const registry = interactableRegistryFor(scene);
    expect([...registry]).toContain(interactable);

    entity.destroy();
    scene._flushDestroyQueue();
    expect([...registry]).not.toContain(interactable);
  });

  it("radius and priority default to 0", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(new Interactable({ onInteract: () => {} }));
    expect(interactable.radius).toBe(0);
    expect(interactable.priority).toBe(0);
  });

  it("radius and priority take the configured values", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(
      new Interactable({ onInteract: () => {}, radius: 12, priority: 5 }),
    );
    expect(interactable.radius).toBe(12);
    expect(interactable.priority).toBe(5);
  });

  it("prompt resolves a static string", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(new Interactable({ onInteract: () => {}, prompt: "Open" }));
    expect(interactable.prompt).toBe("Open");
  });

  it("prompt resolves a live provider each read", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("lever");
    entity.add(new Transform());
    let on = false;
    const interactable = entity.add(
      new Interactable({ onInteract: () => {}, prompt: () => (on ? "Turn off" : "Turn on") }),
    );
    expect(interactable.prompt).toBe("Turn on");
    on = true;
    expect(interactable.prompt).toBe("Turn off");
  });

  it("prompt is undefined when omitted", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(new Interactable({ onInteract: () => {} }));
    expect(interactable.prompt).toBeUndefined();
  });

  it("isEnabled resolves a static boolean, defaulting true", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const enabledDefault = entity.add(new Interactable({ onInteract: () => {} }));
    expect(enabledDefault.isEnabled()).toBe(true);

    const other = scene.spawn("locked-chest");
    other.add(new Transform());
    const disabled = other.add(new Interactable({ onInteract: () => {}, enabled: false }));
    expect(disabled.isEnabled()).toBe(false);
  });

  it("isEnabled resolves a live provider each read", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("door");
    entity.add(new Transform());
    let busy = false;
    const interactable = entity.add(
      new Interactable({ onInteract: () => {}, enabled: () => !busy }),
    );
    expect(interactable.isEnabled()).toBe(true);
    busy = true;
    expect(interactable.isEnabled()).toBe(false);
  });

  it("interact() calls the configured onInteract handler", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const onInteract = vi.fn();
    const interactable = entity.add(new Interactable({ onInteract }));
    interactable.interact();
    expect(onInteract).toHaveBeenCalledTimes(1);
  });
});

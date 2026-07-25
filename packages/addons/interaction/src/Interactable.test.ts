import { describe, expect, it, vi } from "vitest";
import { createMockScene, Logger, LoggerKey, LogLevel, Transform } from "@yagejs/core";
import { Interactable } from "./Interactable.js";
import { interactableRegistryFor, interactablesIn } from "./core/registry.js";

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

  it("leaves the registry while the component is disabled and rejoins on enable", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(new Interactable({ onInteract: () => {} }));
    const registry = interactableRegistryFor(scene);

    interactable.enabled = false;
    expect(registry.has(interactable)).toBe(false);

    interactable.enabled = true;
    expect(registry.has(interactable)).toBe(true);
  });

  it("a dormant entity's interactable is not a focus candidate", () => {
    const { scene } = createMockScene();
    const entity = scene.spawn("chest");
    entity.add(new Transform());
    const interactable = entity.add(new Interactable({ onInteract: () => {} }));
    const registry = interactableRegistryFor(scene);

    entity.setActive(false);
    expect(registry.has(interactable)).toBe(false);
    expect(interactablesIn(scene)).toEqual([]);

    entity.setActive(true);
    expect(registry.has(interactable)).toBe(true);
  });

  it("keeps its registration order across a dormant period", () => {
    const { scene } = createMockScene();
    const first = scene.spawn("first");
    first.add(new Transform());
    const firstInteractable = first.add(new Interactable({ onInteract: () => {} }));

    const second = scene.spawn("second");
    second.add(new Transform());
    const secondInteractable = second.add(new Interactable({ onInteract: () => {} }));

    expect(firstInteractable.order).toBe(0);
    expect(secondInteractable.order).toBe(1);

    // The tie-break must not renumber, or a target that blinked off screen
    // would jump the focus queue on its way back.
    first.setActive(false);
    first.setActive(true);
    expect(firstInteractable.order).toBe(0);
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

  it("warns (dev) when radius is negative — the reach test would square it back positive", () => {
    const { scene } = createMockScene();
    const logger = new Logger({ level: LogLevel.Debug });
    scene.context.register(LoggerKey, logger);
    const warn = vi.spyOn(logger, "warn");

    const entity = scene.spawn("chest");
    entity.add(new Transform());
    entity.add(new Interactable({ onInteract: () => {}, radius: -10 }));

    const warns = warn.mock.calls.filter((c) => c[0] === "interaction");
    expect(warns).toHaveLength(1);
    expect(warns[0]?.[1]).toMatch(/radius is -10/);
  });

  it("does not warn for a non-negative radius", () => {
    const { scene } = createMockScene();
    const logger = new Logger({ level: LogLevel.Debug });
    scene.context.register(LoggerKey, logger);
    const warn = vi.spyOn(logger, "warn");

    const entity = scene.spawn("chest");
    entity.add(new Transform());
    entity.add(new Interactable({ onInteract: () => {}, radius: 0 }));

    expect(warn.mock.calls.filter((c) => c[0] === "interaction")).toHaveLength(0);
  });
});

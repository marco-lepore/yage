import { describe, expect, it, vi } from "vitest";
import { createMockScene, Logger, LoggerKey, LogLevel, Transform } from "@yagejs/core";
import { InputManagerKey, type InputManager } from "@yagejs/input";
import { Interactor } from "./Interactor.js";
import { Interactable } from "./Interactable.js";
import { InteractedEvent, InteractionFocusChangedEvent } from "./events.js";

function fakeInputManager(
  pressed: Set<string> = new Set(),
  mappedActions: Set<string> = new Set(["interact"]),
): InputManager {
  return {
    isJustPressed: (action: string) => pressed.has(action),
    hasAction: (action: string) => mappedActions.has(action),
  } as unknown as InputManager;
}

describe("Interactor", () => {
  it("focuses the nearest in-range interactable across frames", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const near = scene.spawn("near");
    near.add(new Transform({ position: { x: 200, y: 0 } }));
    const nearInteractable = near.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    expect(interactor.focus).toBeNull(); // out of range at 200px

    near.get(Transform).setPosition(50, 0);
    interactor.update();
    expect(interactor.focus).toBe(nearInteractable);
  });

  it("emits InteractionFocusChangedEvent only on a transition, not while focus is stable", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    const events: unknown[] = [];
    player.on(InteractionFocusChangedEvent, (e) => events.push(e));

    interactor.update();
    interactor.update();
    interactor.update();
    expect(events).toHaveLength(1);
  });

  it("a live prompt change on the current focus re-emits the transition", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const lever = scene.spawn("lever");
    lever.add(new Transform({ position: { x: 10, y: 0 } }));
    let on = false;
    lever.add(new Interactable({ onInteract: () => {}, prompt: () => (on ? "Turn off" : "Turn on") }));

    const prompts: (string | null)[] = [];
    player.on(InteractionFocusChangedEvent, (e) => prompts.push(e.prompt));

    interactor.update();
    expect(prompts).toEqual(["Turn on"]);
    interactor.update();
    expect(prompts).toEqual(["Turn on"]); // stable, no repeat
    on = true;
    interactor.update();
    expect(prompts).toEqual(["Turn on", "Turn off"]);
  });

  it("leaving all ranges emits a null-focus transition", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    const chestTransform = chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    const events: { interactable: Interactable | null; prompt: string | null }[] = [];
    player.on(InteractionFocusChangedEvent, (e) => events.push(e));

    interactor.update();
    expect(interactor.focus).not.toBeNull();

    chestTransform.setPosition(9999, 9999);
    interactor.update();
    expect(interactor.focus).toBeNull();
    expect(events.at(-1)).toEqual({ interactable: null, prompt: null });
  });

  it("interact() fires the focused interactable's onInteract and emits InteractedEvent", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const onInteract = vi.fn();
    const chestInteractable = chest.add(new Interactable({ onInteract }));

    const interacted = vi.fn();
    player.on(InteractedEvent, interacted);

    interactor.update();
    interactor.interact();

    expect(onInteract).toHaveBeenCalledTimes(1);
    expect(interacted).toHaveBeenCalledWith({ interactable: chestInteractable });
  });

  it("interact() with no focus is a no-op", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const interacted = vi.fn();
    player.on(InteractedEvent, interacted);

    expect(() => interactor.interact()).not.toThrow();
    expect(interacted).not.toHaveBeenCalled();
  });

  it("action: null skips auto-input entirely", () => {
    const { scene } = createMockScene();
    scene.context.register(InputManagerKey, fakeInputManager(new Set(["interact"])));
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100, action: null }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const onInteract = vi.fn();
    chest.add(new Interactable({ onInteract }));

    interactor.update();
    expect(onInteract).not.toHaveBeenCalled();
  });

  it("with a mock InputManager, the action edge fires interaction", () => {
    const { scene } = createMockScene();
    const pressed = new Set<string>();
    scene.context.register(InputManagerKey, fakeInputManager(pressed));
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const onInteract = vi.fn();
    chest.add(new Interactable({ onInteract }));

    interactor.update();
    expect(onInteract).not.toHaveBeenCalled();

    pressed.add("interact");
    interactor.update();
    expect(onInteract).toHaveBeenCalledTimes(1);
  });

  it("enabled = false halts tracking after a null transition", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    const chestTransform = chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    const events: unknown[] = [];
    player.on(InteractionFocusChangedEvent, (e) => events.push(e));

    interactor.update();
    expect(interactor.focus).not.toBeNull();

    interactor.enabled = false;
    expect(interactor.focus).toBeNull();
    expect(events).toHaveLength(2); // focused, then the null transition on disable

    // Tracking is halted: moving the interactable back into range and
    // updating does not re-focus while disabled.
    chestTransform.setPosition(5, 0);
    interactor.update();
    expect(interactor.focus).toBeNull();
    expect(events).toHaveLength(2);
  });

  it("focus getter reflects live state", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));
    expect(interactor.focus).toBeNull();

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const chestInteractable = chest.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    expect(interactor.focus).toBe(chestInteractable);
  });

  it("a disabled interactable is never focused", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {}, enabled: false }));

    interactor.update();
    expect(interactor.focus).toBeNull();
  });

  it("removing the Interactor while focused emits a null-focus transition", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    const events: { interactable: Interactable | null; prompt: string | null }[] = [];
    player.on(InteractionFocusChangedEvent, (e) => events.push(e));

    interactor.update();
    expect(interactor.focus).not.toBeNull();

    player.remove(Interactor);
    expect(events).toHaveLength(2); // focused, then the null transition on removal
    expect(events.at(-1)).toEqual({ interactable: null, prompt: null });
  });

  it("removing an unfocused Interactor emits nothing", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    player.add(new Interactor({ range: 100 }));

    const events: unknown[] = [];
    player.on(InteractionFocusChangedEvent, (e) => events.push(e));

    player.remove(Interactor);
    expect(events).toHaveLength(0);
  });

  it("warns once (dev) when the InputManager is resolvable but the action is unmapped", () => {
    const { scene } = createMockScene();
    const logger = new Logger({ level: LogLevel.Debug });
    scene.context.register(LoggerKey, logger);
    const warn = vi.spyOn(logger, "warn");
    scene.context.register(InputManagerKey, fakeInputManager(new Set(), new Set()));

    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    interactor.update();
    interactor.update();

    const interactionWarns = warn.mock.calls.filter((c) => c[0] === "interaction");
    expect(interactionWarns).toHaveLength(1);
    expect(interactionWarns[0]?.[1]).toMatch(/action "interact"/);
  });

  it("does not warn when the action is mapped", () => {
    const { scene } = createMockScene();
    const logger = new Logger({ level: LogLevel.Debug });
    scene.context.register(LoggerKey, logger);
    const warn = vi.spyOn(logger, "warn");
    scene.context.register(InputManagerKey, fakeInputManager());

    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    interactor.update();

    expect(warn.mock.calls.filter((c) => c[0] === "interaction")).toHaveLength(0);
  });

  it("a target destroyed earlier in the frame is not selectable and cannot be interacted with", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const onInteract = vi.fn();
    const chestInteractable = chest.add(new Interactable({ onInteract }));

    interactor.update();
    expect(interactor.focus).toBe(chestInteractable);

    const interacted: unknown[] = [];
    player.on(InteractedEvent, (e) => interacted.push(e));

    // Deferred destroy: the entity is marked destroyed immediately but stays
    // registered until the end-of-frame flush.
    chest.destroy();

    interactor.interact();
    expect(onInteract).not.toHaveBeenCalled();
    expect(interacted).toHaveLength(0);

    interactor.update();
    expect(interactor.focus).toBeNull();
  });
});

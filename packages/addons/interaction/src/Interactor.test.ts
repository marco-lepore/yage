import { describe, expect, it, vi } from "vitest";
import { createMockScene, Logger, LoggerKey, LogLevel, Transform } from "@yagejs/core";
import { InputManagerKey, type InputManager } from "@yagejs/input";
import { Interactor } from "./Interactor.js";
import { Interactable } from "./Interactable.js";
import {
  InteractionFocusChangedEvent,
  InteractionInRangeChangedEvent,
  InteractionPerformedEvent,
} from "./events.js";

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

  it("interact() fires the focused interactable's onInteract and emits InteractionPerformedEvent", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const onInteract = vi.fn();
    const chestInteractable = chest.add(new Interactable({ onInteract }));

    const interacted = vi.fn();
    player.on(InteractionPerformedEvent, interacted);

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
    player.on(InteractionPerformedEvent, interacted);

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
    player.on(InteractionPerformedEvent, (e) => interacted.push(e));

    // Deferred destroy: the entity is marked destroyed immediately but stays
    // registered until the end-of-frame flush.
    chest.destroy();

    interactor.interact();
    expect(onInteract).not.toHaveBeenCalled();
    expect(interacted).toHaveLength(0);

    interactor.update();
    expect(interactor.focus).toBeNull();
  });

  it("a focus whose enabled gate flips false before interact() cannot be interacted with", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const onInteract = vi.fn();
    let enabled = true;
    const chestInteractable = chest.add(
      new Interactable({ onInteract, enabled: () => enabled }),
    );

    interactor.update();
    expect(interactor.focus).toBe(chestInteractable);

    const interacted: unknown[] = [];
    player.on(InteractionPerformedEvent, (e) => interacted.push(e));

    // The live gate flips after focus was resolved but before interact().
    enabled = false;
    interactor.interact();
    expect(onInteract).not.toHaveBeenCalled();
    expect(interacted).toHaveLength(0);
  });

  it("a focus whose Interactable is removed before interact() cannot be interacted with", () => {
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
    player.on(InteractionPerformedEvent, (e) => interacted.push(e));

    // Remove the component but keep the entity alive; the interactor still
    // holds the cached focus until its next update().
    chest.remove(Interactable);

    interactor.interact();
    expect(onInteract).not.toHaveBeenCalled();
    expect(interacted).toHaveLength(0);
  });

  it("inRange ranks every in-range interactable best-first, with inRange[0] === focus", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    // Before the first update() the snapshot is empty.
    expect(interactor.inRange).toEqual([]);

    const near = scene.spawn("near");
    near.add(new Transform({ position: { x: 10, y: 0 } }));
    const nearInteractable = near.add(new Interactable({ onInteract: () => {} }));

    const far = scene.spawn("far");
    far.add(new Transform({ position: { x: 40, y: 0 } }));
    const farInteractable = far.add(new Interactable({ onInteract: () => {} }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 30, y: 0 } }));
    const chestInteractable = chest.add(
      new Interactable({ onInteract: () => {}, priority: 10 }),
    );

    interactor.update();

    // Priority chest first, then the two priority-0 by nearest distance.
    expect(interactor.inRange).toEqual([chestInteractable, nearInteractable, farInteractable]);
    expect(interactor.inRange[0]).toBe(interactor.focus);
  });

  it("inRange excludes out-of-range and disabled interactables", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 50 }));

    const inRange = scene.spawn("in");
    inRange.add(new Transform({ position: { x: 10, y: 0 } }));
    const inRangeInteractable = inRange.add(new Interactable({ onInteract: () => {} }));

    const disabled = scene.spawn("disabled");
    disabled.add(new Transform({ position: { x: 12, y: 0 } }));
    disabled.add(new Interactable({ onInteract: () => {}, enabled: false }));

    const outOfRange = scene.spawn("out");
    outOfRange.add(new Transform({ position: { x: 500, y: 0 } }));
    outOfRange.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    expect(interactor.inRange).toEqual([inRangeInteractable]);
  });

  it("inRange is empty while the interactor is disabled", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    expect(interactor.inRange).toHaveLength(1);

    interactor.enabled = false;
    expect(interactor.inRange).toEqual([]);
  });

  it("interact(target) fires a chosen non-focus interactable and emits the event for it", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const chestOnInteract = vi.fn();
    const chestInteractable = chest.add(new Interactable({ onInteract: chestOnInteract, priority: 10 }));

    const coin = scene.spawn("coin");
    coin.add(new Transform({ position: { x: 20, y: 0 } }));
    const coinOnInteract = vi.fn();
    const coinInteractable = coin.add(new Interactable({ onInteract: coinOnInteract }));

    interactor.update();
    expect(interactor.focus).toBe(chestInteractable); // higher priority

    const interacted: { interactable: Interactable }[] = [];
    player.on(InteractionPerformedEvent, (e) => interacted.push(e));

    // Pick the coin from the ranked set instead of the default focus.
    interactor.interact(coinInteractable);

    expect(coinOnInteract).toHaveBeenCalledTimes(1);
    expect(chestOnInteract).not.toHaveBeenCalled();
    expect(interacted).toEqual([{ interactable: coinInteractable }]);
  });

  it("interact(target) is guarded: a disabled chosen target is a no-op", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const coin = scene.spawn("coin");
    coin.add(new Transform({ position: { x: 20, y: 0 } }));
    const coinOnInteract = vi.fn();
    let enabled = true;
    const coinInteractable = coin.add(
      new Interactable({ onInteract: coinOnInteract, enabled: () => enabled }),
    );

    interactor.update();

    const interacted: unknown[] = [];
    player.on(InteractionPerformedEvent, (e) => interacted.push(e));

    enabled = false;
    interactor.interact(coinInteractable);
    expect(coinOnInteract).not.toHaveBeenCalled();
    expect(interacted).toHaveLength(0);
  });

  it("a target moving after update() cannot reorder inRange out from under focus", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const far = scene.spawn("far");
    const farTransform = far.add(new Transform({ position: { x: 60, y: 0 } }));
    const farInteractable = far.add(new Interactable({ onInteract: () => {} }));

    const near = scene.spawn("near");
    near.add(new Transform({ position: { x: 10, y: 0 } }));
    const nearInteractable = near.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    expect(interactor.inRange).toEqual([nearInteractable, farInteractable]);
    expect(interactor.focus).toBe(nearInteractable);

    // `Interactable.position` is a live transform read. Ranking on read would
    // now put `far` first while `focus` still said `near`.
    farTransform.setPosition(0, 0);
    expect(interactor.inRange).toEqual([nearInteractable, farInteractable]);
    expect(interactor.focus).toBe(interactor.inRange[0]);

    interactor.update();
    expect(interactor.inRange).toEqual([farInteractable, nearInteractable]);
    expect(interactor.focus).toBe(interactor.inRange[0]);
  });

  it("interact(target) is a no-op while the interactor is disabled", () => {
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

    interactor.enabled = false;
    interactor.interact(chestInteractable);
    expect(onInteract).not.toHaveBeenCalled();
  });

  it("interact(target) is a no-op for a live target that is out of range", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 50 }));

    const distant = scene.spawn("distant");
    distant.add(new Transform({ position: { x: 500, y: 0 } }));
    const onInteract = vi.fn();
    const distantInteractable = distant.add(new Interactable({ onInteract }));

    interactor.update();
    expect(interactor.inRange).toEqual([]);

    // Enabled and registered, but never in reach — only `interactable.interact()`
    // fires something the interactor can't reach.
    interactor.interact(distantInteractable);
    expect(onInteract).not.toHaveBeenCalled();
  });

  it("InteractionInRangeChangedEvent reports a non-focused target entering and leaving", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const chestInteractable = chest.add(new Interactable({ onInteract: () => {}, priority: 10 }));

    const coin = scene.spawn("coin");
    const coinTransform = coin.add(new Transform({ position: { x: 9999, y: 0 } }));
    const coinInteractable = coin.add(new Interactable({ onInteract: () => {} }));

    const focusEvents: unknown[] = [];
    const inRangeEvents: (readonly Interactable[])[] = [];
    player.on(InteractionFocusChangedEvent, (e) => focusEvents.push(e));
    player.on(InteractionInRangeChangedEvent, ({ inRange }) => inRangeEvents.push(inRange));

    interactor.update();
    expect(inRangeEvents).toEqual([[chestInteractable]]);
    expect(focusEvents).toHaveLength(1);

    // The coin enters range but the chest keeps the focus (higher priority), so
    // ONLY the in-range event fires — the case a focus-only listener misses.
    coinTransform.setPosition(20, 0);
    interactor.update();
    expect(inRangeEvents.at(-1)).toEqual([chestInteractable, coinInteractable]);
    expect(focusEvents).toHaveLength(1);

    // Stable ranking: no repeat.
    interactor.update();
    expect(inRangeEvents).toHaveLength(2);

    coinTransform.setPosition(9999, 0);
    interactor.update();
    expect(inRangeEvents.at(-1)).toEqual([chestInteractable]);
    expect(focusEvents).toHaveLength(1);
  });

  it("InteractionInRangeChangedEvent reports two targets swapping rank", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    // Both outrank nothing and neither is the focus-holder after the swap flips
    // which is nearest, so this is a pure reorder.
    const a = scene.spawn("a");
    const aTransform = a.add(new Transform({ position: { x: 10, y: 0 } }));
    const aInteractable = a.add(new Interactable({ onInteract: () => {} }));
    const b = scene.spawn("b");
    b.add(new Transform({ position: { x: 20, y: 0 } }));
    const bInteractable = b.add(new Interactable({ onInteract: () => {} }));

    const inRangeEvents: (readonly Interactable[])[] = [];
    player.on(InteractionInRangeChangedEvent, ({ inRange }) => inRangeEvents.push(inRange));

    interactor.update();
    expect(inRangeEvents.at(-1)).toEqual([aInteractable, bInteractable]);

    aTransform.setPosition(30, 0); // now b is nearest
    interactor.update();
    expect(inRangeEvents.at(-1)).toEqual([bInteractable, aInteractable]);
    expect(interactor.focus).toBe(bInteractable);
  });

  it("a listener on the disable transition sees focus and inRange already cleared", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    chest.add(new Interactable({ onInteract: () => {} }));

    interactor.update();
    expect(interactor.inRange).toHaveLength(1);

    // Entity handlers run synchronously, so state must be assigned before the
    // emit — a handler must never observe the stale, pre-clear snapshot.
    const seenInRange: (readonly Interactable[])[] = [];
    const seenFocus: (Interactable | null)[] = [];
    player.on(InteractionFocusChangedEvent, () => {
      seenInRange.push(interactor.inRange);
      seenFocus.push(interactor.focus);
    });

    interactor.enabled = false;
    expect(seenInRange).toEqual([[]]);
    expect(seenFocus).toEqual([null]);
  });

  it("a handler that disables the interactor mid-emit gets no stale in-range event after it", () => {
    const { scene } = createMockScene();
    const player = scene.spawn("player");
    player.add(new Transform());
    const interactor = player.add(new Interactor({ range: 100 }));

    const chest = scene.spawn("chest");
    chest.add(new Transform({ position: { x: 10, y: 0 } }));
    const chestInteractable = chest.add(new Interactable({ onInteract: () => {} }));

    const announced: Interactable[] = [];
    player.on(InteractionInRangeChangedEvent, ({ inRange }) => announced.push(...inRange));
    // Re-enters setInRange from inside the focus emit: the interactor empties
    // its snapshot before the outer call reaches its own in-range emit.
    player.on(InteractionFocusChangedEvent, () => {
      interactor.enabled = false;
    });

    interactor.update();

    // The interactor dropped the chest before it ever finished announcing it,
    // so no in-range event may carry it — a selection UI must never be handed a
    // target that is already gone.
    expect(announced).not.toContain(chestInteractable);
    expect(interactor.inRange).toEqual([]);
    expect(interactor.focus).toBeNull();
  });
});

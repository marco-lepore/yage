import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Vec2 } from "@yagejs/core";
import { InputManager } from "./InputManager.js";

describe("InputManager", () => {
  let input: InputManager;

  beforeEach(() => {
    input = new InputManager();
    input.setActionMap({
      jump: ["Space"],
      moveLeft: ["KeyA", "ArrowLeft"],
      moveRight: ["KeyD", "ArrowRight"],
      moveUp: ["KeyW", "ArrowUp"],
      moveDown: ["KeyS", "ArrowDown"],
      fire: ["MouseLeft"],
    });
  });

  // -- isPressed --

  it("isPressed returns true when any mapped key is held", () => {
    input._onKeyDown("KeyA");
    expect(input.isPressed("moveLeft")).toBe(true);
  });

  it("isPressed returns true for alternate binding", () => {
    input._onKeyDown("ArrowLeft");
    expect(input.isPressed("moveLeft")).toBe(true);
  });

  it("isPressed returns false when no mapped keys are held", () => {
    expect(input.isPressed("moveLeft")).toBe(false);
  });

  it("isPressed returns false after key is released", () => {
    input._onKeyDown("KeyA");
    input._onKeyUp("KeyA");
    expect(input.isPressed("moveLeft")).toBe(false);
  });

  // -- isJustPressed --

  it("isJustPressed returns true on the frame the key was pressed", () => {
    input._onKeyDown("Space");
    expect(input.isJustPressed("jump")).toBe(true);
  });

  it("isJustPressed returns false after _clearFrameState", () => {
    input._onKeyDown("Space");
    input._clearFrameState();
    expect(input.isJustPressed("jump")).toBe(false);
  });

  it("isJustPressed does not re-fire on held key", () => {
    input._onKeyDown("Space");
    input._clearFrameState();
    // Simulate repeated keydown (held key fires multiple events in browsers)
    input._onKeyDown("Space");
    expect(input.isJustPressed("jump")).toBe(false);
  });

  // -- isJustReleased --

  it("isJustReleased returns true on the frame the key was released", () => {
    input._onKeyDown("Space");
    input._clearFrameState();
    input._onKeyUp("Space");
    expect(input.isJustReleased("jump")).toBe(true);
  });

  it("isJustReleased returns false after _clearFrameState", () => {
    input._onKeyDown("Space");
    input._clearFrameState();
    input._onKeyUp("Space");
    input._clearFrameState();
    expect(input.isJustReleased("jump")).toBe(false);
  });

  // -- getHoldDuration / isHeldFor --

  it("getHoldDuration returns ms since key press", () => {
    input._advanceTime(100);
    input._onKeyDown("Space");

    input._advanceTime(250);
    expect(input.getHoldDuration("jump")).toBe(250);
  });

  it("getHoldDuration returns 0 when not held", () => {
    input._advanceTime(500);
    expect(input.getHoldDuration("jump")).toBe(0);
  });

  it("getHoldDuration returns max duration across multiple mapped keys", () => {
    input._advanceTime(100);
    input._onKeyDown("KeyA");
    input._advanceTime(100);
    input._onKeyDown("ArrowLeft");

    input._advanceTime(200);
    // KeyA held for 300ms, ArrowLeft held for 200ms — should return 300
    expect(input.getHoldDuration("moveLeft")).toBe(300);
  });

  it("isHeldFor returns true when held long enough", () => {
    input._onKeyDown("Space");
    input._advanceTime(500);
    expect(input.isHeldFor("jump", 500)).toBe(true);
  });

  it("isHeldFor returns false when not held long enough", () => {
    input._onKeyDown("Space");
    input._advanceTime(200);
    expect(input.isHeldFor("jump", 500)).toBe(false);
  });

  // -- getAxis --

  it("getAxis returns -1 when only negative action is pressed", () => {
    input._onKeyDown("KeyA");
    expect(input.getAxis("moveLeft", "moveRight")).toBe(-1);
  });

  it("getAxis returns 1 when only positive action is pressed", () => {
    input._onKeyDown("KeyD");
    expect(input.getAxis("moveLeft", "moveRight")).toBe(1);
  });

  it("getAxis returns 0 when both are pressed", () => {
    input._onKeyDown("KeyA");
    input._onKeyDown("KeyD");
    expect(input.getAxis("moveLeft", "moveRight")).toBe(0);
  });

  it("getAxis returns 0 when neither is pressed", () => {
    expect(input.getAxis("moveLeft", "moveRight")).toBe(0);
  });

  // -- getVector --

  it("getVector returns Vec2 from four directional actions", () => {
    input._onKeyDown("KeyD");
    input._onKeyDown("KeyW");
    const v = input.getVector("moveLeft", "moveRight", "moveUp", "moveDown");
    expect(v.x).toBe(1);
    expect(v.y).toBe(-1);
  });

  it("getVector returns zero when nothing is pressed", () => {
    const v = input.getVector("moveLeft", "moveRight", "moveUp", "moveDown");
    expect(v.equals(Vec2.ZERO)).toBe(true);
  });

  // -- Pointer --

  it("getPointerScreenPosition returns current pointer screen coords", () => {
    input._onPointerMove(150, 200);
    const pos = input.getPointerScreenPosition();
    expect(pos.x).toBe(150);
    expect(pos.y).toBe(200);
  });

  it("getPointerPosition returns world coords when camera is set", () => {
    const mockCamera = {
      screenToWorld: (sx: number, sy: number) => new Vec2(sx * 2, sy * 2),
    };
    input.setCamera(mockCamera);
    input._onPointerMove(100, 50);
    const pos = input.getPointerPosition();
    expect(pos.x).toBe(200);
    expect(pos.y).toBe(100);
  });

  it("getPointerPosition returns screen coords when no camera", () => {
    input._onPointerMove(100, 50);
    const pos = input.getPointerPosition();
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(50);
  });

  it("isPointerDown tracks pointer state", () => {
    expect(input.isPointerDown()).toBe(false);
    input._onPointerDown();
    expect(input.isPointerDown()).toBe(true);
    input._onPointerUp();
    expect(input.isPointerDown()).toBe(false);
  });

  // -- Action map management --

  it("setActionMap replaces the action map", () => {
    input._onKeyDown("Space");
    input.setActionMap({ shoot: ["Space"] });
    expect(input.isPressed("jump")).toBe(false);
    expect(input.isPressed("shoot")).toBe(true);
  });

  it("bindKey adds a key binding", () => {
    input.bindKey("jump", "KeyK");
    input._onKeyDown("KeyK");
    expect(input.isPressed("jump")).toBe(true);
  });

  it("bindKey creates action if it does not exist", () => {
    input.bindKey("dash", "ShiftLeft");
    input._onKeyDown("ShiftLeft");
    expect(input.isPressed("dash")).toBe(true);
  });

  it("bindKey does not duplicate existing bindings", () => {
    input.bindKey("jump", "Space");
    input.bindKey("jump", "Space");
    input.unbindKey("jump", "Space");
    // After removing one binding, action should have no keys
    expect(input.isPressed("jump")).toBe(false);
  });

  it("unbindKey removes a key binding", () => {
    input.unbindKey("jump", "Space");
    input._onKeyDown("Space");
    expect(input.isPressed("jump")).toBe(false);
  });

  // -- Unmapped actions --

  it("unmapped action names return false for isPressed", () => {
    expect(input.isPressed("nonexistent")).toBe(false);
  });

  it("unmapped action names return false for isJustPressed", () => {
    expect(input.isJustPressed("nonexistent")).toBe(false);
  });

  it("unmapped action names return false for isJustReleased", () => {
    expect(input.isJustReleased("nonexistent")).toBe(false);
  });

  it("unmapped action names return 0 for getHoldDuration", () => {
    expect(input.getHoldDuration("nonexistent")).toBe(0);
  });

  it("unbindKey on unmapped action does not crash", () => {
    expect(() => input.unbindKey("nonexistent", "KeyX")).not.toThrow();
  });

  it("unbindKey with non-existent key on mapped action is a no-op", () => {
    input.unbindKey("jump", "KeyZ");
    expect(input.getBindings("jump")).toEqual(["Space"]);
  });

  // -- Default bindings / resetBindings --

  it("setActionMap stores defaults for resetBindings", () => {
    input.bindKey("jump", "KeyK");
    expect(input.getBindings("jump")).toEqual(["Space", "KeyK"]);

    input.resetBindings("jump");
    expect(input.getBindings("jump")).toEqual(["Space"]);
  });

  it("resetBindings restores all actions", () => {
    input.bindKey("jump", "KeyK");
    input.unbindKey("fire", "MouseLeft");
    input.resetBindings();

    expect(input.getBindings("jump")).toEqual(["Space"]);
    expect(input.getBindings("fire")).toEqual(["MouseLeft"]);
  });

  it("setActionMap overwrites previous defaults", () => {
    input.setActionMap({ shoot: ["KeyX"] });
    input.bindKey("shoot", "KeyY");
    input.resetBindings();

    expect(input.getBindings("shoot")).toEqual(["KeyX"]);
    expect(input.getActionNames()).toEqual(["shoot"]);
  });

  it("resetBindings with unknown action is a no-op", () => {
    expect(() => input.resetBindings("nonexistent")).not.toThrow();
  });

  // -- getBindings / getActionsForKey --

  it("getBindings returns current bindings", () => {
    expect(input.getBindings("moveLeft")).toEqual(["KeyA", "ArrowLeft"]);
  });

  it("getBindings returns empty array for unmapped action", () => {
    expect(input.getBindings("nonexistent")).toEqual([]);
  });

  it("getActionsForKey returns actions using the key", () => {
    expect(input.getActionsForKey("Space")).toEqual(["jump"]);
  });

  it("getActionsForKey returns multiple actions sharing a key", () => {
    input.bindKey("confirm", "Space");
    const actions = input.getActionsForKey("Space");
    expect(actions).toContain("jump");
    expect(actions).toContain("confirm");
  });

  it("getActionsForKey returns empty for unused key", () => {
    expect(input.getActionsForKey("F12")).toEqual([]);
  });

  // -- exportBindings / loadBindings --

  it("exportBindings returns plain object of current bindings", () => {
    const exported = input.exportBindings();
    expect(exported).toEqual({
      jump: ["Space"],
      moveLeft: ["KeyA", "ArrowLeft"],
      moveRight: ["KeyD", "ArrowRight"],
      moveUp: ["KeyW", "ArrowUp"],
      moveDown: ["KeyS", "ArrowDown"],
      fire: ["MouseLeft"],
    });
  });

  it("loadBindings overlays onto defaults and preserves uncovered actions", () => {
    input.loadBindings({ jump: ["KeyK"] });
    expect(input.getBindings("jump")).toEqual(["KeyK"]);
    // Actions not in the loaded map retain their defaults
    expect(input.getBindings("moveLeft")).toEqual(["KeyA", "ArrowLeft"]);

    // Defaults still work
    input.resetBindings();
    expect(input.getBindings("jump")).toEqual(["Space"]);
  });

  // -- Group management --

  describe("groups", () => {
    beforeEach(() => {
      input.setGroups({
        movement: ["moveLeft", "moveRight", "jump"],
        combat: ["fire"],
      });
    });

    it("getGroups returns configured group names", () => {
      expect(input.getGroups()).toEqual(["movement", "combat"]);
    });

    it("getGroupActions returns actions in a group", () => {
      expect(input.getGroupActions("movement")).toEqual(
        expect.arrayContaining(["moveLeft", "moveRight", "jump"]),
      );
    });

    it("getGroupActions returns empty for unknown group", () => {
      expect(input.getGroupActions("unknown")).toEqual([]);
    });

    it("all groups are enabled by default", () => {
      expect(input.isGroupEnabled("movement")).toBe(true);
      expect(input.isGroupEnabled("combat")).toBe(true);
    });

    it("isGroupEnabled returns true for unknown groups", () => {
      expect(input.isGroupEnabled("nonexistent")).toBe(true);
    });

    it("disableGroup / enableGroup toggles group state", () => {
      input.disableGroup("movement");
      expect(input.isGroupEnabled("movement")).toBe(false);

      input.enableGroup("movement");
      expect(input.isGroupEnabled("movement")).toBe(true);
    });

    it("setActiveGroups enables only listed groups", () => {
      input.setActiveGroups(["combat"]);
      expect(input.isGroupEnabled("movement")).toBe(false);
      expect(input.isGroupEnabled("combat")).toBe(true);
    });

    it("setActiveGroups with empty list disables all groups", () => {
      input.setActiveGroups([]);
      expect(input.isGroupEnabled("movement")).toBe(false);
      expect(input.isGroupEnabled("combat")).toBe(false);
    });

    // -- Group-query interaction --

    it("disabled group silences isPressed", () => {
      input._onKeyDown("Space");
      expect(input.isPressed("jump")).toBe(true);

      input.disableGroup("movement");
      expect(input.isPressed("jump")).toBe(false);
    });

    it("disabled group silences isJustPressed", () => {
      input.disableGroup("movement");
      input._onKeyDown("Space");
      expect(input.isJustPressed("jump")).toBe(false);
    });

    it("disabled group silences isJustReleased", () => {
      input._onKeyDown("Space");
      input._clearFrameState();
      input.disableGroup("movement");
      input._onKeyUp("Space");
      expect(input.isJustReleased("jump")).toBe(false);
    });

    it("disabled group silences getHoldDuration", () => {
      input._onKeyDown("Space");
      input._advanceTime(500);
      input.disableGroup("movement");
      expect(input.getHoldDuration("jump")).toBe(0);
    });

    it("disabled group silences getAxis", () => {
      input._onKeyDown("KeyD");
      input.disableGroup("movement");
      expect(input.getAxis("moveLeft", "moveRight")).toBe(0);
    });

    it("ungrouped action is always active", () => {
      // moveUp and moveDown are not in any group
      input._onKeyDown("KeyW");
      input.disableGroup("movement");
      input.disableGroup("combat");
      expect(input.isPressed("moveUp")).toBe(true);
    });

    it("multi-group action is active if any group is enabled", () => {
      input.setGroups({
        movement: ["jump"],
        shared: ["jump"],
        combat: ["fire"],
      });

      input._onKeyDown("Space");
      input.disableGroup("movement");
      // "jump" is still in "shared" which is enabled
      expect(input.isPressed("jump")).toBe(true);

      input.disableGroup("shared");
      expect(input.isPressed("jump")).toBe(false);
    });
  });

  // -- Rebinding --

  describe("rebind", () => {
    beforeEach(() => {
      input.setGroups({
        movement: ["moveLeft", "moveRight", "jump"],
        combat: ["fire"],
      });
    });

    it("appends new key when no slot specified", () => {
      const result = input.rebind("jump", "KeyK");
      expect(result.ok).toBe(true);
      expect(input.getBindings("jump")).toEqual(["Space", "KeyK"]);
    });

    it("replaces binding at slot index", () => {
      const result = input.rebind("jump", "KeyK", { slot: 0 });
      expect(result.ok).toBe(true);
      expect(input.getBindings("jump")).toEqual(["KeyK"]);
    });

    it("appends when slot is out of bounds", () => {
      const result = input.rebind("jump", "KeyK", { slot: 5 });
      expect(result.ok).toBe(true);
      expect(input.getBindings("jump")).toEqual(["Space", "KeyK"]);
    });

    it("rejects conflict in same group", () => {
      const result = input.rebind("jump", "KeyA", { conflict: "reject" });
      expect(result.ok).toBe(false);
      expect(result.conflict).toEqual({ action: "moveLeft", key: "KeyA" });
      // Binding should not have changed
      expect(input.getBindings("jump")).toEqual(["Space"]);
    });

    it("replaces conflict with replace policy", () => {
      const result = input.rebind("jump", "KeyA", { conflict: "replace" });
      expect(result.ok).toBe(true);
      expect(input.getBindings("jump")).toEqual(["Space", "KeyA"]);
      // KeyA should be removed from moveLeft
      expect(input.getBindings("moveLeft")).toEqual(["ArrowLeft"]);
    });

    it("keeps both with keep-both policy", () => {
      const result = input.rebind("jump", "KeyA", { conflict: "keep-both" });
      expect(result.ok).toBe(true);
      expect(input.getBindings("jump")).toEqual(["Space", "KeyA"]);
      // moveLeft keeps KeyA
      expect(input.getBindings("moveLeft")).toEqual(["KeyA", "ArrowLeft"]);
    });

    it("no conflict across different groups", () => {
      const result = input.rebind("fire", "Space");
      expect(result.ok).toBe(true);
      expect(input.getBindings("fire")).toEqual(["MouseLeft", "Space"]);
      // jump keeps Space
      expect(input.getBindings("jump")).toEqual(["Space"]);
    });

    it("ungrouped actions never conflict", () => {
      // moveUp is ungrouped
      const result = input.rebind("moveUp", "Space");
      expect(result.ok).toBe(true);
      expect(input.getBindings("moveUp")).toEqual(["KeyW", "ArrowUp", "Space"]);
    });

    it("no conflict when other action sharing key has no groups", () => {
      // moveUp is ungrouped and has KeyW; try to rebind jump to KeyW
      // moveUp has no groups so it should not conflict with jump (in movement group)
      const result = input.rebind("jump", "KeyW");
      expect(result.ok).toBe(true);
    });

    it("does not duplicate existing binding when appending", () => {
      input.rebind("jump", "Space");
      expect(input.getBindings("jump")).toEqual(["Space"]);
    });

    it("deduplicates when slot differs from existing position (slot < existing)", () => {
      input.bindKey("jump", "KeyK");
      // jump = ["Space", "KeyK"], rebind KeyK to slot 0
      input.rebind("jump", "KeyK", { slot: 0 });
      expect(input.getBindings("jump")).toEqual(["KeyK"]);
    });

    it("deduplicates when slot differs from existing position (slot > existing)", () => {
      input.bindKey("jump", "KeyK");
      input.bindKey("jump", "KeyJ");
      // jump = ["Space", "KeyK", "KeyJ"], rebind Space to slot 2
      // After removing Space from slot 0, array becomes ["KeyK", "KeyJ"]
      // Adjusted slot = 2 - 1 = 1, so Space replaces KeyJ at index 1
      input.rebind("jump", "Space", { slot: 2 });
      expect(input.getBindings("jump")).toEqual(["KeyK", "Space"]);
    });

    it("creates action if it does not exist", () => {
      const result = input.rebind("dash", "ShiftLeft");
      expect(result.ok).toBe(true);
      expect(input.getBindings("dash")).toEqual(["ShiftLeft"]);
    });

    it("default conflict policy is reject", () => {
      const result = input.rebind("jump", "KeyA");
      expect(result.ok).toBe(false);
    });
  });

  // -- Synthetic input --

  describe("synthetic input", () => {
    it("fireAction reports a one-frame action press", () => {
      input.fireAction("jump");
      expect(input.isPressed("jump")).toBe(true);
      expect(input.isJustPressed("jump")).toBe(true);

      input._clearFrameState();
      expect(input.isPressed("jump")).toBe(false);
      expect(input.isJustPressed("jump")).toBe(false);
    });

    it("fireAction throws for unknown actions", () => {
      expect(() => input.fireAction("unknown")).toThrow('unknown action "unknown"');
    });

    it("snapshotState includes synthetic keyboard, mouse, and gamepad state", () => {
      input.fireKeyDown("ArrowRight");
      input.firePointerMove(120, 240);
      input.firePointerDown(0);
      input.fireGamepadButton("GamepadB", true);
      input.fireGamepadAxis("leftX", 0.5);

      expect(input.snapshotState()).toEqual({
        keys: ["ArrowRight", "MouseLeft"],
        actions: ["fire", "moveRight"],
        mouse: { x: 120, y: 240, buttons: [0], down: true },
        gamepad: {
          buttons: ["GamepadB"],
          axes: [{ key: "-1:leftX", value: 0.5 }],
        },
      });
    });

    it("clearAll releases synthetic state", () => {
      input.fireKeyDown("Space");
      input.fireAction("jump");
      input.firePointerDown(2);
      input.fireGamepadButton("GamepadA", true);

      input.clearAll();

      expect(input.isPressed("jump")).toBe(false);
      expect(input.isPointerDown()).toBe(false);
      expect(input.snapshotState()).toEqual({
        keys: [],
        actions: [],
        mouse: { x: 0, y: 0, buttons: [], down: false },
        gamepad: { buttons: [], axes: [] },
      });
    });
  });

  // -- Key listening --

  describe("listenForNextKey", () => {
    it("resolves with the next key code pressed", async () => {
      const promise = input.listenForNextKey();
      input._onKeyDown("KeyA");
      await expect(promise).resolves.toBe("KeyA");
    });

    it("intercepts the key (not processed as input)", async () => {
      const promise = input.listenForNextKey();
      input._onKeyDown("Space");
      await promise;
      expect(input.isPressed("jump")).toBe(false);
      expect(input.isJustPressed("jump")).toBe(false);
    });

    it("cancelListen resolves with null", async () => {
      const promise = input.listenForNextKey();
      input.cancelListen();
      await expect(promise).resolves.toBe(null);
    });

    it("cancelListen is a no-op when not listening", () => {
      expect(() => input.cancelListen()).not.toThrow();
    });

    it("new listenForNextKey cancels previous", async () => {
      const first = input.listenForNextKey();
      const second = input.listenForNextKey();

      // First should have been cancelled
      await expect(first).resolves.toBe(null);

      // Second should still be active
      input._onKeyDown("KeyB");
      await expect(second).resolves.toBe("KeyB");
    });
  });

  // -- Gamepad --

  describe("gamepad", () => {
    function makePad(opts: {
      index?: number;
      mapping?: string;
      buttons?: Array<{ pressed?: boolean; value?: number }>;
      axes?: number[];
    }): Gamepad {
      const buttons = (opts.buttons ?? []).map((b) => ({
        pressed: b.pressed ?? false,
        touched: false,
        value: b.value ?? (b.pressed ? 1 : 0),
      })) as readonly GamepadButton[];
      return {
        id: "test-pad",
        index: opts.index ?? 0,
        connected: true,
        timestamp: 0,
        mapping: opts.mapping ?? "standard",
        axes: opts.axes ?? [0, 0, 0, 0],
        buttons,
        vibrationActuator: null,
      } as unknown as Gamepad;
    }

    let originalGetGamepads:
      | (() => (Gamepad | null)[])
      | undefined;

    function setPads(pads: Array<Gamepad | null>): void {
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => pads,
      });
    }

    afterEach(() => {
      if (originalGetGamepads) {
        Object.defineProperty(navigator, "getGamepads", {
          configurable: true,
          value: originalGetGamepads,
        });
      } else {
        // Best-effort cleanup when jsdom didn't have it originally
        delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
      }
      vi.restoreAllMocks();
    });

    beforeEach(() => {
      originalGetGamepads = (
        navigator as unknown as { getGamepads?: () => (Gamepad | null)[] }
      ).getGamepads;
    });

    it("fireGamepadButton drives isPressed via the action map", () => {
      input.setActionMap({ jump: ["GamepadA"] });
      input.fireGamepadButton("GamepadA", true);
      expect(input.isPressed("jump")).toBe(true);
      expect(input.isJustPressed("jump")).toBe(true);

      input._clearFrameState();
      input.fireGamepadButton("GamepadA", false);
      expect(input.isPressed("jump")).toBe(false);
    });

    it("getStick returns Vec2.ZERO inside deadzone", () => {
      input.fireGamepadAxis("leftX", 0.1);
      input.fireGamepadAxis("leftY", 0.05);
      expect(input.getStick("left")).toEqual(Vec2.ZERO);
    });

    it("getStick returns deadzone-rescaled vector outside deadzone", () => {
      input.fireGamepadAxis("leftX", 1);
      input.fireGamepadAxis("leftY", 0);
      const v = input.getStick("left");
      expect(v.x).toBeCloseTo(1, 5);
      expect(v.y).toBeCloseTo(0, 5);
    });

    it("getStick magnitude clamps to 1.0 even when raw value exceeds 1", () => {
      input.fireGamepadAxis("leftX", 1.5);
      input.fireGamepadAxis("leftY", 0);
      const v = input.getStick("left");
      expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1.0001);
    });

    it("getTrigger returns 0 inside deadzone, normalized 0..1 outside", () => {
      input.fireGamepadAxis("leftTrigger", 0.02);
      expect(input.getTrigger("left")).toBe(0);

      input.fireGamepadAxis("leftTrigger", 1);
      expect(input.getTrigger("left")).toBeCloseTo(1, 5);
    });

    it("setDeadzones changes stick threshold", () => {
      input.setDeadzones({ stick: 0.5 });
      input.fireGamepadAxis("leftX", 0.4);
      expect(input.getStick("left")).toEqual(Vec2.ZERO);

      input.fireGamepadAxis("leftX", 0.6);
      expect(input.getStick("left").x).toBeGreaterThan(0);
    });

    it("polling emits key-down/up edges through the action map", () => {
      input.setActionMap({ jump: ["GamepadA"] });

      setPads([makePad({ buttons: [{ pressed: true }] })]);
      input._pollGamepads();
      expect(input.isPressed("jump")).toBe(true);

      setPads([makePad({ buttons: [{ pressed: false }] })]);
      input._pollGamepads();
      expect(input.isPressed("jump")).toBe(false);
    });

    it("polling diff produces no edges on stable state", () => {
      input.setActionMap({ jump: ["GamepadA"] });
      setPads([makePad({ buttons: [{ pressed: true }] })]);
      input._pollGamepads();
      input._clearFrameState();

      input._pollGamepads();
      expect(input.isJustPressed("jump")).toBe(false);
      expect(input.isPressed("jump")).toBe(true);
    });

    it("any-pad semantics: either pad pressing fires the action", () => {
      input.setActionMap({ jump: ["GamepadA"] });
      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      expect(input.isPressed("jump")).toBe(true);
    });

    it("any-pad semantics: releasing one pad while other holds does not fire up-edge", () => {
      input.setActionMap({ jump: ["GamepadA"] });
      setPads([
        makePad({ index: 0, buttons: [{ pressed: true }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      input._clearFrameState();

      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      expect(input.isPressed("jump")).toBe(true);
      expect(input.isJustReleased("jump")).toBe(false);
    });

    it("listenForNextKey resolves with gamepad code from polling", async () => {
      const promise = input.listenForNextKey();
      setPads([makePad({ buttons: [{ pressed: true }] })]);
      input._pollGamepads();
      await expect(promise).resolves.toBe("GamepadA");
    });

    it("held-button-during-listen does not re-fire on subsequent polls", async () => {
      input.setActionMap({ jump: ["GamepadA"] });
      const promise = input.listenForNextKey();

      setPads([makePad({ buttons: [{ pressed: true }] })]);
      input._pollGamepads();
      await promise;
      input._clearFrameState();

      // Button still held — polling must not re-fire
      input._pollGamepads();
      expect(input.isJustPressed("jump")).toBe(false);
      expect(input.isPressed("jump")).toBe(false);
    });

    it("getStick(deadzone:0) returns Vec2.ZERO when stick is centered (no NaN)", () => {
      input.setDeadzones({ stick: 0 });
      input.fireGamepadAxis("leftX", 0);
      input.fireGamepadAxis("leftY", 0);
      const v = input.getStick("left");
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
      expect(Number.isNaN(v.x)).toBe(false);
      expect(Number.isNaN(v.y)).toBe(false);
    });

    it("fireGamepadAxis on triggers emits GamepadLT/GamepadRT button edges", () => {
      input.setActionMap({ shoot: ["GamepadRT"], aim: ["GamepadLT"] });
      input.setTriggerThreshold(0.5);

      input.fireGamepadAxis("rightTrigger", 0.3);
      expect(input.isPressed("shoot")).toBe(false);

      input.fireGamepadAxis("rightTrigger", 0.8);
      expect(input.isPressed("shoot")).toBe(true);

      input._clearFrameState();
      input.fireGamepadAxis("rightTrigger", 0.2);
      expect(input.isPressed("shoot")).toBe(false);

      input.fireGamepadAxis("leftTrigger", 0.9);
      expect(input.isPressed("aim")).toBe(true);
    });

    it("LT/RT fire as buttons when value exceeds triggerThreshold", () => {
      input.setActionMap({ shoot: ["GamepadRT"] });
      input.setTriggerThreshold(0.5);

      const buttons = Array.from({ length: 8 }, () => ({ pressed: false, value: 0 }));
      buttons[7] = { pressed: false, value: 0.3 };
      setPads([makePad({ buttons })]);
      input._pollGamepads();
      expect(input.isPressed("shoot")).toBe(false);

      buttons[7] = { pressed: false, value: 0.8 };
      setPads([makePad({ buttons })]);
      input._pollGamepads();
      expect(input.isPressed("shoot")).toBe(true);
    });

    it("non-standard mapping uses GamepadButton{N} fallback", () => {
      input.setActionMap({ jump: ["GamepadButton0"] });
      setPads([
        makePad({ mapping: "", buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      expect(input.isPressed("jump")).toBe(true);
    });

    it("_onGamepadDisconnected releases held codes when polling is enabled", () => {
      input.setActionMap({ jump: ["GamepadA"] });

      // Press
      setPads([makePad({ index: 0, buttons: [{ pressed: true }] })]);
      input._pollGamepads();
      expect(input.isPressed("jump")).toBe(true);

      // Pad gone
      setPads([null]);
      input._onGamepadDisconnected({ index: 0, id: "test-pad" });
      expect(input.isPressed("jump")).toBe(false);
    });

    it("_onGamepadDisconnected force-releases when polling disabled", () => {
      input.setActionMap({ jump: ["GamepadA"] });
      input.fireGamepadButton("GamepadA", true);
      expect(input.isPressed("jump")).toBe(true);

      input.setPollingEnabled(false);
      input._onGamepadDisconnected({ index: 0, id: "test-pad" });
      expect(input.isPressed("jump")).toBe(false);
    });

    it("onGamepadConnected replays currently-known pads on subscribe", () => {
      const seen: number[] = [];
      input._onGamepadConnected({ index: 0, id: "p0" });
      input._onGamepadConnected({ index: 2, id: "p2" });

      input.onGamepadConnected((info) => seen.push(info.index));
      expect(seen).toEqual([0, 2]);
    });

    it("onGamepadConnected disposer stops further callbacks", () => {
      const seen: number[] = [];
      const dispose = input.onGamepadConnected((info) => seen.push(info.index));
      dispose();
      input._onGamepadConnected({ index: 5, id: "p5" });
      expect(seen).toEqual([]);
    });

    it("_releaseAllGamepadState clears pressed gamepad keys but keeps keyboard state", () => {
      input.setActionMap({ jump: ["GamepadA"], left: ["KeyA"] });
      input.fireGamepadButton("GamepadA", true);
      input._onKeyDown("KeyA");

      input._releaseAllGamepadState();
      expect(input.isPressed("jump")).toBe(false);
      expect(input.isPressed("left")).toBe(true);
    });

    it("_releaseAllGamepadState clears real-pad axis values but preserves synthetic ones", () => {
      // Real pad axis stored under a non-synthetic index
      setPads([makePad({ index: 0, axes: [0.7, 0, 0, 0] })]);
      input._pollGamepads();
      expect(input.getStick("left").x).toBeGreaterThan(0);

      // Synthetic axis injected directly
      input.fireGamepadAxis("rightX", 0.5);
      expect(input.getStick("right").x).toBeGreaterThan(0);

      // Real pad disconnects from polling cycle
      setPads([]);
      input._releaseAllGamepadState();

      // Real-pad axis is gone
      expect(input.getStick("left")).toEqual(Vec2.ZERO);
      // Synthetic axis survives
      expect(input.getStick("right").x).toBeGreaterThan(0);
    });

    it("snapshotState splits keyboard and gamepad keys", () => {
      input.fireKeyDown("Space");
      input.fireGamepadButton("GamepadA", true);

      const snap = input.snapshotState();
      expect(snap.keys).toEqual(["Space"]);
      expect(snap.gamepad.buttons).toEqual(["GamepadA"]);
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
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
});

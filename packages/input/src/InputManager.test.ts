import { describe, it, expect, beforeEach } from "vitest";
import { Vec2 } from "@yage/core";
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
    input._setCamera(mockCamera);
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
});

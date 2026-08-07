import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Vec2, ErrorBoundary, Logger, LogLevel } from "@yagejs/core";
import { InputManager } from "./InputManager.js";
import type { PointerInfo } from "./types.js";

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

  it("getHoldDuration returns seconds since key press", () => {
    input._advanceTime(100);
    input._onKeyDown("Space");

    input._advanceTime(250);
    expect(input.getHoldDuration("jump")).toBe(0.25);
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
    // KeyA held for 300ms, ArrowLeft held for 200ms — should return 0.3s
    expect(input.getHoldDuration("moveLeft")).toBe(0.3);
  });

  it("isHeldFor returns true when held long enough", () => {
    input._onKeyDown("Space");
    input._advanceTime(500);
    expect(input.isHeldFor("jump", 0.5)).toBe(true);
  });

  it("isHeldFor returns false when not held long enough", () => {
    input._onKeyDown("Space");
    input._advanceTime(200);
    expect(input.isHeldFor("jump", 0.5)).toBe(false);
  });

  // -- tap / hold classifier --

  describe("isJustHeldFor / release classifier", () => {
    it("isJustHeldFor fires once, on the frame the hold crosses the threshold", () => {
      input._onKeyDown("Space"); // holdStart at elapsed 0
      // 100ms frames ended by _clearFrameState, as InputClearSystem does each
      // frame; the 0.5s threshold crosses when the hold reaches 500ms.
      for (let held = 100; held < 500; held += 100) {
        input._advanceTime(100);
        expect(input.isJustHeldFor("jump", 0.5)).toBe(false);
        input._clearFrameState();
      }
      input._advanceTime(100); // hold reaches 500ms
      expect(input.isJustHeldFor("jump", 0.5)).toBe(true);
      input._clearFrameState();
      input._advanceTime(100); // hold past 500ms
      expect(input.isJustHeldFor("jump", 0.5)).toBe(false);
    });

    it("isJustHeldFor does not re-fire when the longer-held of two bound keys releases", () => {
      input._onKeyDown("KeyA"); // moveLeft binding #1, holdStart at elapsed 0
      input._advanceTime(100);
      input._clearFrameState();
      input._onKeyDown("ArrowLeft"); // binding #2, staggered 100ms behind
      // Advance to elapsed 600ms: KeyA's hold (the max) crosses 0.55s once.
      let fired = 0;
      for (let i = 0; i < 5; i++) {
        input._advanceTime(100);
        if (input.isJustHeldFor("moveLeft", 0.55)) fired++;
        input._clearFrameState();
      }
      expect(fired).toBe(1);
      // Releasing KeyA drops the action's hold to ArrowLeft's shorter one
      // (600ms at elapsed 700) — the drop must not re-trigger the crossing.
      input._onKeyUp("KeyA");
      input._advanceTime(100);
      expect(input.isJustHeldFor("moveLeft", 0.55)).toBe(false);
    });

    it("release wins over hold-start: no hold-start edge on the release frame", () => {
      input._onKeyDown("Space");
      input._advanceTime(500); // hold reaches the threshold this frame
      // Released before the next frame's advance (drain-then-advance order),
      // so the hold-start edge never fires — the release classifies it.
      input._onKeyUp("Space"); // releaseDuration = 500ms
      input._advanceTime(100);
      expect(input.isJustHeldFor("jump", 0.5)).toBe(false);
      expect(input.getReleaseDuration("jump")).toBe(0.5);
      expect(input.isJustReleasedAfter("jump", 0.5)).toBe(true);
    });

    it("getReleaseDuration is valid only on the release frame", () => {
      input._onKeyDown("Space");
      input._advanceTime(300);
      expect(input.getReleaseDuration("jump")).toBe(0); // not released yet
      input._onKeyUp("Space");
      expect(input.getReleaseDuration("jump")).toBe(0.3);
      input._clearFrameState();
      expect(input.getReleaseDuration("jump")).toBe(0); // cleared next frame
    });

    it("isJustTapped is true on release when held within maxSeconds", () => {
      input._onKeyDown("Space");
      input._advanceTime(150);
      input._onKeyUp("Space");
      expect(input.isJustTapped("jump", 0.2)).toBe(true);
      expect(input.isJustTapped("jump", 0.1)).toBe(false); // 0.15s exceeds 0.1s
    });

    it("isJustReleasedAfter is true on release when held at least minSeconds", () => {
      input._onKeyDown("Space");
      input._advanceTime(600);
      input._onKeyUp("Space");
      expect(input.isJustReleasedAfter("jump", 0.5)).toBe(true);
      expect(input.isJustReleasedAfter("jump", 0.7)).toBe(false);
    });

    it("isJustHeldFor does not re-fire when a disabled group re-enables mid-hold", () => {
      input.setGroups({ gameplay: ["jump"] });
      input._onKeyDown("Space");
      input._advanceTime(600); // hold crosses 0.5s
      expect(input.isJustHeldFor("jump", 0.5)).toBe(true);
      input._clearFrameState();
      input.disableGroup("gameplay"); // menu opens; key stays physically held
      input._advanceTime(100);
      expect(input.isJustHeldFor("jump", 0.5)).toBe(false); // masked while disabled
      input._clearFrameState();
      input.enableGroup("gameplay"); // menu closes, key never released
      input._advanceTime(100);
      expect(input.isJustHeldFor("jump", 0.5)).toBe(false); // no second crossing
    });

    it("release helpers stay quiet on a partial chord release", () => {
      input._onKeyDown("KeyA"); // moveLeft binding #1
      input._advanceTime(600);
      input._onKeyDown("ArrowLeft"); // binding #2 joins at 600ms
      input._advanceTime(200);
      input._onKeyUp("KeyA"); // action still held via ArrowLeft
      expect(input.isJustReleased("moveLeft")).toBe(true); // per-binding edge, unchanged
      expect(input.getReleaseDuration("moveLeft")).toBe(0);
      expect(input.isJustTapped("moveLeft", 10)).toBe(false);
      expect(input.isJustReleasedAfter("moveLeft", 0.1)).toBe(false);
      input._clearFrameState();
      input._advanceTime(200);
      input._onKeyUp("ArrowLeft"); // full release: ArrowLeft held 400ms
      expect(input.getReleaseDuration("moveLeft")).toBe(0.4);
      expect(input.isJustReleasedAfter("moveLeft", 0.4)).toBe(true);
    });

    it("classifier works for synthetic presses (fireActionDown / fireActionUp)", () => {
      input.fireActionDown("jump");
      input._advanceTime(500);
      expect(input.isJustHeldFor("jump", 0.5)).toBe(true);
      input.fireActionUp("jump");
      expect(input.getReleaseDuration("jump")).toBe(0.5);
      expect(input.isJustReleasedAfter("jump", 0.5)).toBe(true);
    });

    it("classifier works under per-frame setActionHeld mirroring", () => {
      input.setActionHeld("jump", true);
      input._advanceTime(200);
      input.setActionHeld("jump", true); // idempotent re-assert keeps the start
      input._advanceTime(200);
      expect(input.getHoldDuration("jump")).toBe(0.4);
      input.setActionHeld("jump", false); // release
      expect(input.getReleaseDuration("jump")).toBe(0.4);
    });
  });

  // -- buffered press --

  describe("consumeBufferedPress", () => {
    it("is true within the window", () => {
      input._onKeyDown("Space"); // press at elapsed 0
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
    });

    it("is false once the window elapses", () => {
      input._onKeyDown("Space");
      input._advanceTime(200); // 0.2s exceeds the 0.12s window
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
    });

    it("claim-once: fires at most once per press", () => {
      input._onKeyDown("Space");
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
    });

    it("a new press re-arms the buffer after a consume", () => {
      input._onKeyDown("Space");
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
      input._onKeyUp("Space");
      input._onKeyDown("Space"); // new press clears the claim
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
    });

    it("consumption does not suppress isJustPressed", () => {
      input._onKeyDown("Space");
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
      expect(input.isJustPressed("jump")).toBe(true);
    });

    it("records a buffered press for synthetic input", () => {
      input.fireActionDown("jump");
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
    });

    it("keeps the simulation-time window open while the scene clock is paused", () => {
      const clock = { elapsed: 0 };
      input._registerClock(clock);
      input._onKeyDown("Space");

      input._advanceTime(500);

      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);
    });

    it("expires the window on simulation time", () => {
      const clock = { elapsed: 0 };
      input._registerClock(clock);
      input._onKeyDown("Space");

      clock.elapsed = 0.13;

      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(false);
    });

    it("keeps the window open when simulation time runs at half speed", () => {
      const clock = { elapsed: 0 };
      input._registerClock(clock);
      input._onKeyDown("Space");

      input._advanceTime(200);
      clock.elapsed = 0.1;

      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);
    });

    it("shares the claim across clocks and re-arms both on a new press", () => {
      const clock = { elapsed: 0 };
      input._registerClock(clock);
      input._onKeyDown("Space");

      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);

      input._onKeyUp("Space");
      input._onKeyDown("Space");
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(false);

      input._onKeyUp("Space");
      input._onKeyDown("Space");
      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);
    });

    it("throws for an unregistered clock", () => {
      const clock = { elapsed: 0 };

      expect(() => input.consumeBufferedPress("jump", 0.12, { clock })).toThrow(
        /clock/,
      );
    });

    it("records no press for an action whose group is disabled", () => {
      // Lets a pause menu keep its own input out of the gameplay buffer.
      input.setGroups({ gameplay: ["jump"] });
      input.disableGroup("gameplay");
      input._onKeyDown("Space");
      input.enableGroup("gameplay");

      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);
    });

    it("does not claim a press while the action is disabled", () => {
      // A discard-on-resume call must run with the action enabled, or the
      // press survives to fire on the next gameplay frame.
      input._onKeyDown("Space");
      input.setGroups({ gameplay: ["jump"] });
      input.disableGroup("gameplay");

      expect(input.consumeBufferedPress("jump", 0.12)).toBe(false);

      input.enableGroup("gameplay");
      expect(input.consumeBufferedPress("jump", 0.12)).toBe(true);
    });

    it("clearAll() drops clock stamps but keeps the clock registered", () => {
      const clock = { elapsed: 0 };
      input._registerClock(clock);
      input._onKeyDown("Space");

      input.clearAll();

      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(false);
      input._onKeyDown("Space");
      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(true);
    });

    it("drops a clock's stamps when the clock is unregistered", () => {
      const clock = { elapsed: 0 };
      input._registerClock(clock);
      input._onKeyDown("Space");

      input._unregisterClock(clock);
      input._registerClock(clock);

      expect(input.consumeBufferedPress("jump", 0.12, { clock })).toBe(false);
    });
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
    input.firePointerMove(150, 200);
    const pos = input.getPointerScreenPosition();
    expect(pos.x).toBe(150);
    expect(pos.y).toBe(200);
  });

  it("getPointerPosition returns world coords when camera is set", () => {
    const mockCamera = {
      screenToWorld: (sx: number, sy: number) => new Vec2(sx * 2, sy * 2),
    };
    input.setCamera(mockCamera);
    input.firePointerMove(100, 50);
    const pos = input.getPointerPosition();
    expect(pos.x).toBe(200);
    expect(pos.y).toBe(100);
  });

  it("getPointerPosition returns screen coords when no camera", () => {
    input.firePointerMove(100, 50);
    const pos = input.getPointerPosition();
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(50);
  });

  it("isPointerDown tracks pointer state", () => {
    expect(input.isPointerDown()).toBe(false);
    input.firePointerDown(0);
    expect(input.isPointerDown()).toBe(true);
    input.firePointerUp(0);
    expect(input.isPointerDown()).toBe(false);
  });

  // -- Multi-pointer / touch --

  describe("multi-pointer", () => {
    it("getPointers returns one entry per active pointer", () => {
      input.firePointerMove(10, 20, { id: 1, type: "mouse" });
      input.firePointerDown(0, { id: 5, type: "touch", isPrimary: false });
      input.firePointerMove(100, 200, { id: 5, type: "touch", isPrimary: false });

      const pointers = input.getPointers();
      expect(pointers.length).toBe(2);
      const mouse = pointers.find((p) => p.type === "mouse");
      const touch = pointers.find((p) => p.type === "touch");
      expect(mouse).toBeDefined();
      expect(touch).toBeDefined();
      expect(touch!.id).toBe(5);
      expect(touch!.screenPos.x).toBe(100);
      expect(touch!.buttons.has(0)).toBe(true);
      expect(touch!.isDown).toBe(true);
    });

    it("getPointer looks up by id", () => {
      input.firePointerMove(50, 60, { id: 7, type: "touch", isPrimary: false });
      const p = input.getPointer(7);
      expect(p?.id).toBe(7);
      expect(p?.screenPos.x).toBe(50);
      expect(input.getPointer(999)).toBeUndefined();
    });

    it("releasing one of two touches keeps the other tracked", () => {
      input.firePointerDown(0, { id: 10, type: "touch" });
      input.firePointerDown(0, { id: 11, type: "touch", isPrimary: false });
      expect(input.getPointers().length).toBe(2);

      input.firePointerUp(0, { id: 10 });
      const remaining = input.getPointers();
      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe(11);
    });

    it("MouseLeft aggregate stays held while any pointer holds button 0", () => {
      input.firePointerDown(0, { id: 10, type: "touch" });
      input.firePointerDown(0, { id: 11, type: "touch", isPrimary: false });
      expect(input.isPressed("fire")).toBe(true);

      input.firePointerUp(0, { id: 10 });
      expect(input.isPressed("fire")).toBe(true); // pointer 11 still holds it

      input.firePointerUp(0, { id: 11 });
      expect(input.isPressed("fire")).toBe(false);
    });

    it("primary getters keep tracking the primary pointer when others are present", () => {
      input.firePointerMove(40, 50, { id: 1, type: "mouse" });
      input.firePointerMove(900, 900, { id: 5, type: "touch", isPrimary: false });

      const pos = input.getPointerScreenPosition();
      expect(pos.x).toBe(40);
      expect(pos.y).toBe(50);
    });

    it("snapshot includes the pointers array alongside mouse", () => {
      input.firePointerMove(10, 20);
      input.firePointerDown(0);
      input.firePointerDown(0, { id: 7, type: "touch", isPrimary: false });

      const snap = input.snapshotState();
      expect(snap.pointers.length).toBe(2);
      expect(snap.pointers.map((p) => p.id).sort()).toEqual([1, 7]);
      expect(snap.mouse.x).toBe(10);
      expect(snap.mouse.down).toBe(true);
    });

    it("onPointerDown fires with PointerInfo and disposer detaches", () => {
      const events: number[] = [];
      const dispose = input.onPointerDown((info) => events.push(info.id));

      input.firePointerDown(0, { id: 3, type: "touch" });
      input.firePointerDown(0, { id: 4, type: "touch", isPrimary: false });
      dispose();
      input.firePointerDown(0, { id: 5, type: "touch", isPrimary: false });

      expect(events).toEqual([3, 4]);
    });

    it("onPointerUp fires when a touch releases its last button", () => {
      const released: number[] = [];
      input.onPointerUp((info) => released.push(info.id));

      input.firePointerDown(0, { id: 9, type: "touch" });
      input.firePointerUp(0, { id: 9 });

      expect(released).toEqual([9]);
      expect(input.getPointer(9)).toBeUndefined();
    });

    it("_onPointerCancel drops the pointer and releases aggregate buttons", () => {
      input.firePointerDown(0, { id: 12, type: "touch" });
      expect(input.isPressed("fire")).toBe(true);

      input._onPointerCancel(12);

      expect(input.getPointer(12)).toBeUndefined();
      expect(input.isPressed("fire")).toBe(false);
    });

    it("_onPointerCancel keeps mouse pointers in getPointers (cursor persistence)", () => {
      input.firePointerMove(40, 50);
      input.firePointerDown(0);
      expect(input.isPressed("fire")).toBe(true);

      input._onPointerCancel(1);

      // Mouse persists across cancel for the same reason it persists across
      // up — the cursor's last position is still useful for hover queries.
      expect(input.getPointer(1)).toBeDefined();
      expect(input.getPointer(1)?.screenPos.x).toBe(40);
      // ...but its aggregate buttons are released.
      expect(input.isPressed("fire")).toBe(false);
      expect(input.isPointerDown()).toBe(false);
    });

    it("getPointerPosition returns Vec2.ZERO when no pointer is tracked even with a camera set", () => {
      input.setCamera({
        screenToWorld: (sx: number, sy: number) => new Vec2(sx + 100, sy + 100),
      });
      const pos = input.getPointerPosition();
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });

    it("getPointers returns defensive snapshots — mutating buttons does not affect manager state", () => {
      input.firePointerDown(0, { id: 9, type: "touch" });

      const snap = input.getPointer(9);
      expect(snap?.buttons.has(0)).toBe(true);

      // Even though `buttons` is typed ReadonlySet, the runtime is a real Set;
      // a misbehaving consumer cannot corrupt manager state through it.
      (snap!.buttons as Set<number>).clear();
      expect(input.getPointer(9)?.buttons.has(0)).toBe(true);
      expect(input.isPressed("fire")).toBe(true);
    });

    it("clearPointerButtons drops all pointers and releases aggregate", () => {
      input.firePointerDown(0, { id: 1, type: "mouse" });
      input.firePointerDown(0, { id: 2, type: "touch", isPrimary: false });
      expect(input.isPressed("fire")).toBe(true);

      input.clearPointerButtons();

      expect(input.getPointers()).toHaveLength(0);
      expect(input.isPressed("fire")).toBe(false);
    });
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

  // -- Frame deferral / drain --

  describe("frame deferral", () => {
    it("same-frame DOM pointerdown+pointerup still fires MouseLeft press/release edges", () => {
      // Regression: when the rAF tick is throttled or events are dispatched
      // back-to-back (Playwright `mouse.down(); mouse.up();`), both fire
      // before drain. The drain must replay the buffered button transitions
      // — recomputing aggregate from live state alone would silently drop
      // the click because pointer.buttons is back to empty.
      const downs: string[] = [];
      const ups: string[] = [];
      input.onAction("fire", (n) => downs.push(n));
      input.onActionReleased("fire", (n) => ups.push(n));

      input._enqueuePointerDown({
        id: 1,
        screenX: 10,
        screenY: 20,
        type: "mouse",
        isPrimary: true,
        button: 0,
      });
      input._enqueuePointerUp({
        id: 1,
        screenX: 10,
        screenY: 20,
        type: "mouse",
        isPrimary: true,
        button: 0,
      });
      // Pre-drain: action queries see no edge yet
      expect(input.isJustPressed("fire")).toBe(false);

      input._drainInputQueue();

      expect(input.isJustPressed("fire")).toBe(true);
      expect(input.isJustReleased("fire")).toBe(true);
      expect(input.isPressed("fire")).toBe(false);
      expect(downs).toEqual(["fire"]);
      expect(ups).toEqual(["fire"]);
    });

    it("exposes the triggering button via info.button before the edge is drained", () => {
      const downButtons: number[] = [];
      const downSawInButtons: boolean[] = [];
      const upButtons: number[] = [];
      input.onPointerDown((info) => {
        downButtons.push(info.button);
        downSawInButtons.push(info.buttons.has(info.button));
      });
      input.onPointerUp((info) => upButtons.push(info.button));

      input._enqueuePointerDown({
        id: 1,
        screenX: 0,
        screenY: 0,
        type: "mouse",
        isPrimary: true,
        button: 2,
      });
      input._enqueuePointerUp({
        id: 1,
        screenX: 0,
        screenY: 0,
        type: "mouse",
        isPrimary: true,
        button: 2,
      });

      // `info.button` identifies the right-click even though the press edge
      // is not yet drained into `buttons` — the gap that made gating an
      // onPointerDown listener on `buttons.has(0)` a permanent no-op.
      expect(downButtons).toEqual([2]);
      expect(downSawInButtons).toEqual([false]);
      expect(upButtons).toEqual([2]);
    });

    it("consumePointer keeps a forwarded synthetic pointerdown out of action edges while listeners still fire", () => {
      // A DOM overlay forwards a synthetic button-0 pointerdown to the canvas
      // and pairs it with consumePointer(id). The MouseLeft action edge is
      // suppressed, but raw onPointerDown listeners (e.g. a dialogue box under
      // the overlay) still receive the event.
      const downs: PointerInfo[] = [];
      const fires: string[] = [];
      input.onPointerDown((info) => downs.push(info));
      input.onAction("fire", (n) => fires.push(n));

      input._enqueuePointerDown({
        id: 7,
        screenX: 10,
        screenY: 20,
        type: "touch",
        isPrimary: true,
        button: 0,
      });
      input.consumePointer(7);
      input._drainInputQueue();

      expect(input.isPressed("fire")).toBe(false);
      expect(input.isJustPressed("fire")).toBe(false);
      expect(fires).toEqual([]);
      expect(input.snapshotState().mouse.buttons).not.toContain(0);
      // The forward still reached the raw listener.
      expect(downs.map((d) => d.id)).toEqual([7]);
    });

    it("without consumePointer a forwarded button-0 pointerdown fires the action edge", () => {
      const fires: string[] = [];
      input.onAction("fire", (n) => fires.push(n));

      input._enqueuePointerDown({
        id: 7,
        screenX: 10,
        screenY: 20,
        type: "touch",
        isPrimary: true,
        button: 0,
      });
      input._drainInputQueue();

      expect(input.isPressed("fire")).toBe(true);
      expect(fires).toEqual(["fire"]);
    });

    it("moves and query snapshots carry button === -1", () => {
      const moveButtons: number[] = [];
      input.onPointerMove((info) => moveButtons.push(info.button));

      input.firePointerMove(7, 8);
      input.firePointerDown(0);

      expect(moveButtons).toEqual([-1]);
      expect(input.getPointers().every((p) => p.button === -1)).toBe(true);
      expect(input.getPointer(1)?.button).toBe(-1);
    });
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

    it("hasAction reflects the current action map", () => {
      expect(input.hasAction("jump")).toBe(true);
      expect(input.hasAction("unknown")).toBe(false);
    });

    it("fireActionDown sustains isPressed across frames", () => {
      input.fireActionDown("jump");
      expect(input.isPressed("jump")).toBe(true);
      expect(input.isJustPressed("jump")).toBe(true);

      input._clearFrameState();
      // The press edge has passed, but the hold persists.
      expect(input.isPressed("jump")).toBe(true);
      expect(input.isJustPressed("jump")).toBe(false);

      input._clearFrameState();
      expect(input.isPressed("jump")).toBe(true);
    });

    it("fireActionUp emits a one-frame release edge and fires onActionReleased", () => {
      const released: string[] = [];
      input.onActionReleased("jump", (n) => released.push(n));

      input.fireActionDown("jump");
      input._clearFrameState();
      input.fireActionUp("jump");

      expect(input.isPressed("jump")).toBe(false);
      expect(input.isJustReleased("jump")).toBe(true);
      expect(released).toEqual(["jump"]);

      input._clearFrameState();
      expect(input.isJustReleased("jump")).toBe(false);
    });

    it("getHoldDuration accrues while a synthetic action is held and resets on release", () => {
      input.fireActionDown("jump");
      input._advanceTime(100);
      expect(input.getHoldDuration("jump")).toBe(0.1);

      input._clearFrameState();
      input._advanceTime(150);
      expect(input.getHoldDuration("jump")).toBe(0.25);
      expect(input.isHeldFor("jump", 0.2)).toBe(true);

      input.fireActionUp("jump");
      expect(input.getHoldDuration("jump")).toBe(0);
    });

    it("fireActionDown is idempotent — a repeat does not reset the hold start", () => {
      input.fireActionDown("jump");
      input._advanceTime(100);
      input._clearFrameState();
      input.fireActionDown("jump");
      input._advanceTime(100);
      // Re-down kept the original start, so the duration keeps growing.
      expect(input.getHoldDuration("jump")).toBe(0.2);
    });

    it("fireActionDown fires onAction only on the rising edge", () => {
      const pressed: string[] = [];
      input.onAction("jump", (n) => pressed.push(n));

      input.fireActionDown("jump");
      input._clearFrameState();
      input.fireActionDown("jump");

      expect(pressed).toEqual(["jump"]);
    });

    it("setActionHeld mirrors a held boolean onto down/up", () => {
      input.setActionHeld("jump", true);
      expect(input.isPressed("jump")).toBe(true);

      input._clearFrameState();
      input.setActionHeld("jump", false);
      expect(input.isPressed("jump")).toBe(false);
      expect(input.isJustReleased("jump")).toBe(true);
    });

    it("fireActionUp is a no-op when the action is not held", () => {
      const released: string[] = [];
      input.onActionReleased("jump", (n) => released.push(n));
      input.fireActionUp("jump");
      expect(input.isJustReleased("jump")).toBe(false);
      expect(released).toEqual([]);
    });

    it("disabled group silences synthetic onAction / onActionReleased", () => {
      const pressed: string[] = [];
      const released: string[] = [];
      input.onAction("jump", (n) => pressed.push(n));
      input.onActionReleased("jump", (n) => released.push(n));
      input.setGroups({ movement: ["jump"] });

      input.disableGroup("movement");
      input.fireActionDown("jump");
      input._clearFrameState();
      input.fireActionUp("jump");
      expect(input.isPressed("jump")).toBe(false);
      expect(pressed).toEqual([]);
      expect(released).toEqual([]);

      input.enableGroup("movement");
      input.fireActionDown("jump");
      input._clearFrameState();
      input.fireActionUp("jump");
      expect(pressed).toEqual(["jump"]);
      expect(released).toEqual(["jump"]);
    });

    it("snapshotState lists a held synthetic action under actions", () => {
      input.fireActionDown("jump");
      input._clearFrameState();
      expect(input.snapshotState().actions).toContain("jump");
    });

    it("clearAll releases held synthetic actions", () => {
      input.fireActionDown("jump");
      input.clearAll();
      expect(input.isPressed("jump")).toBe(false);
      expect(input.snapshotState().actions).toEqual([]);
    });

    it("reports elapsed input time in seconds", () => {
      expect(input.getClockTime()).toBe(0);

      input._advanceTime(250);
      input._advanceTime(16);

      expect(input.getClockTime()).toBe(0.266);
    });

    it("does not reset the input clock when clearing state", () => {
      input._advanceTime(250);
      input.fireActionDown("jump");

      input.clearAll();

      expect(input.getClockTime()).toBe(0.25);
    });

    it("lets action listeners observe the input clock at each edge", () => {
      const edges: Array<{ edge: "press" | "release"; time: number }> = [];
      input.onAction("jump", () => {
        edges.push({ edge: "press", time: input.getClockTime() });
      });
      input.onActionReleased("jump", () => {
        edges.push({ edge: "release", time: input.getClockTime() });
      });

      input._advanceTime(125);
      input.fireActionDown("jump");
      input._advanceTime(75);
      input.fireActionUp("jump");

      expect(edges).toEqual([
        { edge: "press", time: 0.125 },
        { edge: "release", time: 0.2 },
      ]);
    });

    it("fireActionDown / fireActionUp / setActionHeld throw for unknown actions", () => {
      expect(() => input.fireActionDown("unknown")).toThrow(
        'unknown action "unknown"',
      );
      expect(() => input.fireActionUp("unknown")).toThrow(
        'unknown action "unknown"',
      );
      expect(() => input.setActionHeld("unknown", true)).toThrow(
        'unknown action "unknown"',
      );
      expect(() => input.setActionHeld("unknown", false)).toThrow(
        'unknown action "unknown"',
      );
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
        pointers: [
          {
            id: 1,
            x: 120,
            y: 240,
            type: "mouse",
            isPrimary: true,
            buttons: [0],
            down: true,
          },
        ],
        gamepad: {
          buttons: ["GamepadB"],
          axes: [{ key: "synthetic:leftX", value: 0.5 }],
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
        pointers: [],
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

    it("an idle active pad does not mask synthetic stick injection", () => {
      // Resting-noise axes stay inside the deadzone → synthetic reads back.
      setPads([makePad({ axes: [0.02, -0.01, 0, 0] })]);
      input._pollGamepads();
      input.fireGamepadAxis("leftX", 1);
      expect(input.getStick("left").x).toBeCloseTo(1, 5);

      // A pad deflected past the deadzone wins over the synthetic value.
      setPads([makePad({ axes: [-0.8, 0, 0, 0] })]);
      input._pollGamepads();
      expect(input.getStick("left").x).toBeLessThan(0);
    });

    it("an idle active pad does not mask synthetic trigger injection", () => {
      setPads([makePad({ axes: [0, 0, 0, 0] })]);
      input._pollGamepads();
      input.fireGamepadAxis("leftTrigger", 1);
      expect(input.getTrigger("left")).toBeCloseTo(1, 5);
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
      input._onGamepadConnected({ index: 0, id: "test-pad" });
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

    it("_releaseAllGamepadState clears real-pad state but preserves synthetic axis injection", () => {
      // Real pad activates and supplies stick data
      setPads([makePad({ index: 0, axes: [0.7, 0, 0, 0] })]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);
      expect(input.getStick("left").x).toBeGreaterThan(0);

      // Synthetic axis injection lives in its own slot (shadowed while
      // a real pad is active — that's correct).
      input.fireGamepadAxis("rightX", 0.5);

      // Tab hides while real pad is mid-press
      setPads([]);
      input._releaseAllGamepadState();

      // Real-pad axis is gone
      expect(input.getStick("left", { pad: 0 })).toEqual(Vec2.ZERO);
      // Demoting to no active pad lets the synthetic state surface
      input.setActivePad(null);
      expect(input.getStick("right").x).toBeGreaterThan(0);
    });

    it("non-finite axis input via fireGamepadAxis is coerced to 0", () => {
      input.fireGamepadAxis("leftX", Number.NaN);
      input.fireGamepadAxis("leftY", Number.POSITIVE_INFINITY);
      const v = input.getStick("left");
      expect(Number.isNaN(v.x)).toBe(false);
      expect(Number.isNaN(v.y)).toBe(false);
      expect(v).toEqual(Vec2.ZERO);
    });

    it("non-finite trigger input via fireGamepadAxis is coerced to 0", () => {
      input.fireGamepadAxis("rightTrigger", Number.NaN);
      const t = input.getTrigger("right");
      expect(Number.isNaN(t)).toBe(false);
      expect(t).toBe(0);
    });

    it("non-finite axis values from polling are coerced to 0", () => {
      setPads([
        makePad({
          index: 0,
          axes: [Number.NaN, Number.POSITIVE_INFINITY, 0, 0],
        }),
      ]);
      input._pollGamepads();
      const v = input.getStick("left");
      expect(Number.isNaN(v.x)).toBe(false);
      expect(Number.isNaN(v.y)).toBe(false);
      expect(v).toEqual(Vec2.ZERO);
    });

    it("setDeadzones clamps stick to [0, 0.999] and ignores non-finite", () => {
      input.setDeadzones({ stick: 5 });
      input.fireGamepadAxis("leftX", 0.5);
      // With deadzone clamped to 0.999, mag=0.5 falls below → returns ZERO
      expect(input.getStick("left")).toEqual(Vec2.ZERO);

      input.setDeadzones({ stick: -1 });
      input.fireGamepadAxis("leftX", 0.5);
      // Clamped to 0; deadzone gate at 0 passes for mag=0.5
      expect(input.getStick("left").x).toBeGreaterThan(0);

      // Non-finite is ignored (stick stays at the previous clamped 0)
      input.setDeadzones({ stick: Number.NaN });
      input.fireGamepadAxis("leftX", 0.3);
      expect(input.getStick("left").x).toBeGreaterThan(0);
    });

    it("setTriggerThreshold clamps to [0, 1] and ignores non-finite", () => {
      input.setActionMap({ shoot: ["GamepadRT"] });

      input.setTriggerThreshold(2);
      input.fireGamepadAxis("rightTrigger", 0.99);
      // Threshold clamped to 1 — value 0.99 doesn't reach
      expect(input.isPressed("shoot")).toBe(false);

      input.setTriggerThreshold(-1);
      input.fireGamepadAxis("rightTrigger", 0.01);
      // Threshold clamped to 0 — anything > 0 fires
      expect(input.isPressed("shoot")).toBe(true);

      input.fireGamepadAxis("rightTrigger", 0); // reset
      input.setTriggerThreshold(Number.POSITIVE_INFINITY);
      input.fireGamepadAxis("rightTrigger", 0.5);
      // Non-finite ignored — last valid threshold (0) still wins
      expect(input.isPressed("shoot")).toBe(true);
    });

    it("polling drops axis state for pads that vanished without disconnect event", () => {
      setPads([makePad({ index: 0, axes: [0.7, 0, 0, 0] })]);
      input._pollGamepads();
      expect(input.getStick("left").x).toBeGreaterThan(0);

      // Pad disappears without firing gamepaddisconnected
      setPads([]);
      input._pollGamepads();
      expect(input.getStick("left")).toEqual(Vec2.ZERO);
    });

    // -- Active pad --

    it("getActivePad returns null when no pad is connected", () => {
      expect(input.getActivePad()).toBeNull();
    });

    it("first connect auto-promotes the pad to active", () => {
      setPads([makePad({ index: 2, buttons: [{ pressed: false }] })]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(2);
    });

    it("getStick reads from the active pad by default", () => {
      setPads([
        makePad({ index: 0, axes: [0.8, 0, 0, 0] }),
        makePad({ index: 1, axes: [0, 0, 0, 0] }),
      ]);
      input._pollGamepads();
      // Pad 0 connects first → becomes active and reads cleanly
      expect(input.getActivePad()?.index).toBe(0);
      expect(input.getStick("left").x).toBeGreaterThan(0);
    });

    it("getStick({ pad }) reads from a specific pad regardless of active", () => {
      setPads([
        makePad({ index: 0, axes: [0.6, 0, 0, 0] }),
        makePad({ index: 1, axes: [0.5, 0, 0, 0] }),
      ]);
      input._pollGamepads();
      // Active pad's own activity protects it from being stolen by pad 1
      expect(input.getActivePad()?.index).toBe(0);
      // Explicit pad lookup peeks at any pad regardless of active
      expect(input.getStick("left", { pad: 1 }).x).toBeGreaterThan(0);
      expect(input.getStick("left", { pad: 0 }).x).toBeGreaterThan(0);
    });

    it("rising-edge stick activity promotes inactive pad when active is idle", () => {
      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }], axes: [0, 0, 0, 0] }),
        makePad({ index: 1, buttons: [{ pressed: false }], axes: [0, 0, 0, 0] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);

      // Active pad is idle, pad 1 moves stick → promotion fires
      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }], axes: [0, 0, 0, 0] }),
        makePad({ index: 1, buttons: [{ pressed: false }], axes: [0.9, 0, 0, 0] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(1);
    });

    it("button press promotes inactive pad on rising edge when active is idle", () => {
      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }] }),
        makePad({ index: 1, buttons: [{ pressed: false }] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);

      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(1);
    });

    it("active pad's own activity protects against being stolen", () => {
      // Both pads connected, pad 0 active. Pad 1 presses a button while
      // pad 0 is also pressing — promotion does NOT fire (active protected).
      setPads([
        makePad({ index: 0, buttons: [{ pressed: true }] }),
        makePad({ index: 1, buttons: [{ pressed: false }] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);

      setPads([
        makePad({ index: 0, buttons: [{ pressed: true }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);
    });

    it("held activity on inactive pad does not bounce promotion", () => {
      // Pad 0 active. Pad 1 has continuously-held button. After pad 0 goes
      // idle, pad 1 is held but not rising-edge → no promotion bounce.
      setPads([
        makePad({ index: 0, buttons: [{ pressed: true }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      // Both have rising-edge activity, but pad 0 is active and protected
      expect(input.getActivePad()?.index).toBe(0);

      input._pollGamepads();
      input._pollGamepads();
      // Held state, no rising edges → active stable
      expect(input.getActivePad()?.index).toBe(0);
    });

    it("disconnect of active pad demotes to next remaining pad", () => {
      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }] }),
        makePad({ index: 1, buttons: [{ pressed: false }] }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);

      // Pad 0 vanishes — pad 1 takes over
      setPads([makePad({ index: 1, buttons: [{ pressed: false }] })]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(1);
    });

    it("disconnect of last pad sets active to null", () => {
      setPads([makePad({ index: 0 })]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);

      setPads([]);
      input._pollGamepads();
      expect(input.getActivePad()).toBeNull();
    });

    it("setActivePad manually switches between connected pads", () => {
      setPads([
        makePad({ index: 0 }),
        makePad({ index: 1 }),
      ]);
      input._pollGamepads();
      expect(input.getActivePad()?.index).toBe(0);

      input.setActivePad(1);
      expect(input.getActivePad()?.index).toBe(1);
    });

    it("setActivePad ignores unknown indices", () => {
      setPads([makePad({ index: 0 })]);
      input._pollGamepads();
      input.setActivePad(99);
      expect(input.getActivePad()?.index).toBe(0);
    });

    it("setActivePad(null) clears active and surfaces synthetic state", () => {
      setPads([makePad({ index: 0, axes: [0.7, 0, 0, 0] })]);
      input._pollGamepads();
      input.fireGamepadAxis("leftX", 0.4);

      // Real pad is active — synthetic shadowed
      expect(input.getStick("left").x).toBeGreaterThan(
        0.5, // pad 0's 0.7 reads through, not synthetic 0.4
      );

      input.setActivePad(null);
      expect(input.getActivePad()).toBeNull();
      // Now synthetic surfaces
      expect(input.getStick("left").x).toBeGreaterThan(0);
      expect(input.getStick("left").x).toBeLessThan(0.5);
    });

    it("onActivePadChanged replays current state on subscribe and fires on transitions", () => {
      const events: Array<number | null> = [];
      const dispose = input.onActivePadChanged((info) =>
        events.push(info?.index ?? null),
      );
      // Replay-on-subscribe: null because no pad yet
      expect(events).toEqual([null]);

      setPads([makePad({ index: 0 })]);
      input._pollGamepads();
      expect(events).toEqual([null, 0]);

      setPads([
        makePad({ index: 0, buttons: [{ pressed: false }] }),
        makePad({ index: 1, buttons: [{ pressed: true }] }),
      ]);
      input._pollGamepads();
      expect(events).toEqual([null, 0, 1]);

      dispose();
    });

    it("snapshotState splits keyboard and gamepad keys", () => {
      input.fireKeyDown("Space");
      input.fireGamepadButton("GamepadA", true);

      const snap = input.snapshotState();
      expect(snap.keys).toEqual(["Space"]);
      expect(snap.gamepad.buttons).toEqual(["GamepadA"]);
    });
  });

  describe("throwing listeners (with an error boundary wired)", () => {
    function wireBoundary(): { boundary: ErrorBoundary } {
      const logger = new Logger({ level: LogLevel.Debug });
      const boundary = new ErrorBoundary(logger);
      input._setErrorBoundary(boundary);
      return { boundary };
    }

    it("a throwing action listener rethrows, stopping later listeners for the same fire", () => {
      const { boundary } = wireBoundary();
      const calls: string[] = [];
      input.onAction("jump", () => calls.push("before"));
      input.onAction("jump", () => {
        throw new Error("boom");
      });
      input.onAction("jump", () => calls.push("after"));

      expect(() => input.fireAction("jump")).toThrow("boom");
      expect(calls).toEqual(["before"]);

      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Action listener",
        event: "jump",
      });
    });

    it("a throwing key listener stays registered and rethrows on every trigger", () => {
      const { boundary } = wireBoundary();
      let calls = 0;
      input.onKeyDown("Space", () => {
        calls++;
        throw new Error("boom");
      });

      expect(() => input._onKeyDown("Space")).toThrow("boom");
      input._onKeyUp("Space");
      expect(() => input._onKeyDown("Space")).toThrow("boom");

      expect(calls).toBe(2); // never removed
      expect(boundary.getCallbackErrors()).toHaveLength(2);
    });

    it("a throwing gamepad-connect listener rethrows, stopping later listeners for the same connect", () => {
      const { boundary } = wireBoundary();
      const calls: string[] = [];
      input.onGamepadConnected(() => calls.push("before"));
      input.onGamepadConnected(() => {
        throw new Error("boom");
      });
      input.onGamepadConnected(() => calls.push("after"));

      expect(() => input._onGamepadConnected({ index: 0, id: "pad-0" })).toThrow("boom");
      expect(calls).toEqual(["before"]);
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Gamepad connect listener",
      });
    });

    it("a throwing gamepad-disconnect listener rethrows, stopping later listeners for the same disconnect", () => {
      const { boundary } = wireBoundary();
      input._onGamepadConnected({ index: 0, id: "pad-0" });
      const calls: string[] = [];
      input.onGamepadDisconnected(() => calls.push("before"));
      input.onGamepadDisconnected(() => {
        throw new Error("boom");
      });
      input.onGamepadDisconnected(() => calls.push("after"));

      expect(() => input._onGamepadDisconnected({ index: 0, id: "pad-0" })).toThrow("boom");
      expect(calls).toEqual(["before"]);
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Gamepad disconnect listener",
      });
    });

    it("a throwing active-pad listener rethrows, stopping later listeners for the same change", () => {
      const { boundary } = wireBoundary();
      const calls: string[] = [];
      // onActivePadChanged replays synchronously (and unguarded) on subscribe,
      // so the throwing listener stays quiet for that initial replay and only
      // throws once armed — isolating the guarded fan-out in
      // setActivePadInternal, which is what this test targets.
      let armed = false;
      input.onActivePadChanged(() => calls.push("before"));
      input.onActivePadChanged(() => {
        if (!armed) return;
        throw new Error("boom");
      });
      input.onActivePadChanged(() => calls.push("after"));
      calls.length = 0;
      armed = true;

      expect(() => input._onGamepadConnected({ index: 0, id: "pad-0" })).toThrow("boom");
      expect(calls).toEqual(["before"]);
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Active pad listener",
      });
    });

    it("a throwing pointer-down listener rethrows, stopping later listeners for the same event", () => {
      const { boundary } = wireBoundary();
      const calls: string[] = [];
      input.onPointerDown(() => calls.push("before"));
      input.onPointerDown(() => {
        throw new Error("boom");
      });
      input.onPointerDown(() => calls.push("after"));

      expect(() => input.firePointerDown(0)).toThrow("boom");
      expect(calls).toEqual(["before"]);
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Pointer listener",
        event: "pointerdown",
      });
    });

    it("a throwing wheel listener rethrows, stopping later listeners for the same event", () => {
      const { boundary } = wireBoundary();
      const calls: string[] = [];
      input.onWheel(() => calls.push("before"));
      input.onWheel(() => {
        throw new Error("boom");
      });
      input.onWheel(() => calls.push("after"));

      expect(() => input.fireWheel(0, 1)).toThrow("boom");
      expect(calls).toEqual(["before"]);
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Wheel listener",
        event: "wheel",
      });
    });
  });
});

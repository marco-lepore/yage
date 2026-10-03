import { expect, it, vi } from "vitest";
import { InputManager } from "@yagejs/input";
import { PlatformerInputBinding, platformerControls } from "./input.js";
function setup() {
  const input = new InputManager();
  input.setActionMap(platformerControls());
  const target = {
    setDirection: vi.fn(),
    setDown: vi.fn(),
    setJumpHeld: vi.fn(),
    jump: vi.fn(),
    dash: vi.fn(),
  };
  const binding = new PlatformerInputBinding(undefined, () => ({
    x: 0,
    width: 800,
  }));
  binding.bind(input, target);
  return { input, target, binding };
}
it("reads keyboard, gamepad D-pad and analog movement", () => {
  const { input, target, binding } = setup();
  input.fireKeyDown("KeyD");
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(1);
  input.fireKeyUp("KeyD");
  input.fireGamepadButton("GamepadDPadLeft", true);
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(-1);
  input.fireGamepadButton("GamepadDPadLeft", false);
  input.fireGamepadAxis("leftX", 0.8);
  binding.poll();
  expect(target.setDirection.mock.lastCall?.[0]).toBeGreaterThan(0.5);
});
it("supports multi-touch movement plus one jump edge across repeated polls", () => {
  const { input, target, binding } = setup();
  input.firePointerMove(300, 50, { id: 2, type: "touch" });
  input.firePointerDown(0, { id: 2, type: "touch" });
  input.firePointerMove(700, 50, { id: 3, type: "touch" });
  input.firePointerDown(0, { id: 3, type: "touch" });
  binding.poll();
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(1);
  expect(target.setJumpHeld).toHaveBeenLastCalledWith(true);
  expect(target.jump).toHaveBeenCalledTimes(1);
  input.firePointerUp(0, { id: 3 });
  binding.poll();
  expect(target.setJumpHeld).toHaveBeenLastCalledWith(false);
  expect(target.setDirection).toHaveBeenLastCalledWith(1);
});
it("skips UI-owned pointers and removes subscriptions on dispose", () => {
  const input = new InputManager();
  input.onPointerDown((p) => input.consumePointer(p.id));
  const target = {
    setDirection: vi.fn(),
    setDown: vi.fn(),
    setJumpHeld: vi.fn(),
    jump: vi.fn(),
    dash: vi.fn(),
  };
  const binding = new PlatformerInputBinding(undefined, () => ({
    x: 0,
    width: 800,
  }));
  binding.bind(input, target);
  input.firePointerMove(700, 50);
  input.firePointerDown();
  binding.poll();
  expect(target.jump).not.toHaveBeenCalled();
  binding.dispose();
  target.setDirection.mockClear();
  binding.poll();
  expect(target.setDirection).not.toHaveBeenCalled();
});
it("mouse presses use the same zones and rebinding clears pointer state", () => {
  const { input, target, binding } = setup();
  input.firePointerMove(100, 40);
  input.firePointerDown();
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(-1);
  binding.bind(input, target);
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(0);
});

it("clears movement, held jump and pending jump after an input reset", () => {
  const { input, target, binding } = setup();
  input.firePointerMove(100, 40, { id: 2, type: "touch" });
  input.firePointerDown(0, { id: 2, type: "touch" });
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(-1);
  input.firePointerMove(700, 40, { id: 3, type: "touch" });
  input.firePointerDown(0, { id: 3, type: "touch" });
  input.clearAll();
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(0);
  expect(target.setJumpHeld).toHaveBeenLastCalledWith(false);
  expect(target.jump).not.toHaveBeenCalled();
});

it("keeps a quick released tap, but discards it after a reset", () => {
  const { input, target, binding } = setup();
  const tap = () => {
    input.firePointerMove(700, 40, { id: 3, type: "touch" });
    input.firePointerDown(0, { id: 3, type: "touch" });
    input.firePointerUp(0, { id: 3 });
  };
  tap();
  input._clearFrameState();
  binding.poll();
  binding.poll();
  expect(target.jump).toHaveBeenCalledTimes(1);
  expect(target.setJumpHeld).toHaveBeenLastCalledWith(false);
  tap();
  input._clearFrameState();
  input.clearAll();
  binding.poll();
  expect(target.jump).toHaveBeenCalledTimes(1);
});

it("does not carry a reset jump into a reused pointer id", () => {
  const { input, target, binding } = setup();
  input.firePointerMove(700, 40, { id: 3, type: "touch" });
  input.firePointerDown(0, { id: 3, type: "touch" });
  input.clearAll();
  input.firePointerMove(100, 40, { id: 3, type: "touch" });
  input.firePointerDown(0, { id: 3, type: "touch" });
  binding.poll();
  expect(target.jump).not.toHaveBeenCalled();
  expect(target.setDirection).toHaveBeenLastCalledWith(-1);
});

it("discards cancelled gestures and ignores unrelated mouse button releases", () => {
  const { input, target, binding } = setup();
  input.firePointerMove(700, 40);
  input.firePointerDown();
  input.clearPointerButtons();
  binding.poll();
  expect(target.jump).not.toHaveBeenCalled();
  input.firePointerMove(100, 40);
  input.firePointerDown();
  input.firePointerDown(2);
  input.firePointerUp(2);
  binding.poll();
  expect(target.setDirection).toHaveBeenLastCalledWith(-1);
});

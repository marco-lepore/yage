import { describe, it, expect } from "vitest";
import { getKeyDisplayName } from "./keyDisplayNames.js";

describe("getKeyDisplayName", () => {
  it("maps letter keys", () => {
    expect(getKeyDisplayName("KeyA")).toBe("A");
    expect(getKeyDisplayName("KeyZ")).toBe("Z");
  });

  it("maps digit keys", () => {
    expect(getKeyDisplayName("Digit0")).toBe("0");
    expect(getKeyDisplayName("Digit5")).toBe("5");
  });

  it("maps modifier keys", () => {
    expect(getKeyDisplayName("ShiftLeft")).toBe("Left Shift");
    expect(getKeyDisplayName("ControlRight")).toBe("Right Ctrl");
    expect(getKeyDisplayName("AltLeft")).toBe("Left Alt");
  });

  it("maps arrow keys", () => {
    expect(getKeyDisplayName("ArrowUp")).toBe("Up");
    expect(getKeyDisplayName("ArrowDown")).toBe("Down");
    expect(getKeyDisplayName("ArrowLeft")).toBe("Left");
    expect(getKeyDisplayName("ArrowRight")).toBe("Right");
  });

  it("maps common keys", () => {
    expect(getKeyDisplayName("Space")).toBe("Space");
    expect(getKeyDisplayName("Escape")).toBe("Esc");
    expect(getKeyDisplayName("Enter")).toBe("Enter");
    expect(getKeyDisplayName("Tab")).toBe("Tab");
    expect(getKeyDisplayName("Backspace")).toBe("Backspace");
  });

  it("maps mouse buttons", () => {
    expect(getKeyDisplayName("MouseLeft")).toBe("Left Click");
    expect(getKeyDisplayName("MouseMiddle")).toBe("Middle Click");
    expect(getKeyDisplayName("MouseRight")).toBe("Right Click");
  });

  it("maps gamepad buttons", () => {
    expect(getKeyDisplayName("GamepadA")).toBe("A");
    expect(getKeyDisplayName("GamepadLT")).toBe("LT");
    expect(getKeyDisplayName("GamepadLeftStick")).toBe("Left Stick");
    expect(getKeyDisplayName("GamepadDPadUp")).toBe("D-Pad Up");
    expect(getKeyDisplayName("GamepadStart")).toBe("Start");
  });

  it("maps numpad keys", () => {
    expect(getKeyDisplayName("Numpad0")).toBe("Numpad 0");
    expect(getKeyDisplayName("NumpadAdd")).toBe("Numpad +");
    expect(getKeyDisplayName("NumpadEnter")).toBe("Numpad Enter");
  });

  it("maps function keys", () => {
    expect(getKeyDisplayName("F1")).toBe("F1");
    expect(getKeyDisplayName("F12")).toBe("F12");
  });

  it("maps punctuation keys", () => {
    expect(getKeyDisplayName("Backquote")).toBe("`");
    expect(getKeyDisplayName("Semicolon")).toBe(";");
    expect(getKeyDisplayName("Slash")).toBe("/");
  });

  it("returns the code itself for unknown codes", () => {
    expect(getKeyDisplayName("GamepadButtonX")).toBe("GamepadButtonX");
    expect(getKeyDisplayName("CustomKey")).toBe("CustomKey");
  });
});

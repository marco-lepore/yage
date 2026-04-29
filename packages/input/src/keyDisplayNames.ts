const KEY_DISPLAY_NAMES: Record<string, string> = {
  // Letters
  KeyA: "A",
  KeyB: "B",
  KeyC: "C",
  KeyD: "D",
  KeyE: "E",
  KeyF: "F",
  KeyG: "G",
  KeyH: "H",
  KeyI: "I",
  KeyJ: "J",
  KeyK: "K",
  KeyL: "L",
  KeyM: "M",
  KeyN: "N",
  KeyO: "O",
  KeyP: "P",
  KeyQ: "Q",
  KeyR: "R",
  KeyS: "S",
  KeyT: "T",
  KeyU: "U",
  KeyV: "V",
  KeyW: "W",
  KeyX: "X",
  KeyY: "Y",
  KeyZ: "Z",

  // Digits
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",

  // Function keys
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",

  // Modifiers
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  MetaLeft: "Left Meta",
  MetaRight: "Right Meta",

  // Arrows
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",

  // Common keys
  Space: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  CapsLock: "Caps Lock",
  NumLock: "Num Lock",
  ScrollLock: "Scroll Lock",
  PrintScreen: "Print Screen",
  Pause: "Pause",
  ContextMenu: "Menu",

  // Punctuation / symbols
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",

  // Numpad
  Numpad0: "Numpad 0",
  Numpad1: "Numpad 1",
  Numpad2: "Numpad 2",
  Numpad3: "Numpad 3",
  Numpad4: "Numpad 4",
  Numpad5: "Numpad 5",
  Numpad6: "Numpad 6",
  Numpad7: "Numpad 7",
  Numpad8: "Numpad 8",
  Numpad9: "Numpad 9",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
  NumpadMultiply: "Numpad *",
  NumpadDivide: "Numpad /",
  NumpadDecimal: "Numpad .",
  NumpadEnter: "Numpad Enter",

  // Mouse buttons (synthetic codes from InputPlugin)
  MouseLeft: "Left Click",
  MouseMiddle: "Middle Click",
  MouseRight: "Right Click",

  // Gamepad buttons (synthetic codes from InputPollSystem; standard mapping)
  GamepadA: "A",
  GamepadB: "B",
  GamepadX: "X",
  GamepadY: "Y",
  GamepadLB: "LB",
  GamepadRB: "RB",
  GamepadLT: "LT",
  GamepadRT: "RT",
  GamepadSelect: "Select",
  GamepadStart: "Start",
  GamepadLeftStick: "Left Stick",
  GamepadRightStick: "Right Stick",
  GamepadDPadUp: "D-Pad Up",
  GamepadDPadDown: "D-Pad Down",
  GamepadDPadLeft: "D-Pad Left",
  GamepadDPadRight: "D-Pad Right",
  GamepadHome: "Home",
};

const GAMEPAD_BUTTON_FALLBACK = /^GamepadButton(\d+)$/;

/** Returns a human-readable display name for a `KeyboardEvent.code` or mouse key string. */
export function getKeyDisplayName(code: string): string {
  const direct = KEY_DISPLAY_NAMES[code];
  if (direct !== undefined) return direct;
  const fallback = GAMEPAD_BUTTON_FALLBACK.exec(code);
  if (fallback) return `Gamepad Button ${fallback[1]}`;
  return code;
}

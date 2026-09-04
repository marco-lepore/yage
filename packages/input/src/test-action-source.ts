import type { InputManager } from "./InputManager.js";
import type { InputActionSource } from "./types.js";

const sources = new WeakMap<InputManager, InputActionSource>();

export function setTestActionHeld(
  input: InputManager,
  action: string,
  held: boolean,
): void {
  let source = sources.get(input);
  if (!source) {
    source = input.createActionSource();
    sources.set(input, source);
  }
  source.setHeld(action, held);
}

import { describe, expect, it } from "vitest";
import { InputManager } from "@yagejs/input";
import type { UIFocusInputSource } from "./UIFocusScope.js";

/**
 * `UIFocusInputSource` is declared structurally so `@yagejs/ui` names no type
 * from `@yagejs/input`. The alias fails to compile when a signature drifts
 * (`tsconfig.contract.json` compiles this file), and the tests drive a real
 * manager through the contract type.
 */
type PinnedToInputManager<T extends UIFocusInputSource> = T;
type Pinned = PinnedToInputManager<InputManager>;

/** A manager with one action bound to one key, read through the contract. */
function bound(): { manager: Pinned; source: UIFocusInputSource } {
  const manager: Pinned = new InputManager();
  manager.setActionMap({ confirm: ["Space"] });
  return { manager, source: manager };
}

describe("UIFocusInputSource", () => {
  it("is answered by the input package's manager", () => {
    const { manager, source } = bound();

    expect(source.hasAction("confirm")).toBe(true);
    expect(source.hasAction("unbound")).toBe(false);
    expect(source.isPressed("confirm")).toBe(false);

    manager.fireKeyDown("Space");
    expect(source.isPressed("confirm")).toBe(true);
    expect(source.isJustPressed("confirm")).toBe(true);
    expect(source.isJustPressed("confirm", { repeat: true })).toBe(true);

    manager._clearFrameState();
    manager.fireKeyUp("Space");
    expect(source.isPressed("confirm")).toBe(false);
    expect(source.isJustReleasedByPlayer("confirm")).toBe(true);
  });

  it("reports no player release for held state the engine dropped", () => {
    const { manager, source } = bound();

    manager.fireKeyDown("Space");
    manager._clearFrameState();
    // The window losing focus: every held key goes while the player holds it.
    manager._releaseAllPhysicalState();

    expect(source.isPressed("confirm")).toBe(false);
    expect(source.isJustReleasedByPlayer("confirm")).toBe(false);
  });
});

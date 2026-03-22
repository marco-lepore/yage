import { describe, it, expect, vi, beforeEach } from "vitest";
import { EngineContext } from "@yage/core";
import { InputClearSystem } from "./InputClearSystem.js";
import { InputManager } from "./InputManager.js";
import { InputManagerKey } from "./types.js";

describe("InputClearSystem", () => {
  let system: InputClearSystem;
  let manager: InputManager;

  beforeEach(() => {
    const context = new EngineContext();
    manager = new InputManager();
    context.register(InputManagerKey, manager);

    system = new InputClearSystem();
    system._setContext(context);
  });

  it("has endOfFrame phase with priority 9000", () => {
    expect(system.phase).toBe("endOfFrame");
    expect(system.priority).toBe(9000);
  });

  it("clears frame state on update", () => {
    const spy = vi.spyOn(manager, "_clearFrameState");
    system.update();
    expect(spy).toHaveBeenCalled();
  });
});

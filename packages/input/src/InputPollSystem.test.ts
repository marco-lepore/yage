import { describe, it, expect, vi, beforeEach } from "vitest";
import { EngineContext } from "@yagejs/core";
import { InputPollSystem } from "./InputPollSystem.js";
import { InputManager } from "./InputManager.js";
import { InputManagerKey } from "./types.js";

describe("InputPollSystem", () => {
  let system: InputPollSystem;
  let manager: InputManager;

  beforeEach(() => {
    const context = new EngineContext();
    manager = new InputManager();
    context.register(InputManagerKey, manager);

    system = new InputPollSystem();
    system._setContext(context);
  });

  it("has earlyUpdate phase with priority -100", () => {
    expect(system.phase).toBe("earlyUpdate");
    expect(system.priority).toBe(-100);
  });

  it("advances input elapsed time on update", () => {
    const spy = vi.spyOn(manager, "_advanceTime");
    system.update(16);
    expect(spy).toHaveBeenCalledWith(16);
  });
});

import { System, Phase } from "@yage/core";
import { InputManagerKey } from "./types.js";

/**
 * Runs at the start of each frame (EarlyUpdate, priority -100).
 * Advances the input elapsed clock. Gamepad polling will be added here later.
 */
export class InputPollSystem extends System {
  readonly phase = Phase.EarlyUpdate;
  readonly priority = -100;

  update(dt: number): void {
    this.use(InputManagerKey)._advanceTime(dt);
  }
}

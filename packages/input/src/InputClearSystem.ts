import { System, Phase } from "@yage/core";
import { InputManagerKey } from "./types.js";

/**
 * Runs at the end of each frame (EndOfFrame, priority 9000).
 * Clears per-frame justPressed/justReleased flags.
 */
export class InputClearSystem extends System {
  readonly phase = Phase.EndOfFrame;
  readonly priority = 9000;

  update(): void {
    this.use(InputManagerKey)._clearFrameState();
  }
}

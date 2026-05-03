import { System, Phase } from "@yagejs/core";
import { InputManagerKey } from "./types.js";

/**
 * Runs at the start of each frame (EarlyUpdate, priority -100).
 * Drains DOM-buffered input events (so action-map edges land before any
 * gameplay system reads them), advances the input elapsed clock, and polls
 * connected gamepads — emitting key-down/key-up edges through the manager so
 * action queries, hold-duration, and `listenForNextKey` all work uniformly
 * across keyboard and gamepad.
 */
export class InputPollSystem extends System {
  readonly phase = Phase.EarlyUpdate;
  readonly priority = -100;

  update(dt: number): void {
    const manager = this.use(InputManagerKey);
    manager._drainInputQueue();
    manager._advanceTime(dt);
    if (manager.isPollingEnabled()) {
      manager._pollGamepads();
    }
  }
}

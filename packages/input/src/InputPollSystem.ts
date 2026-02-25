import { System, Phase } from "@yage/core";

/**
 * Runs at the start of each frame (EarlyUpdate, priority -100).
 * Currently a no-op — keyboard/mouse state is event-driven.
 * Gamepad polling will be added here in a future version.
 */
export class InputPollSystem extends System {
  readonly phase = Phase.EarlyUpdate;
  readonly priority = -100;

  update(_dt: number): void {
    // Gamepad polling will go here.
  }
}

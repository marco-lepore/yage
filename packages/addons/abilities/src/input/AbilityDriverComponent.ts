import { Component } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { Abilities } from "../core/Abilities.js";
import { AbilityDriver } from "./AbilityDriver.js";
import type { AbilityDriverOptions } from "./AbilityDriver.js";

/**
 * Component-owned input driver for the common mounted lifecycle.
 *
 * Add it after the sibling `Abilities` component. It resolves the scene's
 * `InputManager`, updates the plain driver each frame, and disposes input
 * listeners and buffered interactions when removed.
 *
 * Input is sampled once per rendered frame — the frame is where new input
 * arrives, so per-frame polling forwards an intent on the frame its edge
 * lands, independent of how many fixed steps that frame runs. With the
 * sibling `Abilities` on the `"fixed"` clock (the default), an intent sent
 * this frame starts a timeline that then advances on the fixed step.
 */
export class AbilityDriverComponent<
  TAction extends string = string,
  TIntent extends string = string,
> extends Component {
  private options: AbilityDriverOptions<TAction, TIntent>;
  private driver: AbilityDriver<TAction, TIntent> | null = null;
  private mounted = false;

  constructor(options: AbilityDriverOptions<TAction, TIntent>) {
    super();
    this.options = options;
  }

  override onAdd(): void {
    this.mounted = true;
  }

  override onEnable(): void {
    this.mountDriver();
  }

  override onDisable(): void {
    this.driver?.dispose();
    this.driver = null;
  }

  override update(): void {
    this.driver?.update();
  }

  /** Replace the input bindings without replacing the component or abilities. */
  replace(options: AbilityDriverOptions<TAction, TIntent>): void {
    this.options = options;
    if (!this.mounted || !this.effectiveEnabled) return;
    this.driver?.dispose();
    this.driver = null;
    this.mountDriver();
  }

  override onDestroy(): void {
    this.mounted = false;
    this.onDisable();
  }

  private mountDriver(): void {
    this.driver = new AbilityDriver(
      this.use(InputManagerKey),
      this.entity.get(Abilities),
      this.options,
    );
  }
}

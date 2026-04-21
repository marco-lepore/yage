import { ServiceKey } from "@yagejs/core";
import type { EngineContext, Plugin, SystemScheduler } from "@yagejs/core";
import { UIRootLayoutSystem } from "./UIRootLayoutSystem.js";

/**
 * Marker service key used by `UIRoot` to fail fast when `UIReactPlugin`
 * hasn't been registered — without it, `UIRoot` mounts but its per-frame
 * layout never runs, leaving a stationary UI with no error.
 */
export const UIReactPluginKey = new ServiceKey<UIReactPlugin>("ui-react");

/**
 * Registers `UIRootLayoutSystem` so `UIRoot` layouts run in `LateUpdate`,
 * after Update-phase Transform writers like `ScreenFollow`. Required
 * alongside `UIPlugin` for `@yagejs/ui-react`.
 */
export class UIReactPlugin implements Plugin {
  readonly name = "ui-react";
  readonly version = "0.1.0";
  readonly dependencies = ["ui"];

  install(context: EngineContext): void {
    context.register(UIReactPluginKey, this);
  }

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UIRootLayoutSystem());
  }
}

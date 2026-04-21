import type { Plugin, SystemScheduler } from "@yagejs/core";
import { UIRootLayoutSystem } from "./UIRootLayoutSystem.js";

/**
 * Registers `UIRootLayoutSystem` so `UIRoot` layouts run in `LateUpdate`,
 * after Update-phase Transform writers like `ScreenFollow`. Required
 * alongside `UIPlugin` for `@yagejs/ui-react`.
 */
export class UIReactPlugin implements Plugin {
  readonly name = "ui-react";
  readonly version = "0.1.0";
  readonly dependencies = ["ui"];

  registerSystems(scheduler: SystemScheduler): void {
    scheduler.add(new UIRootLayoutSystem());
  }
}

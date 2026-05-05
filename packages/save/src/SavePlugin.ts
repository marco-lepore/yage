import type { EngineContext, Plugin } from "@yagejs/core";
import type { Save } from "./Save.js";
import { SaveServiceKey } from "./keys.js";

export interface SavePluginOptions {
  /**
   * Save instance to register. Constructed in user code (typically in `main.ts`)
   * so it's also available before the engine starts — for restoring settings,
   * loading a save slot, or other boot-time work.
   */
  save: Save;
}

/**
 * Registers a Save instance under `SaveServiceKey` so components can resolve it
 * via `this.use(SaveServiceKey)` for in-game persistence.
 */
export class SavePlugin implements Plugin {
  readonly name = "save";
  readonly version = "1.0.0";

  private readonly options: SavePluginOptions;

  constructor(options: SavePluginOptions) {
    this.options = options;
  }

  install(context: EngineContext): void {
    context.register(SaveServiceKey, this.options.save);
  }
}

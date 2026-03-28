import type { EngineContext, Plugin } from "@yage/core";
import type { SaveStorage } from "./types.js";
import { LocalStorageSaveStorage } from "./LocalStorageAdapter.js";
import { SaveService } from "./SaveService.js";
import { SaveServiceKey } from "./keys.js";

/** Options for the SavePlugin. */
export interface SavePluginOptions {
  /** Custom storage backend. Defaults to LocalStorageSaveStorage. */
  storage?: SaveStorage;
  /** Namespace for stored keys. Defaults to "yage". */
  namespace?: string;
}

/** Plugin that registers SaveService into the engine context. */
export class SavePlugin implements Plugin {
  readonly name = "save";
  readonly version = "1.0.0";

  private readonly options: SavePluginOptions;

  constructor(options?: SavePluginOptions) {
    this.options = options ?? {};
  }

  install(context: EngineContext): void {
    const storage = this.options.storage ?? new LocalStorageSaveStorage();
    const service = new SaveService(storage, context, this.options.namespace);

    context.register(SaveServiceKey, service);
  }
}

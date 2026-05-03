import type { EngineContext, Plugin } from "@yagejs/core";
import type { SnapshotStorage } from "./types.js";
import { LocalStorageSnapshotStorage } from "./LocalStorageSnapshotStorage.js";
import { SnapshotService } from "./SnapshotService.js";
import { SnapshotServiceKey } from "./keys.js";

/** Options for the SnapshotPlugin. */
export interface SnapshotPluginOptions {
  /** Custom storage backend. Defaults to LocalStorageSnapshotStorage. */
  storage?: SnapshotStorage;
  /** Namespace for stored keys. Defaults to "yage". */
  namespace?: string;
}

/** Plugin that registers SnapshotService into the engine context. */
export class SnapshotPlugin implements Plugin {
  readonly name = "snapshot";
  readonly version = "1.0.0";

  private readonly options: SnapshotPluginOptions;

  constructor(options?: SnapshotPluginOptions) {
    this.options = options ?? {};
  }

  install(context: EngineContext): void {
    const storage = this.options.storage ?? new LocalStorageSnapshotStorage();
    const service = new SnapshotService(storage, context, this.options.namespace);

    context.register(SnapshotServiceKey, service);
  }
}

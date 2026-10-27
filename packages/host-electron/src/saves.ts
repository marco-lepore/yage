import type { SaveAdapter } from "@yagejs/save";
import { requireHostBridge } from "./bridge.js";

/**
 * Saves written as files in the app's data directory by the main process.
 * The write algorithm runs there, so a renderer that crashes during a save
 * does not stop the write.
 * @experimental
 */
export function electronSaveAdapter(): SaveAdapter {
  const bridge = requireHostBridge("electronSaveAdapter", "adapter");
  return {
    read: (key) => bridge.saves.read(key),
    write: (key, value) => bridge.saves.write(key, value),
    delete: (key) => bridge.saves.delete(key),
    list: (prefix) => bridge.saves.list(prefix),
  };
}

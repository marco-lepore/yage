import { fileAdapter } from "@yagejs/save";
import type { SaveAdapter } from "@yagejs/save";
import { capacitorFileStore } from "./fileStore.js";
import { requireCapacitorShell, requirePlugin } from "./shell.js";

/** What a file name may hold, so one profile's saves stay one directory. */
const PROFILE = /^[a-z][a-z0-9-]*$/;

export interface CapacitorSaveAdapterOptions {
  /** The build profile, such as "test" or "release". Test and release saves never mix. */
  readonly profile: string;
}

/**
 * Saves written as files in the app's private Library directory. A write
 * that resolved is held when the app is killed; neither system's write
 * reaches the storage hardware, so a power loss is not guaranteed.
 */
export function capacitorSaveAdapter(
  options: CapacitorSaveAdapterOptions,
): SaveAdapter {
  requireCapacitorShell("capacitorSaveAdapter", "adapter");
  requirePlugin("capacitorSaveAdapter", "Filesystem", "@capacitor/filesystem");
  const { profile } = options;
  if (!PROFILE.test(profile)) {
    throw new Error(
      `capacitorSaveAdapter: profile must match ${PROFILE.source}, ` +
        `got ${JSON.stringify(profile)}.`,
    );
  }
  return fileAdapter({ store: capacitorFileStore(`yage-saves/${profile}`) });
}

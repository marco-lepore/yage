import { Capacitor } from "@capacitor/core";
import { fileAdapter } from "@yagejs/save";
import type { SaveAdapter } from "@yagejs/save";
import { capacitorFileStore } from "./fileStore.js";
import { requireCapacitorShell, requirePlugin } from "./shell.js";

/** What a file name may hold, so one profile's saves stay one directory. */
const PROFILE = /^[a-z][a-z0-9-]*$/;

export interface CapacitorSaveAdapterOptions {
  /**
   * The build profile, such as "development" or "release". Each profile has
   * its own save directory. Defaults to "development" when `Capacitor.DEBUG`
   * is true and to "release" otherwise. On a device the app sets it in an
   * iOS Debug build and a debuggable Android build; the iOS simulator sets
   * it in every build.
   */
  readonly profile?: string;
}

/**
 * Saves written as files in the app's private Library directory. A write
 * that resolved is held when the app is killed; neither system's write
 * reaches the storage hardware, so the same write is not guaranteed to
 * survive a power loss.
 */
export function capacitorSaveAdapter(
  options: CapacitorSaveAdapterOptions = {},
): SaveAdapter {
  requireCapacitorShell("capacitorSaveAdapter", "adapter");
  requirePlugin("capacitorSaveAdapter", "Filesystem", "@capacitor/filesystem");
  const profile =
    options.profile ?? (Capacitor.DEBUG === true ? "development" : "release");
  if (!PROFILE.test(profile)) {
    throw new Error(
      `capacitorSaveAdapter: profile must match ${PROFILE.source}, ` +
        `got ${JSON.stringify(profile)}.`,
    );
  }
  return fileAdapter({ store: capacitorFileStore(`yage-saves/${profile}`) });
}

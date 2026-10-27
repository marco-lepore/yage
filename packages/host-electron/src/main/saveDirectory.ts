import { app } from "electron";
import { join } from "node:path";

const APP_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const PROFILE = /^[a-z][a-z0-9-]*$/;

/** Which app's saves, and which build's. */
export interface SaveDirectoryOptions {
  /** The app's stable identifier, the same in every release. */
  readonly appId: string;
  /** The build profile, such as `"test"` or `"release"`. */
  readonly profile: string;
}

/** The app identifier check, shared with the shell's own option check. */
export function checkAppId(prefix: string, value: string): void {
  if (typeof value !== "string" || !APP_ID.test(value)) {
    throw new Error(
      `${prefix}: appId must match ${APP_ID.source}, got ${JSON.stringify(value)}.`,
    );
  }
}

/** The profile check, shared with the shell's own option check. */
export function checkProfile(prefix: string, value: string): void {
  if (typeof value !== "string" || !PROFILE.test(value)) {
    throw new Error(
      `${prefix}: profile must match ${PROFILE.source}, got ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * Where one app's saves live: the system's application-data directory, the
 * app's own identifier, then the profile. The identifier is the shell's, not
 * the app's display name, so renaming the app leaves the saves where they
 * are.
 */
export function saveDirectory(options: SaveDirectoryOptions): string {
  checkAppId("saveDirectory", options.appId);
  checkProfile("saveDirectory", options.profile);
  return join(app.getPath("appData"), options.appId, "saves", options.profile);
}

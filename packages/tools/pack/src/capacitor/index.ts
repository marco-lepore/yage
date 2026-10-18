import type { CapacitorConfig } from "@capacitor/cli";
import { readIdentity, WEB_DIRS } from "../project.js";

/** The settings this configuration owns, which an override cannot replace. */
const OWNED_KEYS = ["appId", "appName", "webDir"] as const;

/**
 * A Capacitor configuration for a YAGE game: export it from
 * `capacitor.config.ts`.
 *
 * The app's identity comes from the game's `package.json`, so a desktop and a
 * mobile build never disagree about it, and the two settings the mobile
 * adapter depends on are set here. Everything else passes through.
 */
export function capacitorConfig(
  overrides: CapacitorConfig = {},
): CapacitorConfig {
  // The Capacitor CLI loads this file from the directory it runs in, which is
  // the game's root.
  const identity = readIdentity(process.cwd(), "capacitorConfig");
  for (const key of OWNED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      throw new Error(
        `capacitorConfig: ${key} comes from package.json and the ${WEB_DIRS.capacitor} convention; remove it from the overrides.`,
      );
    }
  }
  const contentInset = overrides.ios?.contentInset;
  if (contentInset !== undefined && contentInset !== "never") {
    throw new Error(
      `capacitorConfig: ios.contentInset must stay "never": the page's CSS pads for the safe areas, got ${JSON.stringify(contentInset)}.`,
    );
  }
  if (overrides.plugins?.App?.disableBackButtonHandler === true) {
    throw new Error(
      "capacitorConfig: plugins.App.disableBackButtonHandler must stay unset: with it the Back button never reaches the game.",
    );
  }
  return {
    ...overrides,
    appId: identity.appId,
    appName: identity.name,
    webDir: WEB_DIRS.capacitor,
    ios: { ...overrides.ios, contentInset: "never" },
  };
}

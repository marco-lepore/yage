import { Capacitor } from "@capacitor/core";
import { isCapacitorHost } from "./detect.js";

/** Stop a browser page from reaching code that only a native app answers. */
export function requireCapacitorShell(
  prefix: string,
  subject: "plugin" | "adapter",
): void {
  if (isCapacitorHost()) return;
  throw new Error(
    `${prefix}: this page is not running inside a Capacitor app. ` +
      `Leave this ${subject} out of a browser build.`,
  );
}

/**
 * Stop a call to a plugin whose native half the app does not carry. A plugin
 * reaches the app only when the app's own manifest lists its package, so the
 * message names the package to add.
 */
export function requirePlugin(
  prefix: string,
  pluginName: "App" | "ScreenOrientation" | "Filesystem",
  packageName: string,
): void {
  if (Capacitor.isPluginAvailable(pluginName)) return;
  throw new Error(
    `${prefix}: the ${packageName} plugin is not in this app. ` +
      `Add "${packageName}" to the app's package.json dependencies ` +
      `and run npx cap sync.`,
  );
}

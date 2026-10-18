import type { HostLifecycleReport } from "@yagejs/core";

/** A Capacitor platform this adapter runs on. */
export type CapacitorPlatform = "ios" | "android";

/** One event of the App plugin, as the native side sent it. */
export type AppEvent =
  | { readonly name: "appStateChange"; readonly isActive: unknown }
  | { readonly name: "pause" }
  | { readonly name: "resume" };

/**
 * What one native event says about the app's state. The two systems send the
 * same three events for different transitions: on iOS `appStateChange`
 * follows the app losing and regaining interaction while its window is still
 * on screen, and `pause` and `resume` follow the window leaving and coming
 * back; on Android `pause` and `resume` follow the activity, and
 * `appStateChange` follows the activity being stopped and started.
 */
export function reportFor(
  platform: CapacitorPlatform,
  event: AppEvent,
): HostLifecycleReport {
  if (event.name === "pause") {
    return platform === "ios"
      ? { visibility: "hidden" }
      : { activity: "inactive" };
  }
  if (event.name === "resume") {
    return platform === "ios"
      ? { visibility: "visible" }
      : { activity: "active", visibility: "visible" };
  }
  const isActive = readIsActive(event.isActive);
  if (platform === "ios") {
    return { activity: isActive ? "active" : "inactive" };
  }
  return isActive
    ? { activity: "active", visibility: "visible" }
    : { visibility: "hidden" };
}

/** The payload comes from the native bridge, so its one field is checked. */
function readIsActive(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(
      `CapacitorHostPlugin: appStateChange reported isActive ` +
        `${JSON.stringify(value)}, expected a boolean.`,
    );
  }
  return value;
}

import { ScreenOrientation } from "@capacitor/screen-orientation";
import type {
  HostDisplay,
  HostFullscreen,
  HostOrientation,
  OrientationLock,
} from "@yagejs/renderer/api";
import type { CapacitorPlatform } from "./lifecycle.js";

/** How long a lock may take to turn the screen before it settles. */
export const ORIENTATION_SETTLE_MS = 2000;

/** The display this adapter registers, with the one call the plugin makes. */
export interface CapacitorDisplay extends HostDisplay {
  /** Settle every pending lock at once. Called when the engine is destroyed. */
  settleAll(): void;
}

/** The page's screen, or `undefined` where the page has none. */
function screenOf(): Screen | undefined {
  return (globalThis as { screen?: Screen }).screen;
}

/** Whether the screen now reads as the orientation a lock asked for. */
function matches(
  current: OrientationType | null,
  lock: OrientationLock,
): boolean {
  if (current === null) return false;
  if (lock === "portrait" || lock === "landscape") {
    return current.startsWith(lock);
  }
  return current === lock;
}

/**
 * The display of a Capacitor app: the orientation lock the app can perform,
 * read back from the page's own screen, and fullscreen where the app's web
 * view cannot present it.
 */
export function createDisplay(platform: CapacitorPlatform): CapacitorDisplay {
  /** Every lock waiting for the screen to turn. */
  const waiting = new Set<() => void>();

  const read = (): OrientationType | null =>
    screenOf()?.orientation?.type ?? null;

  /**
   * Wait until the screen reads as the lock asked. The app accepts a lock
   * before the screen turns, and a lock the system cannot perform turns
   * nothing at all, so the wait ends at the bound either way.
   */
  const settle = (lock: OrientationLock): Promise<void> => {
    if (matches(read(), lock)) return Promise.resolve();
    const orientation = screenOf()?.orientation;
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        orientation?.removeEventListener("change", onChange);
        waiting.delete(finish);
        resolve();
      };
      const onChange = (): void => {
        if (matches(read(), lock)) finish();
      };
      const timer = setTimeout(finish, ORIENTATION_SETTLE_MS);
      orientation?.addEventListener("change", onChange);
      waiting.add(finish);
    });
  };

  const orientation: HostOrientation = {
    get current(): OrientationType | null {
      return read();
    },
    lockSupport: "supported",
    async lock(lock: OrientationLock): Promise<void> {
      await ScreenOrientation.lock({ orientation: lock });
      await settle(lock);
    },
    unlock(): Promise<void> {
      return ScreenOrientation.unlock();
    },
  };

  // An Android web view leaves element fullscreen in the same call that
  // enters it, so a request changes nothing the player sees.
  const fullscreen: HostFullscreen = {
    support: "unsupported",
    active: false,
    request(): Promise<void> {
      return Promise.reject(
        new Error(
          "CapacitorHostPlugin: an Android web view in a Capacitor app " +
            "cannot present the game fullscreen.",
        ),
      );
    },
    exit(): Promise<void> {
      return Promise.resolve();
    },
  };

  return {
    orientation,
    // On iOS the web view presents an element fullscreen, so fullscreen
    // stays with the page.
    ...(platform === "android" ? { fullscreen } : {}),
    watch(report: () => void): () => void {
      const screenOrientation = screenOf()?.orientation;
      screenOrientation?.addEventListener("change", report);
      return () => {
        screenOrientation?.removeEventListener("change", report);
      };
    },
    settleAll(): void {
      for (const finish of [...waiting]) finish();
    },
  };
}

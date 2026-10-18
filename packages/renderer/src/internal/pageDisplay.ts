import type { HostSupport } from "@yagejs/core";
import type {
  HostFullscreen,
  HostOrientation,
  OrientationLock,
} from "../HostDisplay.js";

/** A display part read from the page, plus the listeners that report its changes. */
export interface PagePart<T> {
  readonly part: T;
  /** Calls `changed` on every page event that can move the part's state. */
  watch(changed: () => void): () => void;
}

type WebkitElement = Element & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

type WebkitDocument = Document & {
  webkitExitFullscreen?: () => void | Promise<void>;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
};

/**
 * The orientation lock. TypeScript's DOM library declares `ScreenOrientation`
 * without `lock`, which every browser that supports locking implements.
 */
type LockableOrientation = ScreenOrientation & {
  lock(lock: OrientationLock): Promise<void>;
};

/** The element the page reports as fullscreen, through either spelling. */
function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Fullscreen through the page's Fullscreen API, targeting the element the
 * canvas sits in. Prefers the unprefixed methods and falls back to the
 * `webkit*` variants, which Safari on iPad before 16.4 is limited to.
 */
export function createPageFullscreen(
  target: HTMLElement,
): PagePart<HostFullscreen> {
  const part: HostFullscreen = {
    get support(): HostSupport {
      if (typeof document === "undefined") return "unsupported";
      const webkitTarget = target as WebkitElement;
      const hasRequest =
        "requestFullscreen" in target ||
        typeof webkitTarget.webkitRequestFullscreen === "function";
      if (!hasRequest) return "unsupported";
      const doc = document as WebkitDocument;
      if (
        doc.fullscreenEnabled !== true &&
        doc.webkitFullscreenEnabled !== true
      ) {
        return "unsupported";
      }
      // An app that opens fullscreen is already presented that way, so a
      // request changes nothing the player sees. The media query also matches
      // while an element is fullscreen, which is why this asks only while no
      // element is.
      if (
        fullscreenElement() === null &&
        typeof matchMedia !== "undefined" &&
        matchMedia("(display-mode: fullscreen)").matches
      ) {
        return "unsupported";
      }
      return "supported";
    },
    get active(): boolean {
      if (typeof document === "undefined") return false;
      return fullscreenElement() === target;
    },
    request(): Promise<void> {
      if ("requestFullscreen" in target) {
        return Promise.resolve(target.requestFullscreen());
      }
      const webkitTarget = target as WebkitElement;
      return new Promise<void>((resolve, reject) => {
        // The prefixed method returns nothing, so the page's own events are
        // the only report of the outcome.
        const onChange = (): void => {
          detach();
          resolve();
        };
        const onError = (): void => {
          detach();
          reject(
            new Error(
              "RendererPlugin.requestFullscreen: the browser refused fullscreen.",
            ),
          );
        };
        const detach = (): void => {
          document.removeEventListener("webkitfullscreenchange", onChange);
          document.removeEventListener("webkitfullscreenerror", onError);
        };
        document.addEventListener("webkitfullscreenchange", onChange);
        document.addEventListener("webkitfullscreenerror", onError);
        void webkitTarget.webkitRequestFullscreen?.();
      });
    },
    exit(): Promise<void> {
      if (typeof document.exitFullscreen === "function") {
        return Promise.resolve(document.exitFullscreen());
      }
      const doc = document as WebkitDocument;
      return new Promise<void>((resolve) => {
        const onChange = (): void => {
          document.removeEventListener("webkitfullscreenchange", onChange);
          resolve();
        };
        document.addEventListener("webkitfullscreenchange", onChange);
        void doc.webkitExitFullscreen?.();
      });
    },
  };

  return {
    part,
    watch(changed: () => void): () => void {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("fullscreenchange", changed);
      document.addEventListener("webkitfullscreenchange", changed);
      return () => {
        document.removeEventListener("fullscreenchange", changed);
        document.removeEventListener("webkitfullscreenchange", changed);
      };
    },
  };
}

/**
 * Screen orientation through the page's Screen Orientation API, with the
 * legacy `window.orientation` angle as the fallback on older Safari.
 */
export function createPageOrientation(): PagePart<HostOrientation> {
  const part: HostOrientation = {
    get current(): OrientationType | null {
      return deriveOrientationType();
    },
    get lockSupport(): HostSupport {
      if (typeof window === "undefined") return "unsupported";
      const orientation = window.screen?.orientation as
        | Partial<LockableOrientation>
        | undefined;
      if (!orientation || typeof orientation.lock !== "function") {
        return "unsupported";
      }
      // Whether this device accepts a lock shows only in the attempt: a
      // desktop browser refuses one the method is there for.
      return "unknown";
    },
    lock(lock: OrientationLock): Promise<void> {
      const orientation = window.screen.orientation as LockableOrientation;
      return orientation.lock(lock);
    },
    unlock(): Promise<void> {
      window.screen?.orientation?.unlock();
      return Promise.resolve();
    },
  };

  return {
    part,
    watch(changed: () => void): () => void {
      if (typeof window === "undefined") return () => {};
      const orientation = window.screen?.orientation;
      if (orientation && typeof orientation.addEventListener === "function") {
        orientation.addEventListener("change", changed);
        return () => {
          orientation.removeEventListener("change", changed);
        };
      }
      window.addEventListener("orientationchange", changed);
      return () => {
        window.removeEventListener("orientationchange", changed);
      };
    },
  };
}

/**
 * Prefers `window.screen.orientation.type` and falls back to the legacy
 * numeric `window.orientation` angle, the only signal on some old iOS Safari
 * versions. `null` where neither is available.
 */
function deriveOrientationType(): OrientationType | null {
  if (typeof window === "undefined") return null;
  const modern = window.screen?.orientation?.type;
  if (modern) return modern;
  const legacyAngle =
    (window as Window & { orientation?: number }).orientation ?? null;
  if (legacyAngle === null) return null;
  if (legacyAngle === 0) return "portrait-primary";
  if (legacyAngle === 180) return "portrait-secondary";
  if (legacyAngle === 90) return "landscape-primary";
  if (legacyAngle === -90 || legacyAngle === 270) return "landscape-secondary";
  return null;
}

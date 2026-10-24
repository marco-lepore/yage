import { ServiceKey } from "@yagejs/core";
import type { HostSupport } from "@yagejs/core";

/** An orientation the screen can be locked to. */
export type OrientationLock =
  | "portrait"
  | "landscape"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

/** Fullscreen as a host supplies it. */
export interface HostFullscreen {
  /** Whether a request can change how the game is presented. Read on every access. */
  readonly support: HostSupport;
  /** Whether the game is presented fullscreen. Read on every access. */
  readonly active: boolean;
  /** Resolves once `active` reads `true`. Rejects when the host refuses. */
  request(): Promise<void>;
  /** Resolves once `active` reads `false`. */
  exit(): Promise<void>;
}

/** Screen orientation as a host supplies it. */
export interface HostOrientation {
  /** The current orientation, or `null` when the host cannot read it. Read on every access. */
  readonly current: OrientationType | null;
  /** Whether the host can lock the orientation. Read on every access. */
  readonly lockSupport: HostSupport;
  /** Resolves once the host accepted the lock. Rejects when it refuses. */
  lock(lock: OrientationLock): Promise<void>;
  /** Releases a lock. */
  unlock(): Promise<void>;
}

/**
 * What the application that runs the game supplies for the display. A part
 * left out comes from the page's Fullscreen and Screen Orientation APIs.
 */
export interface HostDisplay {
  readonly fullscreen?: HostFullscreen;
  readonly orientation?: HostOrientation;
  /**
   * Called once by the renderer when the engine starts. Call `changed` after
   * any state a supplied part reports may have changed. Returns the function
   * that stops the calls.
   */
  watch(changed: () => void): () => void;
}

/** A host adapter registers its {@link HostDisplay} here, in its `install`. */
export const HostDisplayKey = new ServiceKey<HostDisplay>("hostDisplay");

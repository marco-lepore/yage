import type { HostSupport } from "@yagejs/core";
import type {
  HostDisplay,
  HostFullscreen,
  HostOrientation,
  OrientationLock,
} from "./HostDisplay.js";

/** The state a {@link TestHostDisplay} reports. */
export interface TestHostDisplayState {
  readonly fullscreenSupport?: HostSupport;
  readonly fullscreen?: boolean;
  readonly orientation?: OrientationType | null;
  readonly orientationLockSupport?: HostSupport;
}

/** The same four fields, as the display keeps them. */
interface MutableDisplayState {
  fullscreenSupport: HostSupport;
  fullscreen: boolean;
  orientation: OrientationType | null;
  orientationLockSupport: HostSupport;
}

/**
 * A host display for tests, with both parts. Register it before
 * `engine.start()`: `engine.context.register(HostDisplayKey, display)`.
 * Defaults: fullscreen supported and off, `"landscape-primary"`, lock
 * supported.
 */
export class TestHostDisplay implements HostDisplay {
  readonly fullscreen: HostFullscreen;
  readonly orientation: HostOrientation;

  private readonly state: MutableDisplayState = {
    fullscreenSupport: "supported",
    fullscreen: false,
    orientation: "landscape-primary",
    orientationLockSupport: "supported",
  };
  private readonly recorded: string[] = [];
  private changed: (() => void) | undefined;

  constructor(state?: TestHostDisplayState) {
    // The parts read this object, so each one answers with the state the test
    // last set rather than a copy taken at construction.
    const current = this.state;
    const record = (call: string): void => {
      this.recorded.push(call);
    };
    this.fullscreen = {
      get support(): HostSupport {
        return current.fullscreenSupport;
      },
      get active(): boolean {
        return current.fullscreen;
      },
      request: () => {
        record("request");
        this.set({ fullscreen: true });
        return Promise.resolve();
      },
      exit: () => {
        record("exit");
        this.set({ fullscreen: false });
        return Promise.resolve();
      },
    };
    this.orientation = {
      get current(): OrientationType | null {
        return current.orientation;
      },
      get lockSupport(): HostSupport {
        return current.orientationLockSupport;
      },
      lock: (lock: OrientationLock) => {
        record(`lock:${lock}`);
        this.set({ orientation: resolveLock(lock) });
        return Promise.resolve();
      },
      unlock: () => {
        record("unlock");
        return Promise.resolve();
      },
    };
    if (state) this.set(state);
  }

  /** Each request in order: `"request"`, `"exit"`, `"lock:<lock>"`, `"unlock"`. */
  get calls(): readonly string[] {
    return this.recorded;
  }

  /**
   * Change the state as a host would, and tell the renderer once. Fields left
   * out keep their value.
   */
  set(state: TestHostDisplayState): void {
    if (state.fullscreenSupport !== undefined) {
      this.state.fullscreenSupport = state.fullscreenSupport;
    }
    if (state.fullscreen !== undefined) {
      this.state.fullscreen = state.fullscreen;
    }
    if (state.orientation !== undefined) {
      this.state.orientation = state.orientation;
    }
    if (state.orientationLockSupport !== undefined) {
      this.state.orientationLockSupport = state.orientationLockSupport;
    }
    this.changed?.();
  }

  watch(changed: () => void): () => void {
    this.changed = changed;
    return () => {
      if (this.changed === changed) this.changed = undefined;
    };
  }
}

/** The orientation a lock without a side settles on. */
function resolveLock(lock: OrientationLock): OrientationType {
  if (lock === "portrait") return "portrait-primary";
  if (lock === "landscape") return "landscape-primary";
  return lock;
}

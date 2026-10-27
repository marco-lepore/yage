import { powerMonitor } from "electron";
import type { BrowserWindow } from "electron";
import type { BridgeState } from "../protocol.js";

/**
 * Electron declares one `on` overload per event name, so a name read from a
 * list reaches the event emitter underneath instead.
 */
export interface NamedEmitter {
  on(event: string, handler: () => void): unknown;
  once(event: string, handler: () => void): unknown;
  removeListener(event: string, handler: () => void): unknown;
}

/**
 * What the operating system said about the machine. `observed` stays `false`
 * until one of the four events arrives, because nothing reports whether the
 * screen is locked at launch.
 */
export interface PowerState {
  locked: boolean;
  suspended: boolean;
  observed: boolean;
}

/** The window's lifecycle and fullscreen state, as the bridge sends it. */
export function snapshotOf(
  win: BrowserWindow,
  power: PowerState,
  revision: number,
): BridgeState {
  const inactive = power.locked || power.suspended;
  return {
    revision,
    lifecycle: {
      activity: !power.observed ? "unknown" : inactive ? "inactive" : "active",
      visibility: win.isVisible() && !win.isMinimized() ? "visible" : "hidden",
      focus: win.isFocused() ? "focused" : "unfocused",
    },
    fullscreen: {
      fullscreenable: win.isFullScreenable(),
      active: win.isFullScreen(),
    },
  };
}

/** The window events that can move the state the page reads. */
const WINDOW_EVENTS = [
  "focus",
  "blur",
  "minimize",
  "restore",
  "hide",
  "show",
  "enter-full-screen",
  "leave-full-screen",
] as const;

/** The machine events that can move it, and what each one says. */
const POWER_EVENTS: readonly {
  readonly event: "lock-screen" | "unlock-screen" | "suspend" | "resume";
  readonly apply: (power: PowerState) => void;
}[] = [
  {
    event: "lock-screen",
    apply: (power) => {
      power.locked = true;
    },
  },
  {
    event: "unlock-screen",
    apply: (power) => {
      power.locked = false;
    },
  },
  {
    event: "suspend",
    apply: (power) => {
      power.suspended = true;
    },
  },
  {
    event: "resume",
    apply: (power) => {
      power.suspended = false;
    },
  },
];

/** What a watch gives its caller: the state to send, and how to stop. */
export interface WindowWatch {
  /**
   * The state at this moment, with a revision newer than every snapshot sent
   * before it, so the page applies a reading taken after the last event.
   */
  current(): BridgeState;
  /** Remove every listener. */
  stop(): void;
}

/**
 * Send a snapshot on every window and machine event, until the window closes
 * or the caller stops. Each snapshot carries the next revision, so the page
 * can tell a newer state from an older one that overtook it.
 */
export function watchWindow(
  win: BrowserWindow,
  send: (state: BridgeState) => void,
): WindowWatch {
  const power: PowerState = {
    locked: false,
    suspended: false,
    observed: false,
  };
  let revision = 0;
  const remove: (() => void)[] = [];

  const publish = (): void => {
    if (win.isDestroyed()) return;
    revision += 1;
    send(snapshotOf(win, power, revision));
  };

  const windowEvents = win as unknown as NamedEmitter;
  const powerEvents = powerMonitor as unknown as NamedEmitter;
  for (const event of WINDOW_EVENTS) {
    windowEvents.on(event, publish);
    remove.push(() => windowEvents.removeListener(event, publish));
  }
  for (const { event, apply } of POWER_EVENTS) {
    const handler = (): void => {
      apply(power);
      power.observed = true;
      publish();
    };
    powerEvents.on(event, handler);
    remove.push(() => powerEvents.removeListener(event, handler));
  }

  const stop = (): void => {
    for (const off of remove.splice(0)) off();
  };
  const onClosed = (): void => stop();
  windowEvents.once("closed", onClosed);
  remove.push(() => windowEvents.removeListener("closed", onClosed));

  return {
    current: () => {
      revision += 1;
      return snapshotOf(win, power, revision);
    },
    stop,
  };
}

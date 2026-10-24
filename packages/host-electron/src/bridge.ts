import { HOST_BRIDGE_PROTOCOL } from "./protocol.js";
import type {
  BridgeFullscreenResult,
  BridgeState,
  BridgeStart,
} from "./protocol.js";

/** What the preload script exposes to the page as `window.__yageHost__`. */
export interface HostBridge {
  /** The protocol the shell speaks. */
  readonly protocol: number;
  /** Identity and the window's state at this moment. Read once per engine. */
  start(): Promise<BridgeStart>;
  /** Report every later state of the window. Returns the function that stops. */
  onState(listener: (state: BridgeState) => void): () => void;
  /** Ask the window to enter or leave fullscreen. */
  setFullscreen(active: boolean): Promise<BridgeFullscreenResult>;
  /** The save files the main process keeps for this app. */
  readonly saves: {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix: string): Promise<string[]>;
  };
}

/** Who is asking for the bridge, so the error says what to leave out. */
export type BridgeSubject = "plugin" | "adapter";

/**
 * The shell's bridge. Every page entry of this package calls this first, so a
 * page without a shell, or with a shell of another version, stops with a
 * message that names the fix instead of failing somewhere later.
 */
export function requireHostBridge(
  prefix: string,
  subject: BridgeSubject,
): HostBridge {
  const exposed: unknown = (globalThis as { __yageHost__?: unknown })
    .__yageHost__;
  if (exposed === undefined || exposed === null) {
    throw new Error(
      `${prefix}: no YAGE host bridge on this page. Load the game in a ` +
        "shell that runs the @yagejs/host-electron preload script, or leave " +
        `this ${subject} out of a browser build.`,
    );
  }
  const protocol: unknown = (exposed as { protocol?: unknown }).protocol;
  if (
    typeof protocol !== "number" ||
    !Number.isInteger(protocol) ||
    protocol <= 0
  ) {
    throw new Error(
      `${prefix}: the shell's host bridge reports protocol ` +
        `${JSON.stringify(protocol)}, expected a positive integer.`,
    );
  }
  if (protocol !== HOST_BRIDGE_PROTOCOL) {
    throw new Error(
      `${prefix}: the shell speaks host bridge protocol ${protocol} and this ` +
        `game was built with protocol ${HOST_BRIDGE_PROTOCOL}. Build the ` +
        "shell and the game with the same @yagejs/host-electron version.",
    );
  }
  return exposed as HostBridge;
}

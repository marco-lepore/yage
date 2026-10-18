/**
 * Version of the bridge between the shell and the game page. It goes up by
 * one with any change to an operation name, an argument shape, a result shape
 * or an event payload, so a shell and a game built from different versions
 * refuse each other instead of misreading each other.
 */
export const HOST_BRIDGE_PROTOCOL = 1;

/** The origin the game page is served from. */
export const GAME_ORIGIN = "yage://game";

/** How long a fullscreen change may take before its request settles. */
export const FULLSCREEN_SETTLE_MS = 3000;

/** The channels the preload script and the main process speak over. */
export const CHANNELS = {
  start: "yage:host:start",
  state: "yage:host:state",
  fullscreen: "yage:host:fullscreen",
  savesRead: "yage:saves:read",
  savesWrite: "yage:saves:write",
  savesDelete: "yage:saves:delete",
  savesList: "yage:saves:list",
} as const;

/**
 * The whole state of the window, as the main process sends it. The page keeps
 * the snapshot with the highest `revision`, so an event that overtakes the
 * reply to `start` cannot put back an older state.
 */
export interface BridgeState {
  readonly revision: number;
  readonly lifecycle: {
    readonly activity: "active" | "inactive" | "unknown";
    readonly visibility: "visible" | "hidden";
    readonly focus: "focused" | "unfocused";
  };
  readonly fullscreen: {
    readonly fullscreenable: boolean;
    readonly active: boolean;
  };
}

/** What the page reads once, before it attaches to the engine. */
export interface BridgeStart {
  readonly info: {
    readonly os: "macos" | "windows" | "linux" | "unknown";
    readonly appVersion: string;
    readonly runtimeVersion: string;
  };
  readonly state: BridgeState;
}

/** What a fullscreen request answers: whether it completed, and the state. */
export interface BridgeFullscreenResult {
  readonly done: boolean;
  readonly state: BridgeState;
}

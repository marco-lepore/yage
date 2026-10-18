import { app, ipcMain } from "electron";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { SaveAdapter } from "@yagejs/save";
import { CHANNELS, FULLSCREEN_SETTLE_MS, GAME_ORIGIN } from "../protocol.js";
import type { BridgeFullscreenResult, BridgeStart } from "../protocol.js";
import type { NamedEmitter, WindowWatch } from "./windowState.js";

/** The longest value one key may hold, in UTF-16 code units. */
const MAX_VALUE_LENGTH = 67_108_864;

/**
 * Only the game page may use the host bridge: its window, its main frame and
 * the origin the shell serves it from. Every handler asks first, so a frame
 * the page embedded reaches no native operation.
 */
export function assertGameSender(
  event: IpcMainInvokeEvent,
  win: BrowserWindow,
  channel: string,
): void {
  const frame = event.senderFrame;
  if (
    event.sender === win.webContents &&
    frame !== null &&
    frame === win.webContents.mainFrame &&
    frame.origin === GAME_ORIGIN
  ) {
    return;
  }
  throw new Error(
    `${channel}: only the game page may use the host bridge, got a request ` +
      `from ${JSON.stringify(frame?.url ?? null)}.`,
  );
}

/** What `process.platform` means to a game. */
export function osOf(platform: string): BridgeStart["info"]["os"] {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
}

/** What the identity and fullscreen channels need. */
export interface HostChannelsOptions {
  readonly window: () => BrowserWindow;
  readonly watch: () => WindowWatch;
}

/** Serve the identity, state and fullscreen operations of the bridge. */
export function registerHostChannels(options: HostChannelsOptions): void {
  ipcMain.handle(CHANNELS.start, (event): BridgeStart => {
    const win = options.window();
    assertGameSender(event, win, CHANNELS.start);
    return {
      info: {
        os: osOf(process.platform),
        appVersion: app.getVersion(),
        runtimeVersion: process.versions.electron ?? "unknown",
      },
      state: options.watch().current(),
    };
  });

  ipcMain.handle(
    CHANNELS.fullscreen,
    async (event, active: unknown): Promise<BridgeFullscreenResult> => {
      const win = options.window();
      assertGameSender(event, win, CHANNELS.fullscreen);
      if (typeof active !== "boolean") {
        throw new Error(
          `${CHANNELS.fullscreen}: active must be a boolean, got ${JSON.stringify(active)}.`,
        );
      }
      const done = await setFullscreen(win, active);
      return { done, state: options.watch().current() };
    },
  );
}

/**
 * Ask the window to enter or leave fullscreen and wait for it to arrive. The
 * window reports nothing when the call changes nothing and nothing when the
 * system refuses, so the wait is bounded and answers with what happened.
 */
function setFullscreen(win: BrowserWindow, active: boolean): Promise<boolean> {
  if (win.isFullScreen() === active) return Promise.resolve(true);
  if (active && !win.isFullScreenable()) return Promise.resolve(false);
  const arrived = active ? "enter-full-screen" : "leave-full-screen";
  const events = win as unknown as NamedEmitter;
  return new Promise<boolean>((resolve) => {
    const settle = (done: boolean): void => {
      clearTimeout(timer);
      events.removeListener(arrived, onArrived);
      events.removeListener("closed", onClosed);
      resolve(done);
    };
    const onArrived = (): void => settle(true);
    const onClosed = (): void => settle(false);
    const timer = setTimeout(() => {
      settle(win.isFullScreen() === active);
    }, FULLSCREEN_SETTLE_MS);
    events.once(arrived, onArrived);
    events.once("closed", onClosed);
    win.setFullScreen(active);
  });
}

/** Serve the four save operations of the bridge over one adapter. */
export function registerSaveChannels(
  adapter: SaveAdapter,
  window: () => BrowserWindow,
): void {
  const key = (channel: string, value: unknown): string => {
    if (typeof value !== "string") {
      throw new Error(`${channel}: key must be a string, got ${typeof value}.`);
    }
    return value;
  };

  ipcMain.handle(CHANNELS.savesRead, (event, value: unknown) => {
    assertGameSender(event, window(), CHANNELS.savesRead);
    return adapter.read(key(CHANNELS.savesRead, value));
  });

  ipcMain.handle(
    CHANNELS.savesWrite,
    (event, keyValue: unknown, value: unknown) => {
      assertGameSender(event, window(), CHANNELS.savesWrite);
      const name = key(CHANNELS.savesWrite, keyValue);
      if (typeof value !== "string") {
        throw new Error(
          `${CHANNELS.savesWrite}: value must be a string, got ${typeof value}.`,
        );
      }
      if (value.length > MAX_VALUE_LENGTH) {
        throw new Error(
          `${CHANNELS.savesWrite}: value must be at most ${MAX_VALUE_LENGTH} ` +
            `UTF-16 code units, got ${value.length}.`,
        );
      }
      return adapter.write(name, value);
    },
  );

  ipcMain.handle(CHANNELS.savesDelete, (event, value: unknown) => {
    assertGameSender(event, window(), CHANNELS.savesDelete);
    return adapter.delete(key(CHANNELS.savesDelete, value));
  });

  ipcMain.handle(CHANNELS.savesList, (event, value: unknown) => {
    assertGameSender(event, window(), CHANNELS.savesList);
    if (typeof value !== "string") {
      throw new Error(
        `${CHANNELS.savesList}: prefix must be a string, got ${typeof value}.`,
      );
    }
    return adapter.list(value);
  });
}

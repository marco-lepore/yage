import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { BrowserWindow } from "electron";
import { CHANNELS, HOST_BRIDGE_PROTOCOL } from "./protocol.js";
import { createBridge } from "./preload/createBridge.js";
import type { BridgeIpc } from "./preload/createBridge.js";
import { registerHostChannels } from "./main/channels.js";
import { watchWindow } from "./main/windowState.js";
import {
  FakeBrowserWindow,
  ipcMain,
  resetFakeElectron,
} from "./test/fakeElectron.js";

/**
 * What the bridge looked like at each protocol number: the members a page can
 * reach, the channels behind them, and the keys of each payload. A change to
 * any of it without a new number fails here, which is the point: a shell and
 * a game of different versions must not look alike to each other.
 */
const RECORDED: Record<number, unknown> = {
  1: {
    bridge: [
      "onState",
      "protocol",
      "saves.delete",
      "saves.list",
      "saves.read",
      "saves.write",
      "setFullscreen",
      "start",
    ],
    channels: {
      fullscreen: "yage:host:fullscreen",
      savesDelete: "yage:saves:delete",
      savesList: "yage:saves:list",
      savesRead: "yage:saves:read",
      savesWrite: "yage:saves:write",
      start: "yage:host:start",
      state: "yage:host:state",
    },
    state: [
      "fullscreen.active",
      "fullscreen.fullscreenable",
      "lifecycle.activity",
      "lifecycle.focus",
      "lifecycle.visibility",
      "revision",
    ],
    start: ["info.appVersion", "info.os", "info.runtimeVersion", "state"],
    fullscreenResult: ["done", "state"],
  },
};

/** Every member path of an object, nested objects walked, sorted. */
function paths(value: unknown, prefix = ""): string[] {
  const found: string[] = [];
  for (const [key, member] of Object.entries(value as object)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof member === "object" && member !== null) {
      found.push(...paths(member, path));
    } else {
      found.push(path);
    }
  }
  return found.sort();
}

/** The keys of one payload, one level into each nested object. */
function keys(value: unknown): string[] {
  return paths(value).sort();
}

function fakeIpc(): BridgeIpc {
  const emitter = new EventEmitter();
  return {
    invoke: () => Promise.resolve(undefined),
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
  } as unknown as BridgeIpc;
}

describe("the bridge protocol", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(HOST_BRIDGE_PROTOCOL)).toBe(true);
    expect(HOST_BRIDGE_PROTOCOL).toBeGreaterThan(0);
    expect(HOST_BRIDGE_PROTOCOL).toBe(1);
  });

  it("matches the table recorded for its number", async () => {
    const recorded = RECORDED[HOST_BRIDGE_PROTOCOL];
    expect(recorded, "record the table for this protocol number").toBeDefined();
    resetFakeElectron();
    const win = new FakeBrowserWindow();
    const watch = watchWindow(win as unknown as BrowserWindow, () => {});
    registerHostChannels({
      window: () => win as unknown as BrowserWindow,
      watch: () => watch,
    });
    const event = {
      sender: win.webContents,
      senderFrame: win.webContents.mainFrame,
    };
    const start = await ipcMain.invoke(CHANNELS.start, event);
    const fullscreen = await ipcMain.invoke(CHANNELS.fullscreen, event, true);
    watch.stop();

    const table = {
      bridge: paths(createBridge(fakeIpc())),
      channels: { ...CHANNELS },
      state: keys((start as { state: unknown }).state),
      start: keys({ ...(start as object), state: "state" }),
      fullscreenResult: keys({ ...(fullscreen as object), state: "state" }),
    };
    expect(table).toEqual(recorded);
  });
});

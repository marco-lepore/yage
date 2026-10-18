import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { BrowserWindow } from "electron";
import type { SaveAdapter } from "@yagejs/save";
import { CHANNELS } from "../protocol.js";
import {
  FakeBrowserWindow,
  FakeFrame,
  ipcMain,
  resetFakeElectron,
} from "../test/fakeElectron.js";
import {
  assertGameSender,
  osOf,
  registerHostChannels,
  registerSaveChannels,
} from "./channels.js";
import { watchWindow } from "./windowState.js";
import type { WindowWatch } from "./windowState.js";

function asWindow(win: FakeBrowserWindow): BrowserWindow {
  return win as unknown as BrowserWindow;
}

/** An invoke message from the game page itself. */
function gameEvent(win: FakeBrowserWindow): unknown {
  return { sender: win.webContents, senderFrame: win.webContents.mainFrame };
}

function setup(): { win: FakeBrowserWindow; watch: WindowWatch } {
  const win = new FakeBrowserWindow();
  const watch = watchWindow(asWindow(win), () => {});
  registerHostChannels({ window: () => asWindow(win), watch: () => watch });
  return { win, watch };
}

beforeEach(() => {
  resetFakeElectron();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("assertGameSender", () => {
  it("passes the game page's own main frame", () => {
    const win = new FakeBrowserWindow();
    expect(() =>
      assertGameSender(
        gameEvent(win) as never,
        asWindow(win),
        CHANNELS.savesRead,
      ),
    ).not.toThrow();
  });

  it("refuses anything else and says where it came from", () => {
    const win = new FakeBrowserWindow();
    const other = new FakeBrowserWindow();
    const subframe = new FakeFrame("yage://game/frame.html", "yage://game");
    const foreign = new FakeFrame("file:///tmp/x.html", "file://");
    const refused: [unknown, string][] = [
      [
        { sender: win.webContents, senderFrame: subframe },
        "yage://game/frame.html",
      ],
      [
        { sender: other.webContents, senderFrame: other.webContents.mainFrame },
        "yage://game/index.html",
      ],
      [{ sender: win.webContents, senderFrame: foreign }, "file:///tmp/x.html"],
      [{ sender: win.webContents, senderFrame: null }, "null"],
    ];
    for (const [event, url] of refused) {
      expect(() =>
        assertGameSender(event as never, asWindow(win), CHANNELS.savesWrite),
      ).toThrowError(
        `${CHANNELS.savesWrite}: only the game page may use the host bridge, ` +
          `got a request from ${JSON.stringify(url === "null" ? null : url)}.`,
      );
    }
  });
});

describe("the identity channel", () => {
  it("names the system, the app's version and the runtime's", async () => {
    // Vitest runs under Node, which has no Electron version of its own.
    Object.defineProperty(process.versions, "electron", {
      value: "44.7.0",
      configurable: true,
    });
    onTestFinished(() => {
      delete (process.versions as { electron?: string }).electron;
    });
    const { win } = setup();
    const start = (await ipcMain.invoke(CHANNELS.start, gameEvent(win))) as {
      info: { os: string; appVersion: string; runtimeVersion: string };
    };
    expect(start.info.appVersion).toBe("1.2.3");
    expect(start.info.runtimeVersion).toBe("44.7.0");
  });

  it("maps each system this shell runs on", () => {
    expect(osOf("darwin")).toBe("macos");
    expect(osOf("win32")).toBe("windows");
    expect(osOf("linux")).toBe("linux");
    expect(osOf("freebsd")).toBe("unknown");
  });

  it("serves no one but the game page", async () => {
    setup();
    const other = new FakeBrowserWindow();
    await expect(
      ipcMain.invoke(CHANNELS.start, {
        sender: other.webContents,
        senderFrame: other.webContents.mainFrame,
      }),
    ).rejects.toThrowError(/only the game page may use the host bridge/);
  });
});

describe("the fullscreen channel", () => {
  it("refuses an argument that is not a boolean", async () => {
    const { win } = setup();
    await expect(
      ipcMain.invoke(CHANNELS.fullscreen, gameEvent(win), "yes"),
    ).rejects.toThrowError(
      `${CHANNELS.fullscreen}: active must be a boolean, got "yes".`,
    );
    expect(win.fullScreenCalls).toEqual([]);
  });

  it("answers at once when the window is already as asked", async () => {
    const { win } = setup();
    win.fullScreen = true;
    const result = (await ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      true,
    )) as { done: boolean };
    expect(result.done).toBe(true);
    expect(win.fullScreenCalls).toEqual([]);
  });

  it("reports a window that cannot be made fullscreen", async () => {
    const { win } = setup();
    win.fullScreenable = false;
    const result = (await ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      true,
    )) as { done: boolean };
    expect(result.done).toBe(false);
    expect(win.fullScreenCalls).toEqual([]);
  });

  it("settles when the window reports the change", async () => {
    const { win } = setup();
    const result = (await ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      true,
    )) as { done: boolean; state: { fullscreen: { active: boolean } } };
    expect(result.done).toBe(true);
    expect(result.state.fullscreen.active).toBe(true);
    expect(win.fullScreenCalls).toEqual([true]);
  });

  it("settles on the bound with the state the window is in", async () => {
    vi.useFakeTimers();
    const { win } = setup();
    win.fullScreenCompletes = false;
    const watching = win.listenerCount("enter-full-screen");
    const pending = ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      true,
    ) as Promise<{ done: boolean }>;
    await Promise.resolve();
    expect(win.listenerCount("enter-full-screen")).toBe(watching + 1);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ done: false });
    expect(win.listenerCount("enter-full-screen")).toBe(watching);
  });

  it("answers a change that arrived without its event with a newer revision", async () => {
    vi.useFakeTimers();
    const win = new FakeBrowserWindow();
    const sent: number[] = [];
    const watch = watchWindow(asWindow(win), (state) =>
      sent.push(state.revision),
    );
    registerHostChannels({ window: () => asWindow(win), watch: () => watch });
    win.emit("focus");
    win.fullScreenCompletes = false;
    const pending = ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      true,
    ) as Promise<{
      done: boolean;
      state: { revision: number; fullscreen: { active: boolean } };
    }>;
    win.fullScreen = true;
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;
    expect(result.done).toBe(true);
    expect(result.state.fullscreen.active).toBe(true);
    expect(result.state.revision).toBeGreaterThan(sent.at(-1)!);
  });

  it("settles when the window leaves fullscreen", async () => {
    const { win } = setup();
    win.fullScreen = true;
    const result = (await ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      false,
    )) as { done: boolean; state: { fullscreen: { active: boolean } } };
    expect(result.done).toBe(true);
    expect(result.state.fullscreen.active).toBe(false);
    expect(win.fullScreenCalls).toEqual([false]);
  });

  it("settles when the window closes before the change arrives", async () => {
    vi.useFakeTimers();
    const { win } = setup();
    win.fullScreenCompletes = false;
    const pending = ipcMain.invoke(
      CHANNELS.fullscreen,
      gameEvent(win),
      true,
    ) as Promise<{ done: boolean }>;
    win.emit("closed");
    await expect(pending).resolves.toMatchObject({ done: false });
  });
});

describe("the save channels", () => {
  function adapter(): SaveAdapter & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      read: vi.fn(async (key: string) => {
        calls.push(`read ${key}`);
        return null;
      }),
      write: vi.fn(async (key: string, value: string) => {
        calls.push(`write ${key} ${value.length}`);
      }),
      delete: vi.fn(async (key: string) => {
        calls.push(`delete ${key}`);
      }),
      list: vi.fn(async (prefix: string) => {
        calls.push(`list ${prefix}`);
        return [];
      }),
    };
  }

  it("refuses an argument of the wrong kind before it touches a file", async () => {
    const win = new FakeBrowserWindow();
    const store = adapter();
    registerSaveChannels(store, () => asWindow(win));
    const event = gameEvent(win);
    await expect(
      ipcMain.invoke(CHANNELS.savesRead, event, 42),
    ).rejects.toThrowError(
      `${CHANNELS.savesRead}: key must be a string, got number.`,
    );
    await expect(
      ipcMain.invoke(CHANNELS.savesWrite, event, 42, "v"),
    ).rejects.toThrowError(
      `${CHANNELS.savesWrite}: key must be a string, got number.`,
    );
    await expect(
      ipcMain.invoke(CHANNELS.savesWrite, event, "k", 7),
    ).rejects.toThrowError(
      `${CHANNELS.savesWrite}: value must be a string, got number.`,
    );
    await expect(
      ipcMain.invoke(CHANNELS.savesWrite, event, "k", "x".repeat(67_108_865)),
    ).rejects.toThrowError(
      `${CHANNELS.savesWrite}: value must be at most 67108864 UTF-16 code ` +
        "units, got 67108865.",
    );
    await expect(
      ipcMain.invoke(CHANNELS.savesDelete, event, 42),
    ).rejects.toThrowError(
      `${CHANNELS.savesDelete}: key must be a string, got number.`,
    );
    await expect(
      ipcMain.invoke(CHANNELS.savesList, event, 42),
    ).rejects.toThrowError(
      `${CHANNELS.savesList}: prefix must be a string, got number.`,
    );
    expect(store.calls).toEqual([]);
  });

  it("serves no one but the game page", async () => {
    const win = new FakeBrowserWindow();
    const other = new FakeBrowserWindow();
    const store = adapter();
    registerSaveChannels(store, () => asWindow(win));
    const foreign = {
      sender: other.webContents,
      senderFrame: other.webContents.mainFrame,
    };
    for (const channel of [
      CHANNELS.savesRead,
      CHANNELS.savesWrite,
      CHANNELS.savesDelete,
      CHANNELS.savesList,
    ]) {
      await expect(
        ipcMain.invoke(channel, foreign, "k", "v"),
      ).rejects.toThrowError(/only the game page may use the host bridge/);
    }
    expect(store.calls).toEqual([]);
  });

  it("writes two values for one key in the order they were asked", async () => {
    const win = new FakeBrowserWindow();
    const store = adapter();
    registerSaveChannels(store, () => asWindow(win));
    const event = gameEvent(win);
    await Promise.all([
      ipcMain.invoke(CHANNELS.savesWrite, event, "k", "first"),
      ipcMain.invoke(CHANNELS.savesWrite, event, "k", "second-value"),
      ipcMain.invoke(CHANNELS.savesRead, event, "k"),
      ipcMain.invoke(CHANNELS.savesDelete, event, "k"),
      ipcMain.invoke(CHANNELS.savesList, event, "p"),
    ]);
    expect(store.calls).toEqual([
      "write k 5",
      "write k 12",
      "read k",
      "delete k",
      "list p",
    ]);
  });
});

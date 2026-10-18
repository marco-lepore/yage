import { beforeEach, describe, expect, it } from "vitest";
import type { BrowserWindow } from "electron";
import {
  FakeBrowserWindow,
  powerMonitor,
  resetFakeElectron,
} from "../test/fakeElectron.js";
import { snapshotOf, watchWindow } from "./windowState.js";
import type { PowerState } from "./windowState.js";

function window(): FakeBrowserWindow {
  return new FakeBrowserWindow();
}

function asWindow(win: FakeBrowserWindow): BrowserWindow {
  return win as unknown as BrowserWindow;
}

const QUIET: PowerState = { locked: false, suspended: false, observed: false };

beforeEach(() => {
  resetFakeElectron();
});

describe("snapshotOf", () => {
  it("reads focus, visibility and fullscreen from the window", () => {
    const win = window();
    win.focused = true;
    win.fullScreen = true;
    expect(snapshotOf(asWindow(win), QUIET, 4)).toEqual({
      revision: 4,
      lifecycle: {
        activity: "unknown",
        visibility: "visible",
        focus: "focused",
      },
      fullscreen: { fullscreenable: true, active: true },
    });
  });

  it("calls a minimised or hidden window hidden", () => {
    const win = window();
    win.minimized = true;
    expect(snapshotOf(asWindow(win), QUIET, 1).lifecycle.visibility).toBe(
      "hidden",
    );
    win.minimized = false;
    win.visible = false;
    expect(snapshotOf(asWindow(win), QUIET, 1).lifecycle.visibility).toBe(
      "hidden",
    );
  });

  it("holds the app inactive while either cause lasts", () => {
    const win = window();
    const activity = (power: PowerState): string =>
      snapshotOf(asWindow(win), power, 1).lifecycle.activity;
    expect(activity({ locked: false, suspended: false, observed: false })).toBe(
      "unknown",
    );
    expect(activity({ locked: true, suspended: false, observed: true })).toBe(
      "inactive",
    );
    expect(activity({ locked: true, suspended: true, observed: true })).toBe(
      "inactive",
    );
    expect(activity({ locked: false, suspended: true, observed: true })).toBe(
      "inactive",
    );
    expect(activity({ locked: false, suspended: false, observed: true })).toBe(
      "active",
    );
  });
});

describe("watchWindow", () => {
  it("sends one snapshot per event, each with the next revision", () => {
    const win = window();
    const sent: { revision: number; activity: string }[] = [];
    const watch = watchWindow(asWindow(win), (state) =>
      sent.push({
        revision: state.revision,
        activity: state.lifecycle.activity,
      }),
    );

    for (const event of [
      "focus",
      "blur",
      "minimize",
      "restore",
      "hide",
      "show",
      "enter-full-screen",
      "leave-full-screen",
    ]) {
      win.emit(event);
    }
    expect(sent.map((state) => state.revision)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(sent.at(-1)!.activity).toBe("unknown");

    powerMonitor.emit("lock-screen");
    powerMonitor.emit("suspend");
    powerMonitor.emit("resume");
    expect(sent.at(-1)!.activity).toBe("inactive");
    powerMonitor.emit("unlock-screen");
    expect(sent.at(-1)!.activity).toBe("active");
    expect(sent).toHaveLength(12);
    expect(watch.current().revision).toBe(13);
    win.emit("focus");
    expect(sent.at(-1)!.revision).toBe(14);

    watch.stop();
  });

  it("says nothing once the window is gone, and keeps no listener", () => {
    const win = window();
    const sent: unknown[] = [];
    const watch = watchWindow(asWindow(win), (state) => sent.push(state));
    win.destroyed = true;
    win.emit("focus");
    expect(sent).toEqual([]);

    win.emit("closed");
    expect(win.eventNames()).toEqual([]);
    expect(powerMonitor.eventNames()).toEqual([]);
    watch.stop();
  });

  it("drops every listener when the caller stops it", () => {
    const win = window();
    const watch = watchWindow(asWindow(win), () => {});
    expect(win.eventNames().length).toBeGreaterThan(0);
    watch.stop();
    expect(win.eventNames()).toEqual([]);
    expect(powerMonitor.eventNames()).toEqual([]);
  });
});

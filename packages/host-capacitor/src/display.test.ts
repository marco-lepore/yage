import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIENTATION_SETTLE_MS, createDisplay } from "./display.js";
import { orientation as plugin, resetCapacitor } from "./test/fakeCapacitor.js";

/** The page's screen orientation, with the two things a test does to it. */
class FakeOrientation extends EventTarget {
  type: OrientationType = "portrait-primary";
  listeners = 0;

  override addEventListener(name: string, listener: EventListener): void {
    this.listeners += 1;
    super.addEventListener(name, listener);
  }

  override removeEventListener(name: string, listener: EventListener): void {
    this.listeners -= 1;
    super.removeEventListener(name, listener);
  }

  /** Turn the screen, as the system does while a lock takes hold. */
  turn(to: OrientationType): void {
    this.type = to;
    this.dispatchEvent(new Event("change"));
  }
}

let screenOrientation: FakeOrientation;

function givePageAScreen(withOrientation: boolean): void {
  screenOrientation = new FakeOrientation();
  (globalThis as { screen?: unknown }).screen = withOrientation
    ? { orientation: screenOrientation }
    : {};
}

beforeEach(() => {
  vi.useFakeTimers();
  givePageAScreen(true);
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { screen?: unknown }).screen;
  resetCapacitor();
});

describe("fullscreen", () => {
  it("stays with the page on iOS", () => {
    expect(createDisplay("ios").fullscreen).toBeUndefined();
  });

  it("is what an Android web view cannot do", async () => {
    const fullscreen = createDisplay("android").fullscreen;
    expect(fullscreen?.support).toBe("unsupported");
    expect(fullscreen?.active).toBe(false);
    await expect(fullscreen?.request()).rejects.toThrow(
      "CapacitorHostPlugin: an Android web view in a Capacitor app cannot " +
        "present the game fullscreen.",
    );
    await expect(fullscreen?.exit()).resolves.toBeUndefined();
  });
});

describe("orientation", () => {
  it("reads the page's screen", () => {
    const display = createDisplay("ios");
    expect(display.orientation?.lockSupport).toBe("supported");
    expect(display.orientation?.current).toBe("portrait-primary");
    screenOrientation.type = "landscape-primary";
    expect(display.orientation?.current).toBe("landscape-primary");
  });

  it("reads nothing where the page has no screen orientation", () => {
    givePageAScreen(false);
    expect(createDisplay("ios").orientation?.current).toBeNull();
    delete (globalThis as { screen?: unknown }).screen;
    expect(createDisplay("ios").orientation?.current).toBeNull();
  });

  it("resolves once the screen has turned", async () => {
    const display = createDisplay("ios");
    let settled = false;
    const locking = display.orientation?.lock("landscape").then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(plugin.locks).toEqual(["landscape"]);
    expect(settled).toBe(false);

    screenOrientation.turn("portrait-secondary");
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    screenOrientation.turn("landscape-primary");
    await locking;
    expect(settled).toBe(true);
    expect(screenOrientation.listeners).toBe(0);
  });

  it("resolves at once when the screen already reads as the lock asked", async () => {
    const display = createDisplay("ios");
    screenOrientation.type = "landscape-secondary";
    await display.orientation?.lock("landscape");
    expect(screenOrientation.listeners).toBe(0);
  });

  it("waits for the one orientation a specific lock asked for", async () => {
    const display = createDisplay("ios");
    let settled = false;
    const locking = display.orientation
      ?.lock("landscape-secondary")
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(10);
    screenOrientation.turn("landscape-primary");
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    screenOrientation.turn("landscape-secondary");
    await locking;
    expect(settled).toBe(true);
  });

  it("settles a lock the system does not perform", async () => {
    const display = createDisplay("android");
    let settled = false;
    const locking = display.orientation?.lock("landscape").then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(ORIENTATION_SETTLE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await locking;
    expect(settled).toBe(true);
    expect(screenOrientation.listeners).toBe(0);
  });

  it("settles at the bound where the page reads no orientation", async () => {
    givePageAScreen(false);
    const display = createDisplay("ios");
    let settled = false;
    const locking = display.orientation?.lock("portrait").then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(ORIENTATION_SETTLE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await locking;
    expect(settled).toBe(true);
  });

  it("passes on a lock the app refused", async () => {
    const display = createDisplay("ios");
    plugin.lockRejection = new Error("the app refused the lock");
    await expect(display.orientation?.lock("landscape")).rejects.toThrow(
      "the app refused the lock",
    );
    expect(screenOrientation.listeners).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles every pending lock when the engine is gone", async () => {
    const display = createDisplay("ios");
    const locking = display.orientation?.lock("landscape");
    await vi.advanceTimersByTimeAsync(10);
    display.settleAll();
    await locking;
    expect(screenOrientation.listeners).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the screen", async () => {
    await createDisplay("ios").orientation?.unlock();
    expect(plugin.unlocks).toBe(1);
  });
});

describe("watch", () => {
  it("reports every turn of the screen until it is stopped", () => {
    const display = createDisplay("ios");
    const changed = vi.fn();
    const stop = display.watch(changed);
    expect(screenOrientation.listeners).toBe(1);
    screenOrientation.turn("landscape-primary");
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    expect(screenOrientation.listeners).toBe(0);
    screenOrientation.turn("portrait-primary");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("adds nothing where the page has no screen orientation", () => {
    givePageAScreen(false);
    const stop = createDisplay("ios").watch(vi.fn());
    expect(() => stop()).not.toThrow();
  });
});

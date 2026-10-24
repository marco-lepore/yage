import { describe, it, expect, vi } from "vitest";
import { TestHostDisplay } from "./TestHostDisplay.js";

describe("TestHostDisplay", () => {
  it("starts supported, not fullscreen and in landscape", () => {
    const display = new TestHostDisplay();

    expect(display.fullscreen.support).toBe("supported");
    expect(display.fullscreen.active).toBe(false);
    expect(display.orientation.current).toBe("landscape-primary");
    expect(display.orientation.lockSupport).toBe("supported");
    expect(display.calls).toEqual([]);
  });

  it("takes its state from the constructor", () => {
    const display = new TestHostDisplay({
      fullscreenSupport: "unsupported",
      fullscreen: true,
      orientation: null,
      orientationLockSupport: "unknown",
    });

    expect(display.fullscreen.support).toBe("unsupported");
    expect(display.fullscreen.active).toBe(true);
    expect(display.orientation.current).toBeNull();
    expect(display.orientation.lockSupport).toBe("unknown");
  });

  it("reports one change per set, only while watched", () => {
    const display = new TestHostDisplay();
    const changed = vi.fn();

    display.set({ fullscreen: true });
    expect(changed).not.toHaveBeenCalled();

    const stop = display.watch(changed);
    display.set({ orientation: "portrait-primary" });
    display.set({ fullscreenSupport: "unknown" });
    expect(changed).toHaveBeenCalledTimes(2);

    stop();
    display.set({ fullscreen: false });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(display.fullscreen.active).toBe(false);
  });

  it("leaves a later watcher in place when an earlier stop runs", () => {
    const display = new TestHostDisplay();
    const first = vi.fn();
    const second = vi.fn();

    const stopFirst = display.watch(first);
    display.watch(second);
    stopFirst();
    display.set({ fullscreen: true });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("keeps the fields a set leaves out", () => {
    const display = new TestHostDisplay();

    display.set({ fullscreen: true });

    expect(display.fullscreen.active).toBe(true);
    expect(display.orientation.current).toBe("landscape-primary");
  });

  it("records every request and applies it to the state", async () => {
    const display = new TestHostDisplay();

    await display.fullscreen.request();
    expect(display.fullscreen.active).toBe(true);
    await display.fullscreen.exit();
    expect(display.fullscreen.active).toBe(false);

    await display.orientation.lock("portrait");
    expect(display.orientation.current).toBe("portrait-primary");
    await display.orientation.lock("landscape");
    expect(display.orientation.current).toBe("landscape-primary");
    await display.orientation.lock("landscape-secondary");
    expect(display.orientation.current).toBe("landscape-secondary");
    await display.orientation.unlock();
    expect(display.orientation.current).toBe("landscape-secondary");

    expect(display.calls).toEqual([
      "request",
      "exit",
      "lock:portrait",
      "lock:landscape",
      "lock:landscape-secondary",
      "unlock",
    ]);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { createPageFullscreen, createPageOrientation } from "./pageDisplay.js";

/** A document stub that records the listeners the page parts attach. */
interface FakeDocument {
  listeners: Map<string, Array<() => void>>;
  removed: string[];
  addEventListener: (event: string, fn: () => void) => void;
  removeEventListener: (event: string, fn: () => void) => void;
  fire: (event: string) => void;
  [key: string]: unknown;
}

function fakeDocument(fields: Record<string, unknown> = {}): FakeDocument {
  const listeners = new Map<string, Array<() => void>>();
  const removed: string[] = [];
  const doc: FakeDocument = {
    listeners,
    removed,
    addEventListener(event: string, fn: () => void): void {
      const forEvent = listeners.get(event) ?? [];
      forEvent.push(fn);
      listeners.set(event, forEvent);
    },
    removeEventListener(event: string, fn: () => void): void {
      removed.push(event);
      const forEvent = listeners.get(event) ?? [];
      const index = forEvent.indexOf(fn);
      if (index !== -1) forEvent.splice(index, 1);
    },
    fire(event: string): void {
      for (const fn of [...(listeners.get(event) ?? [])]) fn();
    },
    ...fields,
  };
  return doc;
}

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches })),
  );
}

const element = (fields: Record<string, unknown> = {}): HTMLElement =>
  fields as unknown as HTMLElement;

describe("page fullscreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("support", () => {
    it("is unsupported without a document", () => {
      const part = createPageFullscreen(
        element({ requestFullscreen: vi.fn() }),
      ).part;

      expect(part.support).toBe("unsupported");
    });

    it("is unsupported on a target with no request method", () => {
      vi.stubGlobal("document", fakeDocument({ fullscreenEnabled: true }));

      expect(createPageFullscreen(element()).part.support).toBe("unsupported");
    });

    it("is unsupported while neither enabled flag is true", () => {
      vi.stubGlobal(
        "document",
        fakeDocument({ fullscreenEnabled: false, webkitFullscreenEnabled: 1 }),
      );
      const target = element({ requestFullscreen: vi.fn() });

      expect(createPageFullscreen(target).part.support).toBe("unsupported");
    });

    it("is supported with only the prefixed enabled flag", () => {
      vi.stubGlobal(
        "document",
        fakeDocument({ webkitFullscreenEnabled: true }),
      );
      const target = element({ webkitRequestFullscreen: vi.fn() });

      expect(createPageFullscreen(target).part.support).toBe("supported");
    });

    it("is unsupported in an app that is already presented fullscreen", () => {
      vi.stubGlobal(
        "document",
        fakeDocument({ fullscreenEnabled: true, fullscreenElement: null }),
      );
      stubMatchMedia(true);
      const target = element({ requestFullscreen: vi.fn() });

      expect(createPageFullscreen(target).part.support).toBe("unsupported");
    });

    it("is supported while the target itself is fullscreen", () => {
      const target = element({ requestFullscreen: vi.fn() });
      vi.stubGlobal(
        "document",
        fakeDocument({ fullscreenEnabled: true, fullscreenElement: target }),
      );
      stubMatchMedia(true);

      expect(createPageFullscreen(target).part.support).toBe("supported");
    });

    it("is supported where the page cannot answer media queries", () => {
      vi.stubGlobal(
        "document",
        fakeDocument({ fullscreenEnabled: true, fullscreenElement: null }),
      );
      const target = element({ requestFullscreen: vi.fn() });

      expect(createPageFullscreen(target).part.support).toBe("supported");
    });
  });

  describe("active", () => {
    it("reads the unprefixed fullscreen element", () => {
      const target = element({ requestFullscreen: vi.fn() });
      const doc = fakeDocument({ fullscreenElement: target });
      vi.stubGlobal("document", doc);
      const part = createPageFullscreen(target).part;

      expect(part.active).toBe(true);
      doc.fullscreenElement = null;
      expect(part.active).toBe(false);
    });

    it("reads the prefixed fullscreen element", () => {
      const target = element({ webkitRequestFullscreen: vi.fn() });
      vi.stubGlobal(
        "document",
        fakeDocument({ webkitFullscreenElement: target }),
      );

      expect(createPageFullscreen(target).part.active).toBe(true);
    });

    it("is false while another element is fullscreen", () => {
      const target = element({ requestFullscreen: vi.fn() });
      vi.stubGlobal(
        "document",
        fakeDocument({ fullscreenElement: element({ other: true }) }),
      );

      expect(createPageFullscreen(target).part.active).toBe(false);
    });

    it("is false without a document", () => {
      const target = element({ requestFullscreen: vi.fn() });

      expect(createPageFullscreen(target).part.active).toBe(false);
    });
  });

  describe("request", () => {
    it("asks the target once and passes its rejection on", async () => {
      const failure = new TypeError("Permissions check failed");
      const requestFullscreen = vi.fn().mockRejectedValue(failure);
      vi.stubGlobal("document", fakeDocument({ fullscreenElement: null }));
      const target = element({ requestFullscreen });

      await expect(createPageFullscreen(target).part.request()).rejects.toBe(
        failure,
      );
      expect(requestFullscreen).toHaveBeenCalledOnce();
    });

    it("settles the prefixed request on the page's change event", async () => {
      const doc = fakeDocument({ webkitFullscreenElement: null });
      vi.stubGlobal("document", doc);
      const webkitRequestFullscreen = vi.fn();
      const target = element({ webkitRequestFullscreen });

      const pending = createPageFullscreen(target).part.request();
      expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
      doc.fire("webkitfullscreenchange");

      await expect(pending).resolves.toBeUndefined();
      expect(doc.removed).toEqual([
        "webkitfullscreenchange",
        "webkitfullscreenerror",
      ]);
    });

    it("rejects the prefixed request on the page's error event", async () => {
      const doc = fakeDocument({ webkitFullscreenElement: null });
      vi.stubGlobal("document", doc);
      const target = element({ webkitRequestFullscreen: vi.fn() });

      const pending = createPageFullscreen(target).part.request();
      doc.fire("webkitfullscreenerror");

      await expect(pending).rejects.toThrow(
        "RendererPlugin.requestFullscreen: the browser refused fullscreen.",
      );
      expect(doc.removed).toEqual([
        "webkitfullscreenchange",
        "webkitfullscreenerror",
      ]);
    });
  });

  describe("exit", () => {
    it("asks the document", async () => {
      const exitFullscreen = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("document", fakeDocument({ exitFullscreen }));
      const target = element({ requestFullscreen: vi.fn() });

      await createPageFullscreen(target).part.exit();

      expect(exitFullscreen).toHaveBeenCalledOnce();
    });

    it("settles the prefixed exit on the page's change event", async () => {
      const webkitExitFullscreen = vi.fn();
      const doc = fakeDocument({ webkitExitFullscreen });
      vi.stubGlobal("document", doc);
      const target = element({ webkitRequestFullscreen: vi.fn() });

      const pending = createPageFullscreen(target).part.exit();
      expect(webkitExitFullscreen).toHaveBeenCalledOnce();
      doc.fire("webkitfullscreenchange");

      await expect(pending).resolves.toBeUndefined();
      expect(doc.removed).toEqual(["webkitfullscreenchange"]);
    });
  });

  describe("watch", () => {
    it("reports both change events and detaches both", () => {
      const doc = fakeDocument({ fullscreenElement: null });
      vi.stubGlobal("document", doc);
      const changed = vi.fn();
      const target = element({ requestFullscreen: vi.fn() });

      const stop = createPageFullscreen(target).watch(changed);
      doc.fire("fullscreenchange");
      doc.fire("webkitfullscreenchange");
      expect(changed).toHaveBeenCalledTimes(2);

      stop();
      doc.fire("fullscreenchange");
      doc.fire("webkitfullscreenchange");
      expect(changed).toHaveBeenCalledTimes(2);
    });

    it("attaches nothing without a document", () => {
      const changed = vi.fn();
      const target = element({ requestFullscreen: vi.fn() });

      const stop = createPageFullscreen(target).watch(changed);

      expect(() => stop()).not.toThrow();
      expect(changed).not.toHaveBeenCalled();
    });
  });
});

describe("page orientation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("current", () => {
    it("reads the screen orientation type", () => {
      vi.stubGlobal("window", {
        screen: { orientation: { type: "portrait-secondary" } },
      });

      expect(createPageOrientation().part.current).toBe("portrait-secondary");
    });

    it.each([
      [0, "portrait-primary"],
      [180, "portrait-secondary"],
      [90, "landscape-primary"],
      [-90, "landscape-secondary"],
      [270, "landscape-secondary"],
    ])("derives %s degrees as %s", (angle, expected) => {
      vi.stubGlobal("window", { screen: {}, orientation: angle });

      expect(createPageOrientation().part.current).toBe(expected);
    });

    it("is null for an angle it cannot name", () => {
      vi.stubGlobal("window", { screen: {}, orientation: 45 });

      expect(createPageOrientation().part.current).toBeNull();
    });

    it("is null without a window", () => {
      expect(createPageOrientation().part.current).toBeNull();
    });
  });

  describe("lockSupport", () => {
    it("is unsupported without a screen orientation", () => {
      vi.stubGlobal("window", { screen: {} });

      expect(createPageOrientation().part.lockSupport).toBe("unsupported");
    });

    it("is unsupported where the lock operation is absent", () => {
      vi.stubGlobal("window", {
        screen: { orientation: { type: "landscape-primary" } },
      });

      expect(createPageOrientation().part.lockSupport).toBe("unsupported");
    });

    it("is unknown where the lock operation exists", () => {
      vi.stubGlobal("window", {
        screen: { orientation: { type: "landscape-primary", lock: vi.fn() } },
      });

      expect(createPageOrientation().part.lockSupport).toBe("unknown");
    });

    it("is unsupported without a window", () => {
      expect(createPageOrientation().part.lockSupport).toBe("unsupported");
    });
  });

  describe("lock and unlock", () => {
    it("asks the screen orientation and passes its rejection on", async () => {
      const failure = new Error("not available on this device");
      const lock = vi.fn().mockRejectedValue(failure);
      vi.stubGlobal("window", { screen: { orientation: { lock } } });

      await expect(createPageOrientation().part.lock("landscape")).rejects.toBe(
        failure,
      );
      expect(lock).toHaveBeenCalledWith("landscape");
    });

    it("releases the lock through the screen orientation", async () => {
      const unlock = vi.fn();
      vi.stubGlobal("window", { screen: { orientation: { unlock } } });

      await createPageOrientation().part.unlock();

      expect(unlock).toHaveBeenCalledOnce();
    });

    it("resolves the release where there is no screen orientation", async () => {
      vi.stubGlobal("window", { screen: {} });

      await expect(
        createPageOrientation().part.unlock(),
      ).resolves.toBeUndefined();
    });
  });

  describe("watch", () => {
    it("reports the screen orientation change and detaches it", () => {
      const handlers: Array<() => void> = [];
      const removeEventListener = vi.fn();
      vi.stubGlobal("window", {
        screen: {
          orientation: {
            type: "landscape-primary",
            addEventListener: (event: string, fn: () => void) => {
              if (event === "change") handlers.push(fn);
            },
            removeEventListener,
          },
        },
      });
      const changed = vi.fn();

      const stop = createPageOrientation().watch(changed);
      for (const fn of handlers) fn();
      expect(changed).toHaveBeenCalledOnce();

      stop();
      expect(removeEventListener).toHaveBeenCalledWith("change", changed);
    });

    it("falls back to the window's orientation change", () => {
      const handlers: Array<() => void> = [];
      const removeEventListener = vi.fn();
      vi.stubGlobal("window", {
        screen: {},
        orientation: 90,
        addEventListener: (event: string, fn: () => void) => {
          if (event === "orientationchange") handlers.push(fn);
        },
        removeEventListener,
      });
      const changed = vi.fn();

      const stop = createPageOrientation().watch(changed);
      for (const fn of handlers) fn();
      expect(changed).toHaveBeenCalledOnce();

      stop();
      expect(removeEventListener).toHaveBeenCalledWith(
        "orientationchange",
        changed,
      );
    });

    it("attaches nothing without a window", () => {
      const changed = vi.fn();

      const stop = createPageOrientation().watch(changed);

      expect(() => stop()).not.toThrow();
      expect(changed).not.toHaveBeenCalled();
    });
  });
});

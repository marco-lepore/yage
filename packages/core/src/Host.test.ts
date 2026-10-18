import { describe, it, expect, afterEach, vi } from "vitest";
import { Host } from "./Host.js";
import type {
  HostChange,
  HostInfo,
  HostInfoInput,
  HostLifecycleReport,
  HostProvider,
} from "./Host.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";

const BROWSER_INFO: HostInfo = {
  runtime: "browser",
  os: "unknown",
  appVersion: undefined,
  appBuild: undefined,
  runtimeVersion: undefined,
};

const UNKNOWN_LIFECYCLE = {
  activity: "unknown",
  visibility: "unknown",
  focus: "unknown",
};

function provider(info: Partial<HostInfoInput>): { info: HostInfoInput } {
  return {
    info: {
      runtime: "electron",
      os: "macos",
      ...info,
    },
  };
}

/**
 * A page whose visibility and focus the test drives. `document` and `window`
 * are stubbed with `EventTarget`s, so `_connect` reads and listens to them the
 * way it does in a browser.
 */
function stubPage(initial?: { hidden?: boolean; focused?: boolean }): {
  hide(hidden: boolean): void;
  blur(): void;
  focus(): void;
} {
  let hidden = initial?.hidden ?? false;
  const focused = initial?.focused ?? true;
  const page = new EventTarget();
  Object.defineProperty(page, "visibilityState", {
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(page, "hasFocus", { value: () => focused });
  const frame = new EventTarget();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", frame);
  return {
    hide(value: boolean) {
      hidden = value;
      page.dispatchEvent(new Event("visibilitychange"));
    },
    blur() {
      frame.dispatchEvent(new Event("blur"));
    },
    focus() {
      frame.dispatchEvent(new Event("focus"));
    },
  };
}

/** Connect a host to a bus and a scene-pause call the test can read. */
function connect(host: Host): {
  bus: EventBus<EngineEvents>;
  boundary: ErrorBoundary;
  syncScenes: ReturnType<typeof vi.fn>;
  log: string[];
} {
  const bus = new EventBus<EngineEvents>();
  const boundary = new ErrorBoundary(new Logger({ level: LogLevel.Error }));
  bus._setErrorBoundary(boundary);
  const syncScenes = vi.fn();
  const log: string[] = [];
  bus.on("host:active", ({ active }) => log.push(`active:${String(active)}`));
  bus.on("host:lifecycle", ({ lifecycle }) =>
    log.push(
      `lifecycle:${lifecycle.activity}/${lifecycle.visibility}/${lifecycle.focus}`,
    ),
  );
  host._connect({ events: bus, syncScenes });
  // The page read that `_connect` makes is one change of its own; a test that
  // asserts on later events starts from an empty log.
  log.length = 0;
  return { bus, boundary, syncScenes, log };
}

/** A provider that reports `lifecycle` at attach and whatever `report` sends. */
function lifecycleProvider(lifecycle?: HostLifecycleReport): {
  provider: HostProvider;
  report(state: HostLifecycleReport): void;
  stopped(): number;
} {
  let push: ((state: HostLifecycleReport) => void) | undefined;
  let stops = 0;
  return {
    provider: {
      info: { runtime: "electron", os: "macos" },
      ...(lifecycle === undefined ? {} : { lifecycle }),
      watchLifecycle(report) {
        push = report;
        return () => {
          stops++;
        };
      },
    },
    report(state) {
      push?.(state);
    },
    stopped: () => stops,
  };
}

describe("Host", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the browser values with no provider attached", () => {
    const host = new Host();

    expect(host.info).toEqual({
      runtime: "browser",
      os: "unknown",
      appVersion: undefined,
      appBuild: undefined,
      runtimeVersion: undefined,
    });
    expect(Object.isFrozen(host.info)).toBe(true);
  });

  it("reports an unknown operating system while the user agent names one", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
      userAgentData: { platform: "Android" },
      platform: "Linux armv8l",
    });

    expect(new Host().info.os).toBe("unknown");
  });

  it("copies the provider's info and freezes the copy", () => {
    const host = new Host();
    const source = {
      runtime: "capacitor",
      os: "ios",
      appVersion: "1.4.0",
      appBuild: "42",
      extra: "dropped",
    } as unknown as HostInfoInput;

    host.attach({ info: source });
    (source as { runtime: string }).runtime = "changed";

    expect(host.info).toEqual({
      runtime: "capacitor",
      os: "ios",
      appVersion: "1.4.0",
      appBuild: "42",
      runtimeVersion: undefined,
    });
    expect("extra" in host.info).toBe(false);
    expect(Object.isFrozen(host.info)).toBe(true);
  });

  it("fills in the versions an adapter leaves out", () => {
    const host = new Host();

    host.attach({ info: { runtime: "electron", os: "macos" } });

    expect(host.info).toStrictEqual({
      runtime: "electron",
      os: "macos",
      appVersion: undefined,
      appBuild: undefined,
      runtimeVersion: undefined,
    });
    expect("appVersion" in host.info).toBe(true);
  });

  it("rejects an empty version an adapter does supply", () => {
    const host = new Host();

    expect(() =>
      host.attach({ info: { runtime: "electron", os: "macos", appBuild: "" } }),
    ).toThrow(
      'Host.attach: info.appBuild must be a non-empty string or undefined, got "".',
    );
  });

  it("reads each info field once and stores the value it checked", () => {
    const host = new Host();
    const reads: Record<string, number> = {};
    // Each field answers a valid value on its first read and an invalid one
    // on every later read.
    const counted = (name: string, first: unknown, later: unknown) => ({
      enumerable: true,
      get(): unknown {
        const count = (reads[name] ?? 0) + 1;
        reads[name] = count;
        return count === 1 ? first : later;
      },
    });
    const info = Object.defineProperties(
      {},
      {
        runtime: counted("runtime", "electron", ""),
        os: counted("os", "macos", "amiga"),
        appVersion: counted("appVersion", "1.0.0", ""),
        appBuild: counted("appBuild", "42", 7),
        runtimeVersion: counted("runtimeVersion", "44.7.0", ""),
      },
    ) as HostInfoInput;

    host.attach({ info });

    expect(host.info).toEqual({
      runtime: "electron",
      os: "macos",
      appVersion: "1.0.0",
      appBuild: "42",
      runtimeVersion: "44.7.0",
    });
    expect(reads).toEqual({
      runtime: 1,
      os: 1,
      appVersion: 1,
      appBuild: 1,
      runtimeVersion: 1,
    });
  });

  it("returns the same info object between reads", () => {
    const host = new Host();

    expect(host.info).toBe(host.info);
    host.attach(provider({ runtime: "electron" }));
    expect(host.info).toBe(host.info);
  });

  it("restores the browser values when the returned function runs", () => {
    const host = new Host();
    const detach = host.attach(provider({ runtime: "electron" }));

    detach();

    expect(host.info.runtime).toBe("browser");
    expect(host.info.os).toBe("unknown");
  });

  it("detaches only the provider it was returned for", () => {
    const host = new Host();
    const detachFirst = host.attach(provider({ runtime: "first" }));
    detachFirst();
    host.attach(provider({ runtime: "second" }));

    detachFirst();

    expect(host.info.runtime).toBe("second");
  });

  it("detaches only its own attach when the same provider attaches again", () => {
    const host = new Host();
    const same = provider({ runtime: "same" });
    const detachFirst = host.attach(same);
    detachFirst();
    host.attach(same);

    detachFirst();

    expect(host.info.runtime).toBe("same");
  });

  it("refuses a second provider and keeps the first", () => {
    const host = new Host();
    host.attach(provider({ runtime: "electron" }));

    expect(() => host.attach(provider({ runtime: "capacitor" }))).toThrow(
      'Host.attach: a host provider is already attached (runtime "electron"). ' +
        "An engine takes one host adapter.",
    );
    expect(host.info.runtime).toBe("electron");
  });

  it.each([
    [
      "an empty runtime",
      { runtime: "" },
      'Host.attach: info.runtime must be a non-empty string, got "".',
    ],
    [
      "a numeric runtime",
      { runtime: 42 },
      "Host.attach: info.runtime must be a non-empty string, got 42.",
    ],
    [
      "an unlisted operating system",
      { os: "amiga" },
      "Host.attach: info.os must be one of macos, windows, linux, ios, " +
        'android, unknown, got "amiga".',
    ],
    [
      "an empty app version",
      { appVersion: "" },
      'Host.attach: info.appVersion must be a non-empty string or undefined, got "".',
    ],
    [
      "a numeric app build",
      { appBuild: 7 },
      "Host.attach: info.appBuild must be a non-empty string or undefined, got 7.",
    ],
    [
      "an empty runtime version",
      { runtimeVersion: "" },
      "Host.attach: info.runtimeVersion must be a non-empty string or " +
        'undefined, got "".',
    ],
  ])("rejects %s", (_label, field, message) => {
    const host = new Host();
    const defaults = host.info;

    expect(() =>
      host.attach(provider(field as unknown as Partial<HostInfoInput>)),
    ).toThrow(message);
    expect(host.info).toBe(defaults);
    expect(host.info).toEqual({
      runtime: "browser",
      os: "unknown",
      appVersion: undefined,
      appBuild: undefined,
      runtimeVersion: undefined,
    });
  });
});

describe("Host lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports three unknown states and an active host before anything connects", () => {
    const host = new Host();

    expect(host.lifecycle).toEqual(UNKNOWN_LIFECYCLE);
    expect(host.active).toBe(true);
    expect(host.activeWhenUnfocused).toBe(false);
    expect(Object.isFrozen(host.lifecycle)).toBe(true);
    expect(host.lifecycle).toBe(host.lifecycle);
  });

  it("reads the page when it connects", () => {
    stubPage();
    const visible = new Host();
    connect(visible);
    expect(visible.lifecycle).toEqual({
      activity: "unknown",
      visibility: "visible",
      focus: "focused",
    });
    expect(visible.active).toBe(true);

    vi.unstubAllGlobals();
    stubPage({ hidden: true });
    const hiddenHost = new Host();
    connect(hiddenHost);
    expect(hiddenHost.lifecycle.visibility).toBe("hidden");
    expect(hiddenHost.active).toBe(false);

    vi.unstubAllGlobals();
    stubPage({ focused: false });
    const unfocused = new Host();
    connect(unfocused);
    expect(unfocused.lifecycle.focus).toBe("unfocused");
    expect(unfocused.active).toBe(false);
  });

  it("reads nothing and listens to nothing without a page", () => {
    const host = new Host();
    const { log, syncScenes } = connect(host);

    expect(host.lifecycle).toEqual(UNKNOWN_LIFECYCLE);
    expect(host.active).toBe(true);
    expect(log).toEqual([]);
    expect(syncScenes).not.toHaveBeenCalled();
  });

  it("follows the page's visibility and reports a repeat once", () => {
    const page = stubPage();
    const host = new Host();
    const { log } = connect(host);

    page.hide(true);
    expect(host.lifecycle.visibility).toBe("hidden");
    expect(host.active).toBe(false);
    expect(log).toEqual(["active:false", "lifecycle:unknown/hidden/focused"]);

    page.hide(true);
    expect(log).toHaveLength(2);

    page.hide(false);
    expect(host.active).toBe(true);
    expect(log).toEqual([
      "active:false",
      "lifecycle:unknown/hidden/focused",
      "active:true",
      "lifecycle:unknown/visible/focused",
    ]);
  });

  it("follows the window's focus events and reports a repeat once", () => {
    const page = stubPage();
    const host = new Host();
    const { log } = connect(host);

    page.blur();
    expect(host.lifecycle.focus).toBe("unfocused");
    expect(host.active).toBe(false);
    expect(log).toHaveLength(2);

    page.blur();
    expect(log).toHaveLength(2);

    page.focus();
    expect(host.lifecycle.focus).toBe("focused");
    expect(host.active).toBe(true);
    expect(log).toHaveLength(4);
  });

  it("keeps an unfocused window active when the setting says so", () => {
    const page = stubPage();
    const host = new Host();
    const { log } = connect(host);
    host.activeWhenUnfocused = true;

    page.blur();
    expect(host.active).toBe(true);
    expect(log).toEqual(["lifecycle:unknown/visible/unfocused"]);

    const before = host.lifecycle;
    host.activeWhenUnfocused = false;
    expect(host.active).toBe(false);
    expect(host.lifecycle).toBe(before);
    expect(log).toEqual([
      "lifecycle:unknown/visible/unfocused",
      "active:false",
    ]);

    host.activeWhenUnfocused = false;
    expect(log).toHaveLength(2);
  });

  it("dispatches engine packages, then scenes, then game code", () => {
    const page = stubPage();
    const host = new Host();
    const order: string[] = [];
    const bus = new EventBus<EngineEvents>();
    host._connect({
      events: bus,
      syncScenes: () => order.push("scenes"),
    });
    host._observe((change) => {
      order.push("first");
      expect(host.active).toBe(change.active);
      expect(change).toEqual({
        lifecycle: {
          activity: "unknown",
          visibility: "hidden",
          focus: "focused",
        },
        previous: {
          activity: "unknown",
          visibility: "visible",
          focus: "focused",
        },
        active: false,
        wasActive: true,
      } satisfies HostChange);
    });
    host._observe(() => order.push("second"));
    bus.on("host:active", () => order.push("event:active"));
    bus.on("host:lifecycle", () => order.push("event:lifecycle"));

    page.hide(true);

    expect(order).toEqual([
      "first",
      "second",
      "scenes",
      "event:active",
      "event:lifecycle",
    ]);
  });

  it("calls its observers without a bus or a scene manager", () => {
    const host = new Host();
    const seen: boolean[] = [];
    host._observe(({ active }) => seen.push(active));

    host.attach(lifecycleProvider({ activity: "inactive" }).provider);

    expect(seen).toEqual([false]);
    expect(host.active).toBe(false);
  });

  it("removes one observer per call, once", () => {
    const host = new Host();
    const first = vi.fn();
    const second = vi.fn();
    const unobserve = host._observe(first);
    host._observe(second);

    unobserve();
    unobserve();
    host.attach(lifecycleProvider({ activity: "inactive" }).provider);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("ends the sequence at a throwing observer and recovers on the next change", () => {
    const host = new Host();
    const { log, syncScenes } = connect(host);
    const adapter = lifecycleProvider({ activity: "active" });
    host.attach(adapter.provider);
    log.length = 0;
    syncScenes.mockClear();
    let thrown = false;
    host._observe(() => {
      if (thrown) return;
      thrown = true;
      throw new Error("observer failed");
    });
    const later = vi.fn();
    host._observe(later);

    expect(() => adapter.report({ activity: "inactive" })).toThrow(
      "observer failed",
    );

    expect(host.active).toBe(false);
    expect(later).not.toHaveBeenCalled();
    expect(syncScenes).not.toHaveBeenCalled();
    expect(log).toEqual([]);

    adapter.report({ activity: "active" });
    expect(later).toHaveBeenCalledOnce();
    expect(syncScenes).toHaveBeenCalledOnce();
    expect(log).toEqual(["active:true", "lifecycle:active/unknown/unknown"]);
  });

  it("attributes a throwing event handler and skips the detailed event", () => {
    const host = new Host();
    const { bus, boundary, log } = connect(host);
    bus.on("host:active", () => {
      throw new Error("handler failed");
    });

    expect(() =>
      host.attach(lifecycleProvider({ activity: "inactive" }).provider),
    ).toThrow("handler failed");

    expect(log).toEqual(["active:false"]);
    expect(boundary.getCallbackErrors()).toHaveLength(1);
    expect(boundary.getCallbackErrors()[0]).toMatchObject({
      kind: "Event bus handler",
      event: "host:active",
    });
  });

  it("reports each change with its own state when a handler changes the host again", () => {
    const page = stubPage();
    const host = new Host();
    const { bus } = connect(host);
    const seen: string[] = [];
    // Game code that takes the window's focus away while the change that
    // hid the page is still being dispatched.
    bus.on("host:active", () => page.blur());
    bus.on("host:lifecycle", ({ lifecycle, previous }) =>
      seen.push(
        `${previous.visibility}/${previous.focus} to ` +
          `${lifecycle.visibility}/${lifecycle.focus}`,
      ),
    );

    page.hide(true);

    expect(seen).toEqual([
      "hidden/focused to hidden/unfocused",
      "visible/focused to hidden/focused",
    ]);
    expect(host.lifecycle).toMatchObject({
      visibility: "hidden",
      focus: "unfocused",
    });
  });

  it("takes the adapter's fields and leaves the page the rest", () => {
    stubPage();
    const host = new Host();
    const { log } = connect(host);
    const adapter = lifecycleProvider({ activity: "inactive" });

    host.attach(adapter.provider);

    expect(host.lifecycle).toEqual({
      activity: "inactive",
      visibility: "visible",
      focus: "focused",
    });
    expect(host.active).toBe(false);
    expect(log).toEqual(["active:false", "lifecycle:inactive/visible/focused"]);
  });

  it("hides the page's value for a field the adapter reports as unknown", () => {
    stubPage({ focused: false });
    const host = new Host();
    connect(host);
    expect(host.active).toBe(false);

    host.attach(lifecycleProvider({ focus: "unknown" }).provider);

    expect(host.lifecycle.focus).toBe("unknown");
    expect(host.active).toBe(true);
  });

  it("ignores a page event for a field the adapter owns until it detaches", () => {
    const page = stubPage();
    const host = new Host();
    const { log } = connect(host);
    const detach = host.attach(
      lifecycleProvider({ visibility: "visible" }).provider,
    );
    expect(log).toEqual([]);

    page.hide(true);
    expect(host.lifecycle.visibility).toBe("visible");
    expect(host.active).toBe(true);
    expect(log).toEqual([]);

    detach();
    expect(host.lifecycle.visibility).toBe("hidden");
    expect(host.active).toBe(false);
    expect(log).toEqual(["active:false", "lifecycle:unknown/hidden/focused"]);
  });

  it("applies a report as a partial update and flips active once per real change", () => {
    const page = stubPage();
    const host = new Host();
    const { log } = connect(host);
    const adapter = lifecycleProvider({ activity: "active" });
    host.attach(adapter.provider);

    adapter.report({ activity: "inactive" });
    expect(host.lifecycle).toEqual({
      activity: "inactive",
      visibility: "visible",
      focus: "focused",
    });
    adapter.report({ activity: "inactive" });
    page.hide(true);
    page.hide(false);
    adapter.report({ activity: "active" });

    expect(log.filter((entry) => entry.startsWith("active:"))).toEqual([
      "active:false",
      "active:true",
    ]);
  });

  it("combines a report made from inside watchLifecycle with the attach", () => {
    stubPage();
    const host = new Host();
    const { log } = connect(host);

    host.attach({
      info: { runtime: "electron", os: "unknown" },
      lifecycle: { activity: "active" },
      watchLifecycle(report) {
        report({ activity: "inactive", visibility: "hidden" });
        return () => {};
      },
    });

    expect(host.lifecycle).toEqual({
      activity: "inactive",
      visibility: "hidden",
      focus: "focused",
    });
    expect(log).toEqual(["active:false", "lifecycle:inactive/hidden/focused"]);
  });

  it.each([
    [7, "Host.attach: lifecycle must be an object, got 7."],
    [null, "Host.attach: lifecycle must be an object, got null."],
    [
      { activity: "asleep" },
      'Host.attach: lifecycle.activity must be one of active, inactive, unknown, got "asleep".',
    ],
    [
      { visibility: 1 },
      "Host.attach: lifecycle.visibility must be one of visible, hidden, unknown, got 1.",
    ],
    [
      { focus: "" },
      'Host.attach: lifecycle.focus must be one of focused, unfocused, unknown, got "".',
    ],
  ])("rejects the lifecycle %j and attaches nothing", (lifecycle, message) => {
    const host = new Host();
    const watchLifecycle = vi.fn(() => () => {});

    expect(() =>
      host.attach({
        info: { runtime: "electron", os: "unknown" },
        lifecycle: lifecycle as HostLifecycleReport,
        watchLifecycle,
      }),
    ).toThrow(message);

    expect(host.info).toEqual(BROWSER_INFO);
    expect(host.lifecycle).toEqual(UNKNOWN_LIFECYCLE);
    expect(watchLifecycle).not.toHaveBeenCalled();
  });

  it.each([
    [null, "HostProvider.watchLifecycle: report must be an object, got null."],
    [
      { visibility: "gone" },
      'HostProvider.watchLifecycle: report.visibility must be one of visible, hidden, unknown, got "gone".',
    ],
    [
      { activity: "inactive", focus: "x" },
      'HostProvider.watchLifecycle: report.focus must be one of focused, unfocused, unknown, got "x".',
    ],
  ])("rejects the report %j and changes nothing", (state, message) => {
    const host = new Host();
    const adapter = lifecycleProvider({ activity: "active" });
    host.attach(adapter.provider);

    expect(() => adapter.report(state as HostLifecycleReport)).toThrow(message);

    expect(host.lifecycle.activity).toBe("active");
  });

  it("attaches nothing when watchLifecycle throws, and takes a later provider", () => {
    const host = new Host();

    expect(() =>
      host.attach({
        info: { runtime: "electron", os: "unknown" },
        watchLifecycle() {
          throw new Error("bridge is gone");
        },
      }),
    ).toThrow("bridge is gone");
    expect(host.info).toEqual(BROWSER_INFO);

    host.attach(lifecycleProvider({ activity: "inactive" }).provider);
    expect(host.lifecycle.activity).toBe("inactive");
  });

  it("stops the reports once and falls back to the page on detach", () => {
    stubPage();
    const host = new Host();
    const { log } = connect(host);
    const adapter = lifecycleProvider({ activity: "inactive" });
    const detach = host.attach(adapter.provider);
    log.length = 0;

    detach();
    detach();

    expect(adapter.stopped()).toBe(1);
    expect(host.lifecycle).toEqual({
      activity: "unknown",
      visibility: "visible",
      focus: "focused",
    });
    expect(log).toEqual(["active:true", "lifecycle:unknown/visible/focused"]);

    adapter.report({ activity: "inactive" });
    adapter.report(null as unknown as HostLifecycleReport);
    expect(host.lifecycle.activity).toBe("unknown");
    expect(log).toHaveLength(2);
  });

  it("stops reading the page and refuses a later attach once disposed", () => {
    const page = stubPage();
    const host = new Host();
    const { log, syncScenes } = connect(host);
    const observer = vi.fn();
    const adapter = lifecycleProvider({ activity: "inactive" });
    const detach = host.attach(adapter.provider);
    const unobserve = host._observe(observer);
    observer.mockClear();
    log.length = 0;
    syncScenes.mockClear();

    host._dispose();
    host._dispose();

    expect(adapter.stopped()).toBe(1);
    expect(host.info).toEqual(BROWSER_INFO);
    page.hide(true);
    page.blur();
    adapter.report({ activity: "active" });
    detach();
    unobserve();
    host._observe(observer)();

    expect(observer).not.toHaveBeenCalled();
    expect(syncScenes).not.toHaveBeenCalled();
    expect(log).toEqual([]);
    expect(() => host.attach(provider({ runtime: "capacitor" }))).toThrow(
      "Host.attach: the engine has been destroyed. A host adapter attaches during install.",
    );
  });
});

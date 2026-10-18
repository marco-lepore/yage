import type { EngineEvents, EventBus } from "./EventBus.js";

/** Operating system a host reports. `"unknown"` when the host cannot observe it. */
export type HostOS =
  | "macos"
  | "windows"
  | "linux"
  | "ios"
  | "android"
  | "unknown";

const HOST_OS_VALUES: readonly string[] = [
  "macos",
  "windows",
  "linux",
  "ios",
  "android",
  "unknown",
];

/**
 * What a host adapter states about itself when it attaches. A version the host
 * has no authoritative value for is left out.
 */
export interface HostInfoInput {
  /** The adapter's own name for the application that runs the page. */
  readonly runtime: string;
  readonly os: HostOS;
  /** The app's version, when the host has an authoritative value. */
  readonly appVersion?: string;
  /** The app's build number, when the host has an authoritative value. */
  readonly appBuild?: string;
  /** The version of the host runtime, when the host has an authoritative value. */
  readonly runtimeVersion?: string;
}

/** Which application runs the game's page, and what it knows about itself. */
export interface HostInfo {
  /** `"browser"` unless a host adapter attached. Adapters name themselves. */
  readonly runtime: string;
  readonly os: HostOS;
  /** The app's version, when the host has an authoritative value. */
  readonly appVersion: string | undefined;
  /** The app's build number, when the host has an authoritative value. */
  readonly appBuild: string | undefined;
  /** The version of the host runtime, when the host has an authoritative value. */
  readonly runtimeVersion: string | undefined;
}

/** Whether the operating system runs the app in the foreground and delivers input to it. */
export type HostActivity = "active" | "inactive" | "unknown";

/** Whether the player can see the game's page. */
export type HostVisibility = "visible" | "hidden" | "unknown";

/** Whether the game's window has keyboard focus. */
export type HostFocus = "focused" | "unfocused" | "unknown";

/** What the host reports about itself. `"unknown"` marks a state it cannot observe. */
export interface HostLifecycle {
  readonly activity: HostActivity;
  readonly visibility: HostVisibility;
  readonly focus: HostFocus;
}

/** What a host adapter reports. A field left out keeps the adapter's last value for it. */
export interface HostLifecycleReport {
  readonly activity?: HostActivity;
  readonly visibility?: HostVisibility;
  readonly focus?: HostFocus;
}

/** One change of host state, as engine packages receive it. */
export interface HostChange {
  readonly lifecycle: HostLifecycle;
  readonly previous: HostLifecycle;
  readonly active: boolean;
  readonly wasActive: boolean;
}

/** What a host adapter hands to the engine. */
export interface HostProvider {
  readonly info: HostInfoInput;
  /** The adapter's state at attach. Read once, like `info`. */
  readonly lifecycle?: HostLifecycleReport;
  /**
   * Called once by `attach`. The adapter calls `report` on every later change
   * of its state and returns the function that stops the reports.
   */
  watchLifecycle?(report: (state: HostLifecycleReport) => void): () => void;
}

/** Whether a host can perform an operation at all. */
export type HostSupport = "supported" | "unsupported" | "unknown";

/** Whether the player or the operating system allows an operation. */
export type HostPermission = "granted" | "denied" | "prompt" | "unknown";

/**
 * What a page with no host adapter reports. A browser's own values for the
 * operating system follow the user agent, which an emulated device changes, so
 * the operating system stays `"unknown"` until a host states it.
 */
const BROWSER_HOST_INFO: HostInfo = Object.freeze({
  runtime: "browser",
  os: "unknown" as const,
  appVersion: undefined,
  appBuild: undefined,
  runtimeVersion: undefined,
});

/** What a host that observes nothing reports. */
const UNKNOWN_LIFECYCLE: HostLifecycle = Object.freeze({
  activity: "unknown" as const,
  visibility: "unknown" as const,
  focus: "unknown" as const,
});

const VERSION_FIELDS = ["appVersion", "appBuild", "runtimeVersion"] as const;
type VersionField = (typeof VERSION_FIELDS)[number];

const LIFECYCLE_FIELDS: readonly {
  readonly key: "activity" | "visibility" | "focus";
  readonly values: readonly string[];
}[] = [
  { key: "activity", values: ["active", "inactive", "unknown"] },
  { key: "visibility", values: ["visible", "hidden", "unknown"] },
  { key: "focus", values: ["focused", "unfocused", "unknown"] },
];

/** The three fields as the attached adapter has reported them so far. */
interface MutableLifecycleReport {
  activity?: HostActivity;
  visibility?: HostVisibility;
  focus?: HostFocus;
}

/**
 * Reads the values a native bridge supplied, so every field is checked before
 * any of it reaches the engine. Each field is read once: the value stored is
 * the value that passed its check.
 */
function copyHostInfo(info: HostInfoInput): HostInfo {
  const runtime: unknown = info.runtime;
  if (typeof runtime !== "string" || runtime.length === 0) {
    throw new Error(
      `Host.attach: info.runtime must be a non-empty string, got ${JSON.stringify(runtime)}.`,
    );
  }
  const os: unknown = info.os;
  if (!HOST_OS_VALUES.includes(os as string)) {
    throw new Error(
      `Host.attach: info.os must be one of macos, windows, linux, ios, android, unknown, got ${JSON.stringify(os)}.`,
    );
  }
  const versions: Record<VersionField, string | undefined> = {
    appVersion: undefined,
    appBuild: undefined,
    runtimeVersion: undefined,
  };
  for (const field of VERSION_FIELDS) {
    const value: unknown = info[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Host.attach: info.${field} must be a non-empty string or undefined, got ${JSON.stringify(value)}.`,
      );
    }
    versions[field] = value;
  }
  return Object.freeze({ runtime, os: os as HostOS, ...versions });
}

/**
 * Reads the three fields a native bridge supplied. Every field is checked
 * before any of them is applied, and a field left out is absent from the
 * result rather than present as `undefined`.
 */
function readLifecycleReport(
  value: unknown,
  prefix: string,
): MutableLifecycleReport {
  if (value === null || typeof value !== "object") {
    throw new Error(
      `${prefix} must be an object, got ${JSON.stringify(value)}.`,
    );
  }
  const source = value as Record<string, unknown>;
  const read: MutableLifecycleReport = {};
  for (const field of LIFECYCLE_FIELDS) {
    const reported: unknown = source[field.key];
    if (reported === undefined) continue;
    if (!field.values.includes(reported as string)) {
      throw new Error(
        `${prefix}.${field.key} must be one of ${field.values.join(", ")}, got ${JSON.stringify(reported)}.`,
      );
    }
    read[field.key] = reported as never;
  }
  return read;
}

/**
 * Which application runs the game, whether it is active, and the one place a
 * host adapter attaches.
 *
 * Every engine has one, registered under `HostKey` and reachable as
 * `engine.host`. A page with no adapter reports the browser values: the page's
 * own visibility and the focus of its window.
 */
export class Host {
  private attached: HostProvider | undefined;
  private current: HostInfo = BROWSER_HOST_INFO;
  private state: HostLifecycle = UNKNOWN_LIFECYCLE;
  private activeFlag = true;
  private unfocusedCountsAsActive = false;

  /** The fields the attached adapter owns. The page supplies the rest. */
  private adapter: MutableLifecycleReport = {};
  private pageVisibility: HostVisibility = "unknown";
  private pageFocus: HostFocus = "unknown";

  private wiring:
    | {
        readonly events: EventBus<EngineEvents>;
        readonly syncScenes: () => void;
      }
    | undefined;
  private readonly observers: Array<(change: HostChange) => void> = [];
  private readonly domCleanup: Array<() => void> = [];
  private stopWatching: (() => void) | undefined;
  private disposed = false;

  /** The attached provider's info, or the browser defaults. */
  get info(): HostInfo {
    return this.current;
  }

  /** Activity, visibility and focus as the host reports them. */
  get lifecycle(): HostLifecycle {
    return this.state;
  }

  /** `false` while the app is inactive, the page is hidden, or the window is unfocused. */
  get active(): boolean {
    return this.activeFlag;
  }

  /**
   * Keep the host active while its window is unfocused. Default: `false`, so a
   * window the player has clicked away from counts as inactive.
   */
  get activeWhenUnfocused(): boolean {
    return this.unfocusedCountsAsActive;
  }

  set activeWhenUnfocused(value: boolean) {
    if (this.unfocusedCountsAsActive === value) return;
    this.unfocusedCountsAsActive = value;
    this.apply();
  }

  /**
   * Attach a host adapter's provider. Returns the function that detaches it.
   * An engine takes one provider at a time. `info` and `lifecycle` are read
   * once, here, and `watchLifecycle` is called once.
   */
  attach(provider: HostProvider): () => void {
    if (this.disposed) {
      throw new Error(
        "Host.attach: the engine has been destroyed. A host adapter attaches during install.",
      );
    }
    if (this.attached !== undefined) {
      throw new Error(
        `Host.attach: a host provider is already attached (runtime ${JSON.stringify(this.current.runtime)}). An engine takes one host adapter.`,
      );
    }
    const info = copyHostInfo(provider.info);
    const initial: MutableLifecycleReport =
      provider.lifecycle === undefined
        ? {}
        : readLifecycleReport(provider.lifecycle, "Host.attach: lifecycle");

    // Reports made from inside `watchLifecycle` belong to the attach: they are
    // collected over the initial state and applied with it as one change.
    let committed = false;
    const report = (state: HostLifecycleReport): void => {
      if (!committed) {
        Object.assign(
          initial,
          readLifecycleReport(state, "HostProvider.watchLifecycle: report"),
        );
        return;
      }
      if (this.attached !== provider || this.disposed) return;
      Object.assign(
        this.adapter,
        readLifecycleReport(state, "HostProvider.watchLifecycle: report"),
      );
      this.apply();
    };
    const stop = provider.watchLifecycle?.(report);

    this.attached = provider;
    this.current = info;
    this.adapter = initial;
    this.stopWatching = stop;
    committed = true;
    this.apply();

    return () => {
      if (this.attached !== provider) return;
      this.detachProvider();
    };
  }

  /**
   * Wire the engine's event bus and scene pause, and start reading the page.
   * `EventBus` has no `EngineContext` of its own, so `Engine` calls this once
   * after both are constructed.
   * @internal
   */
  _connect(wiring: {
    readonly events: EventBus<EngineEvents>;
    readonly syncScenes: () => void;
  }): void {
    this.wiring = wiring;
    if (typeof document === "undefined") return;

    const onVisibilityChange = (): void => {
      this.pageVisibility = readPageVisibility();
      this.apply();
    };
    const onBlur = (): void => {
      this.pageFocus = "unfocused";
      this.apply();
    };
    const onFocus = (): void => {
      this.pageFocus = "focused";
      this.apply();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    this.domCleanup.push(
      () =>
        document.removeEventListener("visibilitychange", onVisibilityChange),
      () => window.removeEventListener("blur", onBlur),
      () => window.removeEventListener("focus", onFocus),
    );

    this.pageVisibility = readPageVisibility();
    // The events are the source of focus from here on: a window whose focus
    // moved into a child frame reports `hasFocus()` differently from the
    // `blur` event every input mechanism acts on.
    this.pageFocus = document.hasFocus() ? "focused" : "unfocused";
    this.apply();
  }

  /**
   * Observe every change of host state, ahead of the scene pause and the two
   * events. Engine packages register here; game code uses `host:active` and
   * `host:lifecycle`. Returns the function that removes the observer.
   * @internal
   */
  _observe(observer: (change: HostChange) => void): () => void {
    if (this.disposed) return () => {};
    this.observers.push(observer);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const index = this.observers.indexOf(observer);
      if (index !== -1) this.observers.splice(index, 1);
    };
  }

  /**
   * Stop reading the page, detach the provider and stop all dispatch. State
   * stays readable. Called by `Engine.destroy()`.
   * @internal
   */
  _dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.domCleanup) cleanup();
    this.domCleanup.length = 0;
    this.detachProvider();
    this.observers.length = 0;
    this.wiring = undefined;
  }

  /** Drop the attached provider and fall back to the page for every field. */
  private detachProvider(): void {
    if (this.attached === undefined) return;
    const stop = this.stopWatching;
    this.attached = undefined;
    this.stopWatching = undefined;
    this.adapter = {};
    this.current = BROWSER_HOST_INFO;
    stop?.();
    this.apply();
  }

  /**
   * Fold the page's and the adapter's values into one state, and dispatch the
   * change when there is one. A throwing step ends the sequence with the new
   * state already stored, so the consumers that read it come back in line on
   * the next change.
   */
  private apply(): void {
    const previous = this.state;
    const wasActive = this.activeFlag;
    const next: HostLifecycle = {
      activity: this.adapter.activity ?? "unknown",
      visibility: this.adapter.visibility ?? this.pageVisibility,
      focus: this.adapter.focus ?? this.pageFocus,
    };
    const changed =
      next.activity !== previous.activity ||
      next.visibility !== previous.visibility ||
      next.focus !== previous.focus;
    const active =
      next.activity !== "inactive" &&
      next.visibility !== "hidden" &&
      (this.unfocusedCountsAsActive || next.focus !== "unfocused");
    if (!changed && active === wasActive) return;

    if (changed) this.state = Object.freeze(next);
    this.activeFlag = active;
    if (this.disposed) return;

    const change: HostChange = {
      lifecycle: this.state,
      previous,
      active,
      wasActive,
    };
    for (const observer of [...this.observers]) observer(change);
    if (active !== wasActive) {
      this.wiring?.syncScenes();
      this.wiring?.events.emit("host:active", { active });
    }
    if (changed) {
      this.wiring?.events.emit("host:lifecycle", {
        lifecycle: change.lifecycle,
        previous,
      });
    }
  }
}

/** The page's visibility. Anything but `"hidden"` is a page the player sees. */
function readPageVisibility(): HostVisibility {
  return document.visibilityState === "hidden" ? "hidden" : "visible";
}

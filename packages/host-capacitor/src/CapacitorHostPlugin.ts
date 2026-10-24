import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { HostKey, ServiceKey } from "@yagejs/core";
import type {
  EngineContext,
  HostActivity,
  HostInfoInput,
  HostLifecycleReport,
  HostVisibility,
  Plugin,
} from "@yagejs/core";
import type { HostDisplay } from "@yagejs/renderer/api";
import type { InputManager } from "@yagejs/input";
import { createDisplay } from "./display.js";
import type { CapacitorDisplay } from "./display.js";
import { reportFor } from "./lifecycle.js";
import type { AppEvent, CapacitorPlatform } from "./lifecycle.js";
import { requireCapacitorShell, requirePlugin } from "./shell.js";

// @yagejs/renderer owns this well-known service id. Re-declared here so the
// adapter adds no runtime dependency on the renderer or on PixiJS.
const HostDisplayKey = new ServiceKey<HostDisplay>("hostDisplay");
// @yagejs/input owns this well-known service id. Re-declared here so a game
// without input still installs the adapter; Back then takes Android's action.
const InputManagerKey = new ServiceKey<InputManager>("inputManager");

/** The code the Android Back button arrives as. */
const BACK_KEY = "BrowserBack";

/** The report the adapter collects while it is still reading the app. */
interface PendingReport {
  activity?: HostActivity;
  visibility?: HostVisibility;
}

/**
 * A version the app states, or nothing. An app whose project leaves the key
 * out reads an empty string on iOS and no value at all on Android, and a
 * version the host cannot state is left out of its identity.
 */
function stated(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Connects the engine to the Capacitor app that runs the game: the app's
 * identity, whether it is active and visible, the screen orientation lock,
 * and the Android Back button as a key the game binds.
 */
export class CapacitorHostPlugin implements Plugin {
  readonly name = "host";
  readonly version = "1.0.0";

  private destroyed = false;
  private context: EngineContext | undefined;
  private platform: CapacitorPlatform = "ios";
  private readonly handles: PluginListenerHandle[] = [];
  private pending: PendingReport = {};
  private report: ((state: HostLifecycleReport) => void) | undefined;
  private detach: (() => void) | undefined;
  private display: CapacitorDisplay | undefined;

  async install(context: EngineContext): Promise<void> {
    if (this.destroyed) {
      throw new Error(
        "CapacitorHostPlugin.install: this instance belongs to a destroyed " +
          "engine. Construct a new CapacitorHostPlugin for each engine.",
      );
    }
    requireCapacitorShell("CapacitorHostPlugin.install", "plugin");
    const platform = Capacitor.getPlatform();
    if (platform !== "ios" && platform !== "android") {
      throw new Error(
        `CapacitorHostPlugin.install: this adapter runs on Capacitor's ios ` +
          `and android platforms, got ${JSON.stringify(platform)}.`,
      );
    }
    requirePlugin("CapacitorHostPlugin.install", "App", "@capacitor/app");
    requirePlugin(
      "CapacitorHostPlugin.install",
      "ScreenOrientation",
      "@capacitor/screen-orientation",
    );
    this.platform = platform;
    this.context = context;

    const registered = await this.listen(
      App.addListener("appStateChange", (state) => {
        this.take({ name: "appStateChange", isActive: state.isActive });
      }),
      App.addListener("pause", () => {
        this.take({ name: "pause" });
      }),
      App.addListener("resume", () => {
        this.take({ name: "resume" });
      }),
      ...(platform === "android"
        ? [
            App.addListener("backButton", () => {
              this.back();
            }),
          ]
        : []),
    );
    if (!registered) return;

    const info = await App.getInfo();
    if (this.destroyed) return;
    const state = await App.getState();
    if (this.destroyed) return;

    // The native side answers after the events it has already sent. On iOS
    // its reading of the activity is therefore the newer one. On Android it
    // reads a flag that a resume sets and a stop clears, which a pause leaves
    // set, so an activity an event already reported stands.
    if (platform === "ios" || this.pending.activity === undefined) {
      this.pending.activity = state.isActive ? "active" : "inactive";
    }
    const appVersion = stated(info.version);
    const appBuild = stated(info.build);
    const identity: HostInfoInput = {
      runtime: "capacitor",
      os: platform,
      ...(appVersion === undefined ? {} : { appVersion }),
      ...(appBuild === undefined ? {} : { appBuild }),
    };
    this.detach = context.resolve(HostKey).attach({
      info: identity,
      lifecycle: this.pending,
      watchLifecycle: (report) => {
        this.report = report;
        return () => {
          this.report = undefined;
        };
      },
    });
    this.display = createDisplay(platform);
    context.register(HostDisplayKey, this.display);
  }

  onDestroy(): void {
    this.destroyed = true;
    this.detach?.();
    this.detach = undefined;
    this.report = undefined;
    this.removeHandles();
    this.display?.settleAll();
    this.display = undefined;
    this.context = undefined;
  }

  /**
   * Register the plugin's listeners and report whether the install may go
   * on. An engine destroyed while a registration is in flight gets the
   * handles that registration produced removed here.
   */
  private async listen(
    ...registrations: readonly Promise<PluginListenerHandle>[]
  ): Promise<boolean> {
    for (const registration of registrations) {
      const handle = await registration;
      if (this.destroyed) {
        void handle.remove();
        continue;
      }
      this.handles.push(handle);
    }
    if (this.destroyed) this.removeHandles();
    return !this.destroyed;
  }

  /**
   * Drop every listener. A rejected removal is reported by the runtime: the
   * engine is already gone, so there is nothing left to tell.
   */
  private removeHandles(): void {
    for (const handle of this.handles.splice(0)) void handle.remove();
  }

  /** What one native event says, to the engine or into the pending report. */
  private take(event: AppEvent): void {
    if (this.destroyed) return;
    const next = reportFor(this.platform, event);
    if (this.report !== undefined) {
      this.report(next);
      return;
    }
    Object.assign(this.pending, next);
  }

  /**
   * The Android Back button. A game that bound the key reads it like any
   * other key; one that did not gets what Android itself does at the root of
   * an app, which keeps the game where it was.
   */
  private back(): void {
    if (this.destroyed) return;
    const input = this.context?.tryResolve(InputManagerKey);
    if (input !== undefined && input.getActionsForKey(BACK_KEY).length > 0) {
      input.fireKeyDown(BACK_KEY);
      input.fireKeyUp(BACK_KEY);
      return;
    }
    void App.minimizeApp();
  }
}

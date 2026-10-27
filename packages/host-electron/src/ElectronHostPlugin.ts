import { HostKey, ServiceKey } from "@yagejs/core";
import type { EngineContext, HostSupport, Plugin } from "@yagejs/core";
import type {
  HostDisplay,
  HostFullscreen,
  HostOrientation,
} from "@yagejs/renderer/api";
import { FULLSCREEN_SETTLE_MS } from "./protocol.js";
import type { BridgeState } from "./protocol.js";
import { requireHostBridge } from "./bridge.js";
import type { HostBridge } from "./bridge.js";

// @yagejs/renderer owns this well-known service id. Re-declared here so the
// adapter adds no runtime dependency on the renderer or on PixiJS.
const HostDisplayKey = new ServiceKey<HostDisplay>("hostDisplay");

/** The page's screen, or `undefined` where the page has none. */
function screenOf(): Screen | undefined {
  return (globalThis as { screen?: Screen }).screen;
}

/** What the adapter holds until the window has answered its first read. */
const UNREAD: BridgeState = {
  revision: -1,
  lifecycle: { activity: "unknown", visibility: "hidden", focus: "unfocused" },
  fullscreen: { fullscreenable: false, active: false },
};

/**
 * Connects the engine to the Electron window that runs the game: the app's
 * identity, whether the window is active, visible and focused, and fullscreen
 * as the window does it, whatever started it.
 * @experimental
 */
export class ElectronHostPlugin implements Plugin {
  readonly name = "host";
  readonly version = "1.0.0";

  private destroyed = false;
  private state: BridgeState = UNREAD;
  private stopState: (() => void) | undefined;
  private detach: (() => void) | undefined;
  private report: ((state: BridgeState["lifecycle"]) => void) | undefined;
  private displayChanged: (() => void) | undefined;
  private stopOrientation: (() => void) | undefined;

  async install(context: EngineContext): Promise<void> {
    if (this.destroyed) {
      throw new Error(
        "ElectronHostPlugin.install: this instance belongs to a destroyed " +
          "engine. Construct a new ElectronHostPlugin for each engine.",
      );
    }
    const bridge = requireHostBridge("ElectronHostPlugin.install", "plugin");
    const stopState = bridge.onState((state) => {
      this.take(state);
    });
    this.stopState = stopState;
    const started = await bridge.start();
    if (this.destroyed) {
      stopState();
      this.stopState = undefined;
      return;
    }
    this.take(started.state);
    this.detach = context.resolve(HostKey).attach({
      info: {
        runtime: "electron",
        os: started.info.os,
        appVersion: started.info.appVersion,
        runtimeVersion: started.info.runtimeVersion,
      },
      lifecycle: {
        activity: this.state.lifecycle.activity,
        visibility: this.state.lifecycle.visibility,
        focus: this.state.lifecycle.focus,
      },
      watchLifecycle: (report) => {
        this.report = report;
        return () => {
          this.report = undefined;
        };
      },
    });
    context.register(HostDisplayKey, this.display(bridge));
  }

  onDestroy(): void {
    this.destroyed = true;
    this.stopState?.();
    this.stopState = undefined;
    this.detach?.();
    this.detach = undefined;
    this.report = undefined;
    this.stopOrientation?.();
    this.stopOrientation = undefined;
    this.displayChanged = undefined;
  }

  /**
   * Keep the newest snapshot and report what it changed. A snapshot with a
   * revision the adapter already holds says nothing new, whenever it arrives.
   */
  private take(state: BridgeState): void {
    if (this.destroyed || state.revision <= this.state.revision) return;
    this.state = state;
    this.report?.({ ...state.lifecycle });
    this.displayChanged?.();
  }

  private display(bridge: HostBridge): HostDisplay {
    const newest = (): BridgeState => this.state;
    const fullscreen: HostFullscreen = {
      get support(): HostSupport {
        return newest().fullscreen.fullscreenable ? "supported" : "unsupported";
      },
      get active(): boolean {
        return newest().fullscreen.active;
      },
      request: () => this.setFullscreen(bridge, true),
      exit: () => this.setFullscreen(bridge, false),
    };
    const orientation: HostOrientation = {
      get current(): OrientationType | null {
        return screenOf()?.orientation?.type ?? null;
      },
      lockSupport: "unsupported",
      // The renderer asks only while `lockSupport` reads "supported" or
      // "unknown", so reaching this means something else called it.
      lock: (): Promise<void> =>
        Promise.reject(
          new Error(
            "ElectronHostPlugin: a desktop window cannot lock the screen orientation.",
          ),
        ),
      unlock: (): Promise<void> => Promise.resolve(),
    };
    return {
      fullscreen,
      orientation,
      watch: (changed: () => void): (() => void) => {
        this.displayChanged = changed;
        const screenOrientation = screenOf()?.orientation;
        screenOrientation?.addEventListener("change", changed);
        const stop = (): void => {
          screenOrientation?.removeEventListener("change", changed);
        };
        this.stopOrientation = stop;
        return () => {
          this.displayChanged = undefined;
          this.stopOrientation = undefined;
          stop();
        };
      },
    };
  }

  private async setFullscreen(
    bridge: HostBridge,
    active: boolean,
  ): Promise<void> {
    const result = await bridge.setFullscreen(active);
    this.take(result.state);
    if (result.done) return;
    throw new Error(
      `ElectronHostPlugin: the window did not ${active ? "enter" : "leave"} ` +
        `fullscreen within ${FULLSCREEN_SETTLE_MS} ms.`,
    );
  }
}

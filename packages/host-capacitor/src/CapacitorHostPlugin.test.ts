import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Engine, HostKey, ServiceKey, createTestEngine } from "@yagejs/core";
import type { EngineContext, HostInfo, Plugin } from "@yagejs/core";
import { InputManager, InputManagerKey } from "@yagejs/input";
import { HostDisplayKey } from "@yagejs/renderer/api";
import type { HostDisplay } from "@yagejs/renderer/api";
import { CapacitorHostPlugin } from "./CapacitorHostPlugin.js";
import {
  app,
  emitApp,
  holdApp,
  listenerCount,
  resetCapacitor,
  shell,
} from "./test/fakeCapacitor.js";
import type { AppCall } from "./test/fakeCapacitor.js";

/** Reads the host identity and the display the engine saw while it started. */
class HostReader implements Plugin {
  readonly name = "host-reader";
  readonly version = "1.0.0";
  info: HostInfo | undefined;
  display: HostDisplay | undefined;
  private context!: EngineContext;

  install(context: EngineContext): void {
    this.context = context;
  }

  onStart(): void {
    this.info = this.context.resolve(HostKey).info;
    this.display = this.context.tryResolve(HostDisplayKey);
  }
}

/** Registers one input manager, as `InputPlugin` does. */
class InputHolder implements Plugin {
  readonly name = "input";
  readonly version = "1.0.0";
  readonly manager = new InputManager();

  install(context: EngineContext): void {
    context.register(InputManagerKey, this.manager);
  }
}

/** A context that records what the plugin asked of it. */
function fakeContext(): EngineContext {
  return {
    resolve: vi.fn(),
    register: vi.fn(),
    tryResolve: vi.fn(),
  } as unknown as EngineContext;
}

function start(
  plugin: CapacitorHostPlugin,
  extra: readonly Plugin[] = [],
): Promise<Engine> {
  return createTestEngine({ debug: false }, [...extra, plugin]);
}

afterEach(() => {
  resetCapacitor();
  vi.restoreAllMocks();
});

describe("CapacitorHostPlugin", () => {
  it("is the engine's host plugin and reports the app's identity", async () => {
    const plugin = new CapacitorHostPlugin();
    expect(plugin.name).toBe("host");
    expect((plugin as { dependencies?: unknown }).dependencies).toBeUndefined();
    const reader = new HostReader();
    const engine = await start(plugin, [reader]);
    expect(reader.info).toEqual({
      runtime: "capacitor",
      os: "ios",
      appVersion: "1.0",
      appBuild: "1",
      runtimeVersion: undefined,
    });
    await engine.destroy();
  });

  it("leaves out a version the app does not state", async () => {
    app.info = { name: "Fake", id: "dev.yage.fake", version: "", build: null };
    const engine = await start(new CapacitorHostPlugin());
    expect(engine.host.info.appVersion).toBeUndefined();
    expect(engine.host.info.appBuild).toBeUndefined();
    await engine.destroy();
  });

  it("says what a browser page is missing", async () => {
    shell.native = false;
    const engine = new Engine({ debug: false });
    engine.use(new CapacitorHostPlugin());
    await expect(engine.start()).rejects.toThrow(
      "CapacitorHostPlugin.install: this page is not running inside a " +
        "Capacitor app. Leave this plugin out of a browser build.",
    );
    expect(engine.host.info.runtime).toBe("browser");
    expect(engine.context.has(HostDisplayKey)).toBe(false);
    expect(listenerCount("appStateChange")).toBe(0);
    await engine.destroy();
  });

  it("names a platform it does not run on", async () => {
    shell.platform = "electron";
    const engine = new Engine({ debug: false });
    engine.use(new CapacitorHostPlugin());
    await expect(engine.start()).rejects.toThrow(
      "CapacitorHostPlugin.install: this adapter runs on Capacitor's ios " +
        'and android platforms, got "electron".',
    );
    await engine.destroy();
  });

  it("names each plugin the app has to carry", async () => {
    shell.plugins = new Set(["Filesystem"]);
    const first = new Engine({ debug: false });
    first.use(new CapacitorHostPlugin());
    await expect(first.start()).rejects.toThrow(
      "CapacitorHostPlugin.install: the @capacitor/app plugin is not in " +
        "this app.",
    );
    await first.destroy();

    shell.plugins = new Set(["App"]);
    const second = new Engine({ debug: false });
    second.use(new CapacitorHostPlugin());
    await expect(second.start()).rejects.toThrow(
      "CapacitorHostPlugin.install: the @capacitor/screen-orientation " +
        "plugin is not in this app.",
    );
    await second.destroy();
  });

  it("reports the app's state at attach and leaves visibility to the page", async () => {
    app.state = { isActive: false };
    const engine = await start(new CapacitorHostPlugin());
    expect(engine.host.lifecycle.activity).toBe("inactive");
    expect(engine.host.lifecycle.visibility).toBe("unknown");
    await engine.destroy();
  });

  it("follows the iOS events", async () => {
    const engine = await start(new CapacitorHostPlugin());
    expect(engine.host.lifecycle.activity).toBe("active");

    emitApp("appStateChange", { isActive: false });
    expect(engine.host.lifecycle.activity).toBe("inactive");
    emitApp("pause");
    expect(engine.host.lifecycle.visibility).toBe("hidden");
    expect(engine.host.active).toBe(false);

    emitApp("resume");
    expect(engine.host.lifecycle.visibility).toBe("visible");
    emitApp("appStateChange", { isActive: true });
    expect(engine.host.lifecycle.activity).toBe("active");
    await engine.destroy();
  });

  it("follows the Android events", async () => {
    shell.platform = "android";
    const engine = await start(new CapacitorHostPlugin());

    emitApp("pause");
    expect(engine.host.lifecycle.activity).toBe("inactive");
    emitApp("appStateChange", { isActive: false });
    expect(engine.host.lifecycle).toMatchObject({
      activity: "inactive",
      visibility: "hidden",
    });
    emitApp("appStateChange", { isActive: true });
    expect(engine.host.lifecycle).toMatchObject({
      activity: "active",
      visibility: "visible",
    });
    emitApp("resume");
    expect(engine.host.lifecycle).toMatchObject({
      activity: "active",
      visibility: "visible",
    });
    await engine.destroy();
  });

  it("keeps what an event said before the app answered, except the activity", async () => {
    app.state = { isActive: true };
    const release = holdApp("getState");
    const plugin = new CapacitorHostPlugin();
    const engine = new Engine({ debug: false });
    engine.use(plugin);
    const starting = engine.start();
    await vi.waitFor(() => expect(listenerCount("pause")).toBe(1));
    emitApp("pause");
    emitApp("appStateChange", { isActive: false });
    release();
    await starting;

    expect(engine.host.lifecycle.visibility).toBe("hidden");
    expect(engine.host.lifecycle.activity).toBe("active");
    await engine.destroy();
  });

  it("attaches nothing when the engine goes while it reads the app", async () => {
    const calls: AppCall[] = [
      "addListener:appStateChange",
      "addListener:pause",
      "addListener:resume",
      "addListener:backButton",
      "getInfo",
      "getState",
    ];
    for (const call of calls) {
      resetCapacitor();
      // The Back listener belongs to Android, so that round plays an
      // Android app and the rest an iOS one.
      shell.platform = call === "addListener:backButton" ? "android" : "ios";
      const release = holdApp(call);
      const plugin = new CapacitorHostPlugin();
      const context = fakeContext();
      const installing = plugin.install(context);
      await vi.waitFor(() => expect(app.started).toContain(call));
      plugin.onDestroy();
      release();
      await installing;

      expect(context.resolve, call).not.toHaveBeenCalled();
      expect(context.register, call).not.toHaveBeenCalled();
      expect(listenerCount("appStateChange"), call).toBe(0);
      expect(listenerCount("pause"), call).toBe(0);
      expect(listenerCount("resume"), call).toBe(0);
      expect(listenerCount("backButton"), call).toBe(0);
    }
  });

  it("removes every listener once and ignores what arrives after", async () => {
    const engine = await start(new CapacitorHostPlugin());
    await engine.destroy();
    expect(app.removed).toEqual(["appStateChange", "pause", "resume"]);
    expect(listenerCount("appStateChange")).toBe(0);
  });

  it("refuses to install again once its engine is destroyed", async () => {
    const plugin = new CapacitorHostPlugin();
    const engine = await start(plugin);
    await engine.destroy();

    await expect(plugin.install(fakeContext())).rejects.toThrowError(
      "CapacitorHostPlugin.install: this instance belongs to a destroyed " +
        "engine. Construct a new CapacitorHostPlugin for each engine.",
    );
  });

  it("ignores an event that arrives after the engine is gone", async () => {
    const engine = await start(new CapacitorHostPlugin());
    const changed = app.listeners.get("appStateChange")?.values().next()
      .value as (payload: unknown) => void;
    await engine.destroy();
    expect(() => changed({ isActive: false })).not.toThrow();
    // A destroyed engine reads the page again, which states no activity.
    expect(engine.host.lifecycle.activity).toBe("unknown");
  });

  it("leaves a failed removal to the runtime to report", async () => {
    // Vitest's own listener fails the run on an unhandled rejection, so it is
    // set aside while this test collects the one it expects.
    const others = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);
    onTestFinished(() => {
      process.off("unhandledRejection", listener);
      for (const other of others) process.on("unhandledRejection", other);
    });
    app.removeRejects = new Set(["pause"]);
    const engine = await start(new CapacitorHostPlugin());

    engine.destroy();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toHaveLength(1);
    expect((unhandled[0] as Error).message).toBe(
      "fake: removing the pause listener failed.",
    );
  });

  it("gives each engine on one page its own listeners", async () => {
    const first = await start(new CapacitorHostPlugin());
    const second = await start(new CapacitorHostPlugin());
    expect(listenerCount("pause")).toBe(2);
    await first.destroy();
    expect(listenerCount("pause")).toBe(1);
    expect(second.host.info.runtime).toBe("capacitor");
    await second.destroy();
  });

  it("listens for the Back button on Android only", async () => {
    const ios = await start(new CapacitorHostPlugin());
    expect(listenerCount("backButton")).toBe(0);
    expect(app.listeners.size).toBe(3);
    await ios.destroy();

    shell.platform = "android";
    const android = await start(new CapacitorHostPlugin());
    expect(listenerCount("backButton")).toBe(1);
    expect(app.listeners.size).toBe(4);
    await android.destroy();
  });

  it("delivers Back as a key the game bound", async () => {
    shell.platform = "android";
    const input = new InputHolder();
    input.manager.setActionMap({ back: ["Escape", "BrowserBack"] });
    const pressed: string[] = [];
    input.manager.onAction("back", (name) => pressed.push(name));
    const engine = await start(new CapacitorHostPlugin(), [input]);

    emitApp("backButton", { canGoBack: false });
    expect(pressed).toEqual(["back"]);
    expect(input.manager.isPressed("back")).toBe(false);
    expect(app.minimizeCalls).toBe(0);
    await engine.destroy();
  });

  it("moves the app to the background when nothing is bound to Back", async () => {
    shell.platform = "android";
    const input = new InputHolder();
    input.manager.setActionMap({ jump: ["Space"] });
    const engine = await start(new CapacitorHostPlugin(), [input]);
    emitApp("backButton", { canGoBack: false });
    expect(app.minimizeCalls).toBe(1);
    await engine.destroy();
  });

  it("moves the app to the background in a game with no input", async () => {
    shell.platform = "android";
    const engine = await start(new CapacitorHostPlugin());
    emitApp("backButton", { canGoBack: false });
    expect(app.minimizeCalls).toBe(1);
    await engine.destroy();
  });

  it("does nothing for a Back press after the engine is gone", async () => {
    shell.platform = "android";
    const engine = await start(new CapacitorHostPlugin());
    const press = app.listeners.get("backButton")?.values().next().value as (
      payload: unknown,
    ) => void;
    await engine.destroy();
    press({ canGoBack: false });
    expect(app.minimizeCalls).toBe(0);
  });

  it("registers the display the renderer resolves", async () => {
    const reader = new HostReader();
    const engine = await start(new CapacitorHostPlugin(), [reader]);
    expect(reader.display?.orientation?.lockSupport).toBe("supported");
    expect(engine.context.resolve(HostDisplayKey)).toBe(reader.display);
    expect(
      engine.context.resolve(new ServiceKey<HostDisplay>("hostDisplay")),
    ).toBe(reader.display);
    await engine.destroy();
  });
});

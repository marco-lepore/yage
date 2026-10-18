import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine, HostKey, createTestEngine } from "@yagejs/core";
import type { EngineContext, HostInfo, Plugin } from "@yagejs/core";
import { HostDisplayKey } from "@yagejs/renderer/api";
import type { HostDisplay } from "@yagejs/renderer/api";
import { ElectronHostPlugin } from "./ElectronHostPlugin.js";
import { HOST_BRIDGE_PROTOCOL } from "./protocol.js";
import type { BridgeState } from "./protocol.js";

/** A snapshot with the fields a case cares about and defaults for the rest. */
function stateAt(
  revision: number,
  overrides: Partial<{
    activity: BridgeState["lifecycle"]["activity"];
    visibility: BridgeState["lifecycle"]["visibility"];
    focus: BridgeState["lifecycle"]["focus"];
    fullscreenable: boolean;
    active: boolean;
  }> = {},
): BridgeState {
  return {
    revision,
    lifecycle: {
      activity: overrides.activity ?? "active",
      visibility: overrides.visibility ?? "visible",
      focus: overrides.focus ?? "focused",
    },
    fullscreen: {
      fullscreenable: overrides.fullscreenable ?? true,
      active: overrides.active ?? false,
    },
  };
}

/** A shell on the page, with the hooks a test needs to drive it. */
function fakeBridge(
  options: {
    protocol?: unknown;
    started?: BridgeState;
    startDelay?: Promise<void>;
    fullscreen?: (active: boolean) => {
      done: boolean;
      state: BridgeState;
    };
  } = {},
) {
  const listeners = new Set<(state: BridgeState) => void>();
  const bridge = {
    protocol: options.protocol ?? HOST_BRIDGE_PROTOCOL,
    start: async () => {
      await options.startDelay;
      return {
        info: {
          os: "macos" as const,
          appVersion: "1.2.3",
          runtimeVersion: "44.7.0",
        },
        state: options.started ?? stateAt(1),
      };
    },
    onState: (listener: (state: BridgeState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFullscreen: (active: boolean) =>
      Promise.resolve(
        options.fullscreen?.(active) ?? {
          done: true,
          state: stateAt(9, { active }),
        },
      ),
    saves: {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    },
  };
  (globalThis as { __yageHost__?: unknown }).__yageHost__ = bridge;
  return {
    bridge,
    listeners,
    send(state: BridgeState): void {
      for (const listener of [...listeners]) listener(state);
    },
  };
}

/** Reads the host identity the engine saw while the plugins started. */
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

afterEach(() => {
  delete (globalThis as { __yageHost__?: unknown }).__yageHost__;
  vi.restoreAllMocks();
});

async function start(
  plugin: ElectronHostPlugin,
  extra: readonly Plugin[] = [],
): Promise<Engine> {
  return createTestEngine({ debug: false }, [...extra, plugin]);
}

describe("ElectronHostPlugin", () => {
  it("is the engine's host plugin and reports the window's identity", async () => {
    fakeBridge();
    const plugin = new ElectronHostPlugin();
    expect(plugin.name).toBe("host");
    expect((plugin as { dependencies?: unknown }).dependencies).toBeUndefined();
    const reader = new HostReader();
    const engine = await start(plugin, [reader]);
    expect(reader.info).toEqual({
      runtime: "electron",
      os: "macos",
      appVersion: "1.2.3",
      appBuild: undefined,
      runtimeVersion: "44.7.0",
    });
    await engine.destroy();
  });

  it("keeps the newest snapshot, whenever it arrives", async () => {
    let release = (): void => {};
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shell = fakeBridge({ started: stateAt(1), startDelay: delay });
    const plugin = new ElectronHostPlugin();
    const engine = new Engine({ debug: false });
    engine.use(plugin);
    const starting = engine.start();
    await Promise.resolve();
    shell.send(stateAt(5, { focus: "unfocused" }));
    release();
    await starting;

    expect(engine.host.lifecycle).toEqual({
      activity: "active",
      visibility: "visible",
      focus: "unfocused",
    });

    shell.send(stateAt(6, { visibility: "hidden" }));
    expect(engine.host.lifecycle.visibility).toBe("hidden");
    shell.send(stateAt(6, { visibility: "visible" }));
    shell.send(stateAt(2, { visibility: "visible" }));
    expect(engine.host.lifecycle.visibility).toBe("hidden");
    await engine.destroy();
  });

  it("registers the display the renderer resolves", async () => {
    const shell = fakeBridge({
      started: stateAt(1, { fullscreenable: false }),
    });
    const plugin = new ElectronHostPlugin();
    const engine = await start(plugin);
    const display = engine.context.resolve(HostDisplayKey);
    expect(display.fullscreen?.support).toBe("unsupported");
    expect(display.fullscreen?.active).toBe(false);
    shell.send(stateAt(2, { fullscreenable: true, active: true }));
    expect(display.fullscreen?.support).toBe("supported");
    expect(display.fullscreen?.active).toBe(true);
    await engine.destroy();
  });

  it("asks the window for fullscreen and settles on what it did", async () => {
    const shell = fakeBridge({
      fullscreen: (active) => ({ done: true, state: stateAt(4, { active }) }),
    });
    const plugin = new ElectronHostPlugin();
    const engine = await start(plugin);
    const display = engine.context.resolve(HostDisplayKey);
    const changed = vi.fn();
    const stopWatch = display.watch(changed);

    await display.fullscreen!.request();
    expect(display.fullscreen!.active).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);

    shell.send(stateAt(5, { active: true }));
    expect(changed).toHaveBeenCalledTimes(2);

    stopWatch();
    await engine.destroy();
  });

  it("reports a window that did not change within the bound", async () => {
    fakeBridge({
      fullscreen: () => ({ done: false, state: stateAt(4, { active: false }) }),
    });
    const plugin = new ElectronHostPlugin();
    const engine = await start(plugin);
    const display = engine.context.resolve(HostDisplayKey);
    await expect(display.fullscreen!.request()).rejects.toThrowError(
      "ElectronHostPlugin: the window did not enter fullscreen within 3000 ms.",
    );
    await expect(display.fullscreen!.exit()).rejects.toThrowError(
      "ElectronHostPlugin: the window did not leave fullscreen within 3000 ms.",
    );
    await engine.destroy();
  });

  it("reads the orientation and refuses to lock it", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("screen", {
      orientation: {
        type: "landscape-primary",
        addEventListener: (event: string, handler: () => void) =>
          listeners.set(event, handler),
        removeEventListener: (event: string) => listeners.delete(event),
      },
    });
    fakeBridge();
    const plugin = new ElectronHostPlugin();
    const engine = await start(plugin);
    const display = engine.context.resolve(HostDisplayKey);
    expect(display.orientation?.lockSupport).toBe("unsupported");
    expect(display.orientation?.current).toBe("landscape-primary");

    const changed = vi.fn();
    const stopWatch = display.watch(changed);
    expect(listeners.has("change")).toBe(true);
    listeners.get("change")!();
    expect(changed).toHaveBeenCalledTimes(1);
    stopWatch();
    expect(listeners.has("change")).toBe(false);

    await expect(display.orientation!.lock("portrait")).rejects.toThrowError(
      "ElectronHostPlugin: a desktop window cannot lock the screen orientation.",
    );
    await expect(display.orientation!.unlock()).resolves.toBeUndefined();

    vi.stubGlobal("screen", undefined);
    expect(display.orientation?.current).toBeNull();
    await engine.destroy();
    vi.unstubAllGlobals();
  });

  it("stops the start when the page has no shell", async () => {
    const engine = new Engine({ debug: false });
    engine.use(new ElectronHostPlugin());
    await expect(engine.start()).rejects.toThrowError(
      /ElectronHostPlugin\.install: no YAGE host bridge on this page\./,
    );
    expect(engine.host.info.runtime).toBe("browser");
    expect(engine.context.has(HostDisplayKey)).toBe(false);
  });

  it("attaches nothing when the engine is destroyed while it reads", async () => {
    let release = (): void => {};
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shell = fakeBridge({ startDelay: delay });
    const plugin = new ElectronHostPlugin();
    plugin.onDestroy();
    const context = {
      resolve: vi.fn(),
      register: vi.fn(),
    } as unknown as EngineContext;
    const installing = plugin.install(context);
    release();
    await installing;
    expect(context.resolve).not.toHaveBeenCalled();
    expect(context.register).not.toHaveBeenCalled();
    expect(shell.listeners.size).toBe(0);
  });

  it("ignores a snapshot that arrives after the engine is gone", async () => {
    const shell = fakeBridge();
    const plugin = new ElectronHostPlugin();
    const engine = await start(plugin);
    await engine.destroy();
    expect(shell.listeners.size).toBe(0);
    expect(() => shell.send(stateAt(20, { focus: "unfocused" }))).not.toThrow();
  });

  it("gives each engine on one page its own listener", async () => {
    const shell = fakeBridge();
    const first = await start(new ElectronHostPlugin());
    const second = await start(new ElectronHostPlugin());
    expect(shell.listeners.size).toBe(2);
    expect(first.host.info.runtime).toBe("electron");
    expect(second.host.info.runtime).toBe("electron");
    await first.destroy();
    expect(shell.listeners.size).toBe(1);
    await second.destroy();
    expect(shell.listeners.size).toBe(0);
  });
});

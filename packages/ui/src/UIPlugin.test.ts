import { describe, it, expect } from "vitest";
import type {
  EngineContext,
  Scene,
  SceneHooks,
  ServiceKey,
  System,
  SystemScheduler,
} from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import { UIPlugin } from "./UIPlugin.js";
import { UIFocusRelayoutSystem, UILayoutSystem } from "./UILayoutSystem.js";
import { FloatingOverlaySystem } from "./FloatingOverlaySystem.js";
import { UIFocusSystem } from "./UIFocusSystem.js";
import { UIFocusScope } from "./focus/UIFocusScope.js";
import { UIFocusStack, UIFocusStackKey } from "./focus/UIFocusStack.js";
import { MockContainer } from "./test-helpers.js";
import {
  getUIDefaultTextStyle,
  setUIDefaultTextStyle,
} from "./text-defaults.js";
import { getUIFocusStyle, setUIFocusStyle } from "./internal/focus-outline.js";

// install() resolves the error boundary and scene hook registry, then loads
// Yoga. This stub is enough to exercise the text-style lifecycle.
const stubContext = {
  tryResolve: () => undefined,
  resolve: () => ({ register: () => () => {} }),
} as unknown as EngineContext;

/** A scene with nothing but the scoped registry the plugin writes into. */
function makeScene(): Scene {
  const scoped = new Map<string, unknown>();
  return {
    registerScoped: <T>(key: ServiceKey<T>, value: T) => {
      scoped.set(key.id, value);
    },
    _resolveScoped: <T>(key: ServiceKey<T>): T | undefined =>
      scoped.get(key.id) as T | undefined,
  } as unknown as Scene;
}

/** Install the plugin and hand back the scene hooks it registered. */
async function installed(): Promise<SceneHooks> {
  let hooks: SceneHooks | undefined;
  const context = {
    tryResolve: () => undefined,
    resolve: () => ({
      register: (registered: SceneHooks) => {
        hooks = registered;
        return () => {};
      },
    }),
  } as unknown as EngineContext;
  await new UIPlugin().install(context);
  if (hooks === undefined) throw new Error("UIPlugin registered no hooks.");
  return hooks;
}

describe("UIPlugin default text style lifecycle", () => {
  it("sets the UI default on install and restores the prior value on destroy", async () => {
    setUIDefaultTextStyle({ fontFamily: "Prev" });
    const plugin = new UIPlugin({ defaultTextStyle: { fontFamily: "UI" } });

    await plugin.install(stubContext);
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "UI" });

    plugin.onDestroy();
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "Prev" });

    setUIDefaultTextStyle(undefined);
  });

  it("restores to undefined when there was no prior default", async () => {
    setUIDefaultTextStyle(undefined);
    const plugin = new UIPlugin({ defaultTextStyle: { fontFamily: "UI" } });

    await plugin.install(stubContext);
    expect(getUIDefaultTextStyle()).toMatchObject({ fontFamily: "UI" });

    plugin.onDestroy();
    expect(getUIDefaultTextStyle()).toBeUndefined();
  });
});

describe("UIPlugin focus style lifecycle", () => {
  const PRIOR = { color: 0x111111 };

  it.each([
    ["sets the style it was given", PRIOR, { color: 0x33ff88, width: 4 }],
    ["sets a style over none", undefined, { color: 0x33ff88 }],
    ["names no outline for a game that gave no style", PRIOR, undefined],
    ["takes null as naming no outline", PRIOR, null],
  ])(
    "%s on install and restores the prior style on destroy",
    async (_n, prior, focusStyle) => {
      setUIFocusStyle(prior);
      const plugin = new UIPlugin(
        focusStyle === undefined ? {} : { focusStyle },
      );

      await plugin.install(stubContext);
      expect(getUIFocusStyle()).toEqual(focusStyle ?? undefined);

      plugin.onDestroy();
      expect(getUIFocusStyle()).toEqual(prior);
      setUIFocusStyle(undefined);
    },
  );
});

describe("UIPlugin focus stacks", () => {
  it("gives each scene entering the stack a focus stack of its own", async () => {
    const hooks = await installed();
    const first = makeScene();
    const second = makeScene();

    hooks.beforeEnter?.(first);
    hooks.beforeEnter?.(second);

    expect(first._resolveScoped(UIFocusStackKey)).toBeInstanceOf(UIFocusStack);
    expect(first._resolveScoped(UIFocusStackKey)).not.toBe(
      second._resolveScoped(UIFocusStackKey),
    );
    expect(makeScene()._resolveScoped(UIFocusStackKey)).toBeUndefined();
  });

  it("destroys the stack when the scene exits", async () => {
    const hooks = await installed();
    const scene = makeScene();
    hooks.beforeEnter?.(scene);
    const stack = scene._resolveScoped(UIFocusStackKey)!;
    const container = new MockContainer();
    stack._register(
      new UIFocusScope(
        {
          displayObject: container as unknown as DisplayContainer,
          roots: () => [],
        },
        {},
      ),
    );
    stack._observe();
    stack._drive(null);
    expect(stack.active).not.toBeNull();

    hooks.afterExit?.(scene);
    stack._observe();
    stack._drive(null);

    expect(stack.active).toBeNull();
  });
});

describe("UIPlugin systems", () => {
  it("registers layout, floating, focus and the layout after focus, in frame order", () => {
    const systems: System[] = [];
    const scheduler = {
      add: (system: System) => systems.push(system),
    } as unknown as SystemScheduler;

    new UIPlugin().registerSystems(scheduler);

    expect(systems.map((system) => system.constructor)).toEqual([
      UILayoutSystem,
      FloatingOverlaySystem,
      UIFocusSystem,
      UIFocusRelayoutSystem,
    ]);
    expect(systems.map((system) => system.priority)).toEqual([
      200, 201, 202, 203,
    ]);
  });
});

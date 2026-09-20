import { beforeEach, describe, expect, it, vi } from "vitest";
import { Phase, SceneManagerKey } from "@yagejs/core";
import type { EngineContext, Scene } from "@yagejs/core";
import {
  requestHoverFocus,
  takePointerRequest,
} from "./focus/pointer-request.js";
import type { UIFocusScope } from "./focus/UIFocusScope.js";
import { UIFocusStack, UIFocusStackKey } from "./focus/UIFocusStack.js";
import { TestNode, scopeOver } from "./focus/test-nodes.js";
import { UIFocusSystem } from "./UIFocusSystem.js";

/** One scene holding one focus scope over one focusable row. */
function sceneWithScope(): {
  scene: Scene;
  stack: UIFocusStack;
  scope: UIFocusScope;
  panel: TestNode;
} {
  const panel = new TestNode();
  panel.add(new TestNode()).focusable();
  const scope = scopeOver(panel);
  const stack = new UIFocusStack();
  stack._register(scope);
  return { scene: sceneOf(stack), stack, scope, panel };
}

function sceneOf(stack: UIFocusStack | undefined): Scene {
  return {
    tryResolveScoped: <T>(key: { id: string }): T | undefined =>
      key === (UIFocusStackKey as unknown as { id: string })
        ? (stack as unknown as T)
        : undefined,
  } as unknown as Scene;
}

interface ContextOptions {
  input?: unknown;
}

function makeContext(
  scenes: Scene[],
  options: ContextOptions = {},
): {
  context: EngineContext;
  activeScenesReads: () => number;
} {
  let activeReads = 0;
  const context = {
    resolve: (key: { id: string }) => {
      if (key === (SceneManagerKey as unknown as { id: string })) {
        return {
          all: scenes,
          get activeScenes() {
            activeReads += 1;
            return [];
          },
        };
      }
      throw new Error(`unexpected resolve of "${key.id}"`);
    },
    tryResolve: (key: { id: string }) =>
      key.id === "inputManager" ? options.input : undefined,
  } as unknown as EngineContext;
  return { context, activeScenesReads: () => activeReads };
}

/** A system registered against `scenes`. */
function systemOver(
  scenes: Scene[],
  options: ContextOptions = {},
): UIFocusSystem {
  const system = new UIFocusSystem();
  system.onRegister(makeContext(scenes, options).context);
  return system;
}

beforeEach(() => {
  // The pointer request cell is module-level.
  takePointerRequest();
  vi.restoreAllMocks();
});

describe("UIFocusSystem", () => {
  it("runs after layout and the floating overlay", () => {
    const system = new UIFocusSystem();
    expect(system.phase).toBe(Phase.LateUpdate);
    expect(system.priority).toBe(202);
  });

  it("drives only the topmost scene holding a shown scope, past one with no stack", () => {
    const bottom = sceneWithScope();
    const top = sceneWithScope();
    const system = systemOver([bottom.scene, top.scene, sceneOf(undefined)]);

    system.update();

    expect(top.stack.active).toBe(top.scope);
    expect(bottom.stack.active).toBeNull();
    expect(bottom.scope.hasInput).toBe(false);
  });

  it("drives the scene below when the one above shows nothing", () => {
    const bottom = sceneWithScope();
    const top = sceneWithScope();
    top.panel.visible = false;
    const system = systemOver([bottom.scene, top.scene]);

    system.update();

    expect(bottom.stack.active).toBe(bottom.scope);
    expect(top.stack.active).toBeNull();
  });

  it("reads the whole scene stack, so a paused scene is still driven", () => {
    const paused = sceneWithScope();
    const system = new UIFocusSystem();
    const { context, activeScenesReads } = makeContext([paused.scene]);
    system.onRegister(context);

    system.update();

    expect(paused.stack.active).toBe(paused.scope);
    expect(activeScenesReads()).toBe(0);
  });

  it("observes a scene whose stack it does not drive", () => {
    const bottom = sceneWithScope();
    const top = sceneWithScope();
    const system = systemOver([bottom.scene, top.scene]);
    system.update();

    // The bottom scene's menu is shown while the scene above holds input.
    bottom.panel.visible = false;
    system.update();
    bottom.panel.visible = true;
    system.update();
    // The scene above closes; the menu shown underneath takes over.
    top.panel.visible = false;
    system.update();

    expect(bottom.stack.active).toBe(bottom.scope);
  });

  it("warns once when no input manager is registered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = sceneWithScope();
    const system = systemOver([scene.scene]);

    system.update();
    system.update();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("@yagejs/input");
  });

  it("stays quiet when every shown scope asked for no device", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const panel = new TestNode();
    panel.add(new TestNode()).focusable();
    const stack = new UIFocusStack();
    stack._register(scopeOver(panel, { input: null }));
    const system = systemOver([sceneOf(stack)]);

    system.update();

    expect(warn).not.toHaveBeenCalled();
  });

  it("empties the pointer cell on a frame with no scope to drive", () => {
    const scene = sceneWithScope();
    scene.panel.visible = false;
    const hovered = new TestNode().focusable();
    const system = systemOver([scene.scene]);
    requestHoverFocus(hovered);

    system.update();

    expect(takePointerRequest()).toBeNull();
  });

  it("passes the resolved input source to the driven stack", () => {
    const scene = sceneWithScope();
    const drive = vi.spyOn(scene.stack, "_drive");
    const input = {
      isPressed: () => false,
      isJustPressed: () => false,
      hasAction: () => true,
    };
    const system = systemOver([scene.scene], { input });

    system.update();

    expect(drive).toHaveBeenCalledWith(input);
  });
});

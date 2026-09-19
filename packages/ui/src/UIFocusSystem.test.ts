import { beforeEach, describe, expect, it, vi } from "vitest";
import { Phase, SceneManagerKey } from "@yagejs/core";
import type { EngineContext, Scene } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";
import { MockContainer } from "./test-helpers.js";
import type { UIContainerElement, UIElement } from "./types.js";
import { FocusState } from "./focus/FocusState.js";
import {
  requestHoverFocus,
  takePointerRequest,
} from "./focus/pointer-request.js";
import { UIFocusScope } from "./focus/UIFocusScope.js";
import { UIFocusStack, UIFocusStackKey } from "./focus/UIFocusStack.js";
import { UIFocusSystem } from "./UIFocusSystem.js";

/** A stand-in element: a container, a laid-out box, and optional focus. */
class TestNode implements UIContainerElement {
  readonly container = new MockContainer();
  readonly children: UIElement[] = [];

  get displayObject(): DisplayContainer {
    return this.container as unknown as DisplayContainer;
  }

  get yogaNode(): UIElement["yogaNode"] {
    return {
      getComputedWidth: () => 100,
      getComputedHeight: () => 20,
    } as unknown as UIElement["yogaNode"];
  }

  get visible(): boolean {
    return this.container.visible;
  }

  set visible(value: boolean) {
    this.container.visible = value;
  }

  focusable(): this {
    new FocusState(this, {}, { focusableByDefault: true });
    return this;
  }

  add<T extends TestNode>(child: T): T {
    this.children.push(child);
    this.container.addChild(child.container);
    return child;
  }

  addElement(child: UIElement): void {
    this.children.push(child);
  }

  removeElement(): void {}

  insertElementBefore(): void {}

  update(): void {}

  destroy(): void {}
}

/** One scene holding one focus scope over one focusable row. */
function sceneWithScope(): {
  scene: Scene;
  stack: UIFocusStack;
  scope: UIFocusScope;
  panel: TestNode;
} {
  const panel = new TestNode();
  panel.add(new TestNode()).focusable();
  const scope = new UIFocusScope(
    { displayObject: panel.displayObject, roots: () => panel.children },
    {},
  );
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

beforeEach(() => {
  // The pointer request cell is module-level; a request left by one test is not the
  // next one's.
  takePointerRequest();
  vi.restoreAllMocks();
});

describe("UIFocusSystem", () => {
  it("runs after layout and the floating overlay", () => {
    const system = new UIFocusSystem();
    expect(system.phase).toBe(Phase.LateUpdate);
    expect(system.priority).toBe(202);
  });

  it("drives only the topmost scene holding a shown scope", () => {
    const bottom = sceneWithScope();
    const top = sceneWithScope();
    const system = new UIFocusSystem();
    const { context } = makeContext([bottom.scene, top.scene]);
    system.onRegister(context);

    system.update();

    expect(top.stack.active).toBe(top.scope);
    expect(bottom.stack.active).toBeNull();
    expect(bottom.scope.hasInput).toBe(false);
  });

  it("drives the scene below when the one above shows nothing", () => {
    const bottom = sceneWithScope();
    const top = sceneWithScope();
    top.panel.visible = false;
    const system = new UIFocusSystem();
    const { context } = makeContext([bottom.scene, top.scene]);
    system.onRegister(context);

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
    const system = new UIFocusSystem();
    const { context } = makeContext([bottom.scene, top.scene]);
    system.onRegister(context);
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

  it("keeps walking past a scene with no focus stack", () => {
    const bottom = sceneWithScope();
    const top = sceneWithScope();
    const system = new UIFocusSystem();
    const { context } = makeContext([
      bottom.scene,
      sceneOf(undefined),
      top.scene,
    ]);
    system.onRegister(context);

    system.update();

    expect(top.stack.active).toBe(top.scope);
    expect(bottom.stack.active).toBeNull();
  });

  it("warns once when no input manager is registered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = sceneWithScope();
    const system = new UIFocusSystem();
    const { context } = makeContext([scene.scene]);
    system.onRegister(context);

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
    stack._register(
      new UIFocusScope(
        { displayObject: panel.displayObject, roots: () => panel.children },
        { input: null },
      ),
    );
    const system = new UIFocusSystem();
    const { context } = makeContext([sceneOf(stack)]);
    system.onRegister(context);

    system.update();

    expect(warn).not.toHaveBeenCalled();
  });

  it("empties the pointer cell on a frame with no scope to drive", () => {
    const scene = sceneWithScope();
    scene.panel.visible = false;
    const hovered = new TestNode().focusable();
    const system = new UIFocusSystem();
    const { context } = makeContext([scene.scene]);
    system.onRegister(context);
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
    const system = new UIFocusSystem();
    const { context } = makeContext([scene.scene], { input });
    system.onRegister(context);

    system.update();

    expect(drive).toHaveBeenCalledWith(input);
  });
});

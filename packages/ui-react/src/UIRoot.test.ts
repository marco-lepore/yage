import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  // @pixi/ui reads navigator at import time — stub it for Node
  if (typeof globalThis.navigator === "undefined") {
    (globalThis as unknown as { navigator: { userAgent: string } }).navigator =
      { userAgent: "" };
  }
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;
    eventMode = "auto";
    cursor = "default";
    mask: MockContainer | null = null;
    private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    addChildAt(child: MockContainer, index: number): MockContainer {
      this.children.splice(index, 0, child);
      child.parent = this;
      return child;
    }

    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }

    removeChildAt(index: number): MockContainer {
      const child = this.children[index];
      if (child) {
        this.children.splice(index, 1);
        child.parent = null;
      }
      return child!;
    }

    removeFromParent(): void {
      this.parent?.removeChild(this);
    }

    on(event: string, fn: (...args: unknown[]) => void): this {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(fn);
      return this;
    }

    emit(event: string): void {
      const listeners = this._listeners.get(event);
      if (listeners) {
        for (const fn of listeners) fn();
      }
    }

    destroy(): void {
      this.destroyed = true;
      this.removeFromParent();
    }

    off(event: string, fn: (...args: unknown[]) => void): this {
      this._listeners.get(event)?.delete(fn);
      return this;
    }

    setMask(opts: { mask: MockContainer | null; inverse?: boolean }): void {
      this.mask = opts.mask;
    }
  }

  class MockGraphics extends MockContainer {
    clear(): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rect(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    roundRect(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fill(...args: unknown[]): MockGraphics {
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    stroke(...args: unknown[]): MockGraphics {
      return this;
    }
  }

  class MockText extends MockContainer {
    text: string;
    style: Record<string, unknown>;
    width: number;
    height: number;
    anchor = {
      x: 0,
      y: 0,
      set(ax: number, ay: number) {
        this.x = ax;
        this.y = ay;
      },
    };

    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
      this.width = 50;
      this.height = 14;
    }
  }

  class MockRectangle {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  }

  return { mocks: { MockContainer, MockGraphics, MockText, MockRectangle } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
  Rectangle: mocks.MockRectangle,
}));

import Yoga from "yoga-layout";
import { createElement, Fragment } from "react";
import {
  EngineContext,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  Scene,
} from "@yagejs/core";
import {
  FloatingOverlayKey,
  UIFocusStack,
  UIFocusStackKey,
  UIPanel,
  setYoga,
} from "@yagejs/ui";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import { UIRoot } from "./UIRoot.js";
import type { UIRootOptions } from "./UIRoot.js";
import { UIReactPlugin, UIReactPluginKey } from "./UIReactPlugin.js";
import { getRootInstances } from "./reconciler.js";
import { Button, Panel } from "./components.js";

beforeAll(() => {
  setYoga(Yoga);
});

class TestScene extends Scene {
  readonly name = "test-scene";
}

/** Roots mounted by {@link mountUIRoot}, torn down after each test. */
const mounted: UIRoot[] = [];

afterEach(() => {
  // A mounted root holds a commit callback in the reconciler's global set, so
  // one left behind runs its layout on every later render in this file.
  for (const root of mounted.splice(0)) root.onDestroy();
  vi.restoreAllMocks();
});

/**
 * Mount a `UIRoot` on an entity of the given name, with the smallest engine
 * context `onAdd` resolves: an error boundary, the plugin marker, a render
 * tree whose single layer is a mock container, and a floating overlay stub.
 * The returned `layer` is the container the root's own container is added to,
 * so `layer.children[0]` is the tree's outer container.
 */
function mountUIRoot(
  entityName: string,
  opts?: UIRootOptions,
  focusStack?: UIFocusStack,
): { root: UIRoot; layer: InstanceType<typeof mocks.MockContainer> } {
  const context = new EngineContext();
  context.register(
    ErrorBoundaryKey,
    new ErrorBoundary(new Logger({ level: LogLevel.Debug })),
  );
  context.register(UIReactPluginKey, new UIReactPlugin());

  const layer = new mocks.MockContainer();
  const scene = new TestScene();
  scene._setContext(context);
  scene.registerScoped(SceneRenderTreeKey, {
    tryGet: () => ({ container: layer }),
  } as never);
  scene.registerScoped(FloatingOverlayKey, {} as never);
  if (focusStack) scene.registerScoped(UIFocusStackKey, focusStack);

  const entity = scene.spawn(entityName);
  const root = entity.add(new UIRoot(opts));
  mounted.push(root);
  return { root, layer };
}

/** The tree's outer container — the only child the layer was given. */
function outerContainer(
  layer: InstanceType<typeof mocks.MockContainer>,
): InstanceType<typeof mocks.MockContainer> {
  return layer.children[0]!;
}

/** Run `body` with `isDev()` reporting false, as a shipped build does. */
function inProductionBuild(body: () => void): void {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    body();
  } finally {
    process.env.NODE_ENV = previous;
  }
}

function overflowWarnings(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => m.includes("overflows its container"));
}

describe("UIRoot offset", () => {
  it("rejects a non-finite offset option", () => {
    expect(() => new UIRoot({ offset: { x: 0, y: Number.NaN } })).toThrow(
      "UIRoot: offset.y must be finite, got NaN.",
    );
  });

  it("does not write into the offset object it was given", () => {
    const offset = { x: 1, y: 2 };
    const root = new UIRoot({ offset });

    root.setOffset(9, 9);

    expect(offset).toEqual({ x: 1, y: 2 });
  });

  it("rejects a non-finite offset without moving the tree", () => {
    const root = new UIRoot({ offset: { x: 10, y: 20 } });

    expect(() => root.setOffset(Number.NaN, 5)).toThrow(
      "UIRoot.setOffset: x must be finite, got NaN.",
    );
    expect(() => root.setOffset(5, Number.POSITIVE_INFINITY)).toThrow(
      "UIRoot.setOffset: y must be finite, got Infinity.",
    );
    expect(root.offset).toEqual({ x: 10, y: 20 });
  });

  it("setOffset moves the tree on the next layout pass", () => {
    const { root, layer } = mountUIRoot("hud", { offset: { x: 10, y: 20 } });
    root.render(createElement(Panel, { width: 40, height: 20 }));
    const container = outerContainer(layer);
    expect(container.position.x).toBe(10);
    expect(container.position.y).toBe(20);

    root.setOffset(-5, 40);
    root._layoutAndAnchor();

    expect(root.offset).toEqual({ x: -5, y: 40 });
    expect(container.position.x).toBe(-5);
    expect(container.position.y).toBe(40);
  });
});

describe("UIRoot overflow warnings", () => {
  it("names the entity that owns the tree", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = mountUIRoot("health-bar");

    root.render(
      createElement(
        Panel,
        { width: 50, height: 20 },
        createElement(Panel, { width: 200, height: 20 }),
      ),
    );

    expect(overflowWarnings(warn)).toHaveLength(1);
    expect(overflowWarnings(warn)[0]).toContain('entity "health-bar"');
  });

  it("names the entity for an element a later render adds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = mountUIRoot("quest-log");
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Panel, { key: "first", width: 50, height: 20 }),
      ),
    );
    expect(overflowWarnings(warn)).toHaveLength(0);

    root.render(
      createElement(
        Fragment,
        null,
        createElement(Panel, { key: "first", width: 50, height: 20 }),
        createElement(
          Panel,
          { key: "second", width: 50, height: 20 },
          createElement(Panel, { width: 200, height: 20 }),
        ),
      ),
    );

    expect(overflowWarnings(warn)).toHaveLength(1);
    expect(overflowWarnings(warn)[0]).toContain('entity "quest-log"');
  });
});

describe("UIRoot tree context", () => {
  it("stamps the entity name and the focus stack on the tree", () => {
    inProductionBuild(() => {
      const attach = vi.spyOn(UIPanel.prototype, "_attachToTree");
      const focusStack = {} as UIFocusStack;
      const { root } = mountUIRoot("pause-menu", undefined, focusStack);

      root.render(createElement(Panel, { width: 40, height: 20 }));

      const context = attach.mock.calls[0]?.[0];
      expect(context?.label).toBe("pause-menu");
      expect(context?.focusStack).toBe(focusStack);
    });
  });

  it("carries a null focus stack in a scene that registered none", () => {
    const attach = vi.spyOn(UIPanel.prototype, "_attachToTree");
    const { root } = mountUIRoot("hud");

    root.render(createElement(Panel, { width: 40, height: 20 }));

    expect(attach.mock.calls[0]?.[0].focusStack).toBeNull();
  });

  it("walks a stamped element once, not on every commit", () => {
    const attach = vi.spyOn(UIPanel.prototype, "_attachToTree");
    const { root } = mountUIRoot("pause-menu", undefined, new UIFocusStack());
    const tree = (width: number): ReturnType<typeof createElement> =>
      createElement(
        Panel,
        { width },
        createElement(Panel, null, createElement(Panel, null)),
      );

    root.render(tree(40));

    // One walk from the root element through its whole subtree.
    expect(attach).toHaveBeenCalledTimes(3);

    attach.mockClear();
    root.render(tree(60));

    expect(attach).not.toHaveBeenCalled();
  });

  it("stamps an element a later render adds at the top level", () => {
    const attach = vi.spyOn(UIPanel.prototype, "_attachToTree");
    const { root } = mountUIRoot("hud", undefined, new UIFocusStack());
    root.render(
      createElement(Fragment, null, createElement(Panel, { key: "a" })),
    );
    attach.mockClear();

    root.render(
      createElement(
        Fragment,
        null,
        createElement(Panel, { key: "a" }),
        createElement(Panel, { key: "b" }),
      ),
    );

    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("detaches the root instances when the component is destroyed", () => {
    const detach = vi.spyOn(UIPanel.prototype, "_detachFromTree");
    const { root } = mountUIRoot("hud");
    root.render(createElement(Panel, { width: 40, height: 20 }));
    detach.mockClear();

    root.onDestroy();

    expect(detach).toHaveBeenCalled();
  });
});

describe("UIRoot focus option", () => {
  /** Recompute which scopes are shown, then run a frame with no device. */
  function drive(stack: UIFocusStack): void {
    stack._observe();
    stack._drive(null);
  }

  it("scopes the root instances and registers with the scene's stack", () => {
    inProductionBuild(() => {
      const stack = new UIFocusStack();
      const { root } = mountUIRoot("pause-menu", { focus: true }, stack);

      root.render(
        createElement(
          Fragment,
          null,
          createElement(Button, { key: "resume" }, "Resume"),
          createElement(Button, { key: "quit" }, "Quit"),
        ),
      );
      drive(stack);

      const scope = root.focusScope;
      expect(scope).not.toBeNull();
      expect(scope!.candidates).toHaveLength(2);
      expect(stack.active).toBe(scope);
    });
  });

  it("warns when the scene registered no focus stack", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = mountUIRoot("pause-menu", { focus: true });

    expect(root.focusScope).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // The sentence a `focus` panel and a `focus` surface print from
    // `@yagejs/ui`'s own internal helper. The two packages hold it
    // separately, so each copy is pinned where it lives.
    expect(warn.mock.calls[0]?.[0]).toContain(
      'UIRoot on entity "pause-menu" has no focus stack, so its focus scope ' +
        "reads no keyboard or gamepad input. UIPlugin registers one per " +
        "scene as the scene is entered.",
    );
  });

  it("has no scope without the option", () => {
    const { root } = mountUIRoot("hud", undefined, new UIFocusStack());

    expect(root.focusScope).toBeNull();
  });

  it("hands the keys to a Panel scope inside it", () => {
    const stack = new UIFocusStack();
    const { root, layer } = mountUIRoot("pause-menu", { focus: true }, stack);

    root.render(
      createElement(
        Panel,
        { focus: true },
        createElement(Button, null, "Delete"),
      ),
    );
    drive(stack);

    const panel = getRootInstances(
      outerContainer(layer) as never,
    )![0] as UIPanel;
    // The root's own walk stops at the nested scope, so the dialog's rows
    // belong to the dialog alone.
    expect(root.focusScope!.candidates).toHaveLength(0);
    expect(stack.active).toBe(panel.focusScope);
  });

  it("keeps its scope through a render that replaces the top-level elements", () => {
    const stack = new UIFocusStack();
    const { root } = mountUIRoot("pause-menu", { focus: true }, stack);
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Button, { key: "resume" }, "Resume"),
      ),
    );
    const scope = root.focusScope;
    drive(stack);

    root.render(
      createElement(
        Fragment,
        null,
        createElement(Button, { key: "load" }, "Load"),
        createElement(Button, { key: "quit" }, "Quit"),
      ),
    );
    drive(stack);

    expect(root.focusScope).toBe(scope);
    expect(scope!.candidates).toHaveLength(2);
    expect(stack.active).toBe(scope);
  });

  it("releases its scope when the component is destroyed", () => {
    const stack = new UIFocusStack();
    const { root } = mountUIRoot("pause-menu", { focus: true }, stack);
    root.render(createElement(Button, null, "Resume"));
    drive(stack);
    expect(stack.active).not.toBeNull();

    root.onDestroy();

    expect(root.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);
    expect(stack.active).toBeNull();
  });

  it("unregisters a Panel scope inside it when the component is destroyed", () => {
    const stack = new UIFocusStack();
    const { root } = mountUIRoot("pause-menu", undefined, stack);
    root.render(
      createElement(Panel, { focus: true }, createElement(Button, null, "Ok")),
    );
    drive(stack);
    expect(stack.active).not.toBeNull();

    // Unmounting deletes the tree element by element, and each one detaches
    // itself, so a scope a nested panel owns leaves the stack with it.
    root.onDestroy();

    expect(stack._observe()).toBe(false);
    expect(stack.active).toBeNull();
  });
});

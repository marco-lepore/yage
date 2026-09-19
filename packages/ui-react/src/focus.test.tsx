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
import type { ReactElement } from "react";
import {
  EngineContext,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  Scene,
} from "@yagejs/core";
import {
  BackgroundRenderer,
  FloatingOverlayKey,
  UIFocusStack,
  UIFocusStackKey,
  setYoga,
} from "@yagejs/ui";
import type { UIButton, UIElement, UIFocusScope, UIPanel } from "@yagejs/ui";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import { UIRoot } from "./UIRoot.js";
import { UIReactPlugin, UIReactPluginKey } from "./UIReactPlugin.js";
import { getRootInstances } from "./reconciler.js";
import { Button, Panel } from "./components.js";

beforeAll(() => {
  setYoga(Yoga);
});

class TestScene extends Scene {
  readonly name = "test-scene";
}

const mounted: UIRoot[] = [];

afterEach(() => {
  // A mounted root holds a commit callback in the reconciler's global set, so
  // one left behind runs its layout on every later render in this file.
  for (const root of mounted.splice(0)) root.onDestroy();
  vi.restoreAllMocks();
});

/**
 * A React tree hosted on an entity, with a focus stack the scopes inside it
 * register with. `render` commits a new tree into the same root, which is how
 * a re-render reaches the elements.
 */
interface Menu {
  readonly stack: UIFocusStack;
  readonly root: UIRoot;
  render(element: ReactElement): void;
  /** The elements the last commit left at the top of the tree. */
  instances(): readonly UIElement[];
  /** Give the keys to the scope shown most recently and run one frame. */
  drive(): void;
}

function mountMenu(): Menu {
  const context = new EngineContext();
  context.register(
    ErrorBoundaryKey,
    new ErrorBoundary(new Logger({ level: LogLevel.Debug })),
  );
  context.register(UIReactPluginKey, new UIReactPlugin());

  const layer = new mocks.MockContainer();
  const stack = new UIFocusStack();
  const scene = new TestScene();
  scene._setContext(context);
  scene.registerScoped(SceneRenderTreeKey, {
    tryGet: () => ({ container: layer }),
  } as never);
  scene.registerScoped(FloatingOverlayKey, {} as never);
  scene.registerScoped(UIFocusStackKey, stack);

  const root = scene.spawn("pause-menu").add(new UIRoot());
  mounted.push(root);
  const container = layer.children[0]!;

  return {
    stack,
    root,
    render: (element) => root.render(element),
    instances: () => getRootInstances(container as never) ?? [],
    drive: () => {
      stack._observe();
      stack._drive(null);
    },
  };
}

/** The panel a `<Panel>` at the top of the tree committed. */
function topPanel(menu: Menu): UIPanel {
  return menu.instances()[0] as UIPanel;
}

describe("Panel focus scope", () => {
  it("builds a scope from the focus prop", () => {
    const menu = mountMenu();

    menu.render(
      <Panel focus={{ wrap: false }}>
        <Button>Resume</Button>
        <Button>Quit</Button>
      </Panel>,
    );

    const scope = topPanel(menu).focusScope;
    expect(scope).not.toBeNull();
    expect(scope!.candidates).toHaveLength(2);
  });

  it("takes the keys once the stack drives the scene", () => {
    const menu = mountMenu();
    menu.render(
      <Panel focus>
        <Button>Resume</Button>
      </Panel>,
    );

    menu.drive();

    const scope = topPanel(menu).focusScope!;
    expect(menu.stack.active).toBe(scope);
    expect(scope.hasInput).toBe(true);
    expect(scope.focused).toBe(topPanel(menu).children[0]);
  });

  it("refreshes the options of the scope it already has, keeping focus", () => {
    const menu = mountMenu();
    const firstCancel = vi.fn();
    const secondCancel = vi.fn();
    const tree = (onCancel: () => void): ReactElement => (
      <Panel focus={{ onCancel }}>
        <Button>Resume</Button>
        <Button>Quit</Button>
      </Panel>
    );

    menu.render(tree(firstCancel));
    const scope = topPanel(menu).focusScope!;
    menu.drive();
    const focused = scope.focused;

    menu.render(tree(secondCancel));

    expect(topPanel(menu).focusScope).toBe(scope);
    expect(scope.focused).toBe(focused);
    scope.cancel();
    expect(firstCancel).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalledTimes(1);
  });

  it("disposes the scope when the focus prop is dropped", () => {
    const menu = mountMenu();
    const tree = (focused: boolean): ReactElement =>
      focused ? (
        <Panel focus>
          <Button>Resume</Button>
        </Panel>
      ) : (
        <Panel>
          <Button>Resume</Button>
        </Panel>
      );

    menu.render(tree(true));
    menu.drive();
    expect(menu.stack.active).not.toBeNull();

    menu.render(tree(false));

    expect(topPanel(menu).focusScope).toBeNull();
    expect(menu.stack._observe()).toBe(false);
    expect(menu.stack.active).toBeNull();
  });
});

describe("focus props on the JSX elements", () => {
  it("keeps a focusable={false} row out of navigation", () => {
    const menu = mountMenu();

    menu.render(
      <Panel focus>
        <Button>Resume</Button>
        <Button focusable={false}>Upload to cloud</Button>
      </Panel>,
    );

    const scope = topPanel(menu).focusScope!;
    expect(scope.candidates).toEqual([topPanel(menu).children[0]]);
  });

  it("steers a move through focusId and focusNeighbors", () => {
    const menu = mountMenu();

    menu.render(
      <Panel focus>
        <Button focusNeighbors={{ down: "quit" }}>Resume</Button>
        <Button>Options</Button>
        <Button focusId="quit">Quit</Button>
      </Panel>,
    );
    menu.drive();

    const scope = topPanel(menu).focusScope!;
    expect(scope.move("down")).toBe(true);

    expect(scope.focused).toBe(topPanel(menu).children[2]);
  });

  it("reports focus arriving and leaving through onFocusChange", () => {
    const menu = mountMenu();
    const onResumeFocus = vi.fn();
    const onQuitFocus = vi.fn();

    menu.render(
      <Panel focus>
        <Button onFocusChange={onResumeFocus}>Resume</Button>
        <Button onFocusChange={onQuitFocus}>Quit</Button>
      </Panel>,
    );
    menu.drive();
    expect(onResumeFocus.mock.calls).toEqual([[true]]);

    const scope = topPanel(menu).focusScope!;
    scope.focus(topPanel(menu).children[1]!);

    expect(onResumeFocus.mock.calls).toEqual([[true], [false]]);
    expect(onQuitFocus.mock.calls).toEqual([[true]]);
  });

  it("stops calling an onFocusChange a later render left out", () => {
    const menu = mountMenu();
    const onResumeFocus = vi.fn();
    const tree = (withHandler: boolean): ReactElement => (
      <Panel focus>
        {withHandler ? (
          <Button onFocusChange={onResumeFocus}>Resume</Button>
        ) : (
          <Button>Resume</Button>
        )}
        <Button>Quit</Button>
      </Panel>
    );

    menu.render(tree(true));
    menu.drive();
    expect(onResumeFocus).toHaveBeenCalledTimes(1);

    menu.render(tree(false));
    topPanel(menu).focusScope!.focus(topPanel(menu).children[1]!);

    expect(onResumeFocus).toHaveBeenCalledTimes(1);
  });

  it("gives a horizontal press to onAdjust and leaves focus where it is", () => {
    const menu = mountMenu();
    const onAdjust = vi.fn();

    menu.render(
      <Panel focus>
        <Panel focusable focusId="volume" onAdjust={onAdjust}>
          <Button>Volume</Button>
        </Panel>
      </Panel>,
    );
    menu.drive();

    const scope = topPanel(menu).focusScope!;
    const row = topPanel(menu).children[0];
    scope.focus(row!);

    expect(scope.move("right")).toBe(true);
    expect(onAdjust.mock.calls).toEqual([[1]]);
    expect(scope.focused).toBe(row);
  });
});

describe("focusBg", () => {
  it("paints the focused background the button's prop names", () => {
    const menu = mountMenu();
    menu.render(
      <Panel focus>
        <Button bg={{ color: 0x101018 }} focusBg={{ color: 0x334455 }}>
          Resume
        </Button>
      </Panel>,
    );
    const paint = vi.spyOn(BackgroundRenderer.prototype, "set");

    menu.drive();

    const button = topPanel(menu).children[0] as UIButton;
    expect(button.focused).toBe(true);
    expect(paint.mock.calls.at(-1)?.[0]).toMatchObject({ color: 0x334455 });
  });

  it("paints the focused background a focusable panel's prop names", () => {
    const menu = mountMenu();
    menu.render(
      <Panel focus>
        <Panel
          focusable
          bg={{ color: 0x101018 }}
          focusBg={{ color: 0x2c4a6f }}
        />
      </Panel>,
    );
    const paint = vi.spyOn(BackgroundRenderer.prototype, "set");

    menu.drive();

    const row = topPanel(menu).children[0];
    expect(topPanel(menu).focusScope?.focused).toBe(row);
    expect(paint.mock.calls.at(-1)?.[0]).toMatchObject({ color: 0x2c4a6f });
  });
});

describe("UIFocusScope reached from React", () => {
  it("is the same instance across re-renders", () => {
    const menu = mountMenu();
    const tree = (label: string): ReactElement => (
      <Panel focus>
        <Button>{label}</Button>
      </Panel>
    );

    menu.render(tree("Resume"));
    const scope: UIFocusScope = topPanel(menu).focusScope!;
    menu.render(tree("Continue"));

    expect(topPanel(menu).focusScope).toBe(scope);
  });
});

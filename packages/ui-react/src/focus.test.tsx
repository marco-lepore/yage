import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

vi.hoisted(() => {
  // @pixi/ui reads navigator at import time — stub it for Node
  if (typeof globalThis.navigator === "undefined") {
    (globalThis as unknown as { navigator: { userAgent: string } }).navigator =
      { userAgent: "" };
  }
});

vi.mock(
  "pixi.js",
  async () => (await import("../../ui/src/test-pixi.js")).pixiMock,
);

import Yoga from "yoga-layout";
import type { ReactElement } from "react";
import { UIFocusStack, setYoga } from "@yagejs/ui";
import type { UIPanel } from "@yagejs/ui";
import { MockContainer } from "../../ui/src/test-pixi.js";
import type { UIRoot } from "./UIRoot.js";
import { getRootInstances } from "./reconciler.js";
import { Button, Panel } from "./components.js";
import { driveFocus, mountTestUIRoot } from "./test-focus-helpers.js";

beforeAll(() => {
  setYoga(Yoga);
});

let root: UIRoot | undefined;

afterEach(() => {
  // A mounted root holds a commit callback in the reconciler's global set.
  root?.onDestroy();
});

/** A React tree on an entity whose scene has a focus stack. */
function mountMenu(): {
  stack: UIFocusStack;
  render(element: ReactElement): void;
  /** The panel the last commit left at the top of the tree. */
  panel(): UIPanel;
} {
  const layer = new MockContainer();
  const stack = new UIFocusStack();
  const mountedRoot = mountTestUIRoot(layer, "pause-menu", undefined, stack);
  root = mountedRoot;
  return {
    stack,
    render: (element) => mountedRoot.render(element),
    panel: () =>
      getRootInstances(layer.children[0] as never)?.[0] as unknown as UIPanel,
  };
}

describe("focus props through React", () => {
  it("builds a Panel scope from the focus prop, and the stack hands it the keys", () => {
    const menu = mountMenu();
    menu.render(
      <Panel focus={{ wrap: false }}>
        <Button>Resume</Button>
        <Button>Quit</Button>
      </Panel>,
    );
    driveFocus(menu.stack);

    const scope = menu.panel().focusScope!;
    expect(scope.candidates).toHaveLength(2);
    expect(menu.stack.active).toBe(scope);
    expect(scope.focused).toBe(menu.panel().children[0]);
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
    const scope = menu.panel().focusScope!;
    driveFocus(menu.stack);
    const focused = scope.focused;

    menu.render(tree(secondCancel));

    expect(menu.panel().focusScope).toBe(scope);
    expect(scope.focused).toBe(focused);
    scope.cancel();
    expect(firstCancel).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalledTimes(1);
  });

  it("disposes the scope when the focus prop is dropped", () => {
    const menu = mountMenu();
    const tree = (focus: boolean): ReactElement => (
      <Panel {...(focus ? { focus } : {})}>
        <Button>Resume</Button>
      </Panel>
    );

    menu.render(tree(true));
    driveFocus(menu.stack);
    expect(menu.stack.active).not.toBeNull();

    menu.render(tree(false));

    expect(menu.panel().focusScope).toBeNull();
    expect(menu.stack._observe()).toBe(false);
    expect(menu.stack.active).toBeNull();
  });

  it("steers a move through focusable, focusId and focusNeighbors", () => {
    const menu = mountMenu();
    menu.render(
      <Panel focus>
        <Button focusNeighbors={{ down: "quit" }}>Resume</Button>
        <Button focusable={false}>Upload to cloud</Button>
        <Button>Options</Button>
        <Button focusId="quit">Quit</Button>
      </Panel>,
    );
    driveFocus(menu.stack);

    const scope = menu.panel().focusScope!;
    expect(scope.candidates).toHaveLength(3);
    expect(scope.move("down")).toBe(true);
    expect(scope.focused).toBe(menu.panel().children[3]);
  });

  it("reports focus through onFocusChange until a render leaves the handler out", () => {
    const menu = mountMenu();
    const onResumeFocus = vi.fn();
    const onQuitFocus = vi.fn();
    const tree = (withResumeHandler: boolean): ReactElement => (
      <Panel focus>
        <Button
          {...(withResumeHandler ? { onFocusChange: onResumeFocus } : {})}
        >
          Resume
        </Button>
        <Button onFocusChange={onQuitFocus}>Quit</Button>
      </Panel>
    );

    menu.render(tree(true));
    driveFocus(menu.stack);
    const scope = menu.panel().focusScope!;
    scope.focus(menu.panel().children[1]!);
    expect(onResumeFocus.mock.calls).toEqual([[true], [false]]);
    expect(onQuitFocus.mock.calls).toEqual([[true]]);

    menu.render(tree(false));
    scope.focus(menu.panel().children[0]!);
    expect(onResumeFocus).toHaveBeenCalledTimes(2);
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
    driveFocus(menu.stack);

    const scope = menu.panel().focusScope!;
    const row = menu.panel().children[0]!;
    scope.focus(row);

    expect(scope.move("right")).toBe(true);
    expect(onAdjust.mock.calls).toEqual([[1]]);
    expect(scope.focused).toBe(row);
  });
});

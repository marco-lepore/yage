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
import { createElement, Fragment } from "react";
import { UIFocusStack, UIPanel, setYoga } from "@yagejs/ui";
import { MockContainer } from "../../ui/src/test-pixi.js";
import { UIRoot } from "./UIRoot.js";
import type { UIRootOptions } from "./UIRoot.js";
import { getRootInstances } from "./reconciler.js";
import { Button, Panel } from "./components.js";
import { driveFocus, mountTestUIRoot } from "./test-focus-helpers.js";

beforeAll(() => {
  setYoga(Yoga);
});

/** Roots mounted by {@link mountUIRoot}, torn down after each test. */
const mounted: UIRoot[] = [];

afterEach(() => {
  // A mounted root holds a commit callback in the reconciler's global set, so
  // one left behind runs its layout on every later render in this file.
  for (const root of mounted.splice(0)) root.onDestroy();
  vi.restoreAllMocks();
});

/**
 * Mount a `UIRoot` on an entity of the given name. The returned `layer` is the
 * container the root's own container is added to, so `layer.children[0]` is
 * the tree's outer container.
 */
function mountUIRoot(
  entityName: string,
  opts?: UIRootOptions,
  focusStack?: UIFocusStack,
): { root: UIRoot; layer: MockContainer } {
  const layer = new MockContainer();
  const root = mountTestUIRoot(layer, entityName, opts, focusStack);
  mounted.push(root);
  return { root, layer };
}

/** The tree's outer container — the only child the layer was given. */
function outerContainer(layer: MockContainer): MockContainer {
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

describe("UIRoot placement", () => {
  it("stacks top-level elements about their transform origins", () => {
    const { root, layer } = mountUIRoot("menu");
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Panel, { width: 40, height: 20 }),
        createElement(Panel, {
          width: 60,
          height: 30,
          transformOrigin: 0.5,
          scale: 1.5,
        }),
      ),
    );

    const [first, second] =
      getRootInstances(outerContainer(layer) as never) ?? [];
    expect(first?.displayObject.position).toMatchObject({ x: 0, y: 0 });
    expect(second?.displayObject.pivot).toMatchObject({ x: 30, y: 15 });
    expect(second?.displayObject.position).toMatchObject({ x: 30, y: 35 });
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

/** A fragment of keyed buttons, one per label. */
function buttons(...labels: string[]): ReturnType<typeof createElement> {
  return createElement(
    Fragment,
    null,
    ...labels.map((label) => createElement(Button, { key: label }, label)),
  );
}

describe("UIRoot tree context", () => {
  it("stamps the entity name and the scene's focus stack, or null, on the tree", () => {
    inProductionBuild(() => {
      const attach = vi.spyOn(UIPanel.prototype, "_attachToTree");
      const focusStack = {} as UIFocusStack;
      for (const stack of [focusStack, undefined]) {
        const { root } = mountUIRoot("pause-menu", undefined, stack);
        root.render(createElement(Panel, { width: 40, height: 20 }));

        const context = attach.mock.calls.at(-1)?.[0];
        expect(context?.label).toBe("pause-menu");
        expect(context?.focusStack).toBe(stack ?? null);
      }
    });
  });

  it("walks an element once, when the render that adds it commits", () => {
    const attach = vi.spyOn(UIPanel.prototype, "_attachToTree");
    const { root } = mountUIRoot("pause-menu", undefined, new UIFocusStack());
    const tree = (
      width: number,
      added: boolean,
    ): ReturnType<typeof createElement> =>
      createElement(
        Fragment,
        null,
        createElement(
          Panel,
          { key: "a", width },
          createElement(Panel, null, createElement(Panel, null)),
        ),
        added ? createElement(Panel, { key: "b" }) : null,
      );

    root.render(tree(40, false));
    expect(attach).toHaveBeenCalledTimes(3);

    attach.mockClear();
    root.render(tree(60, false));
    expect(attach).not.toHaveBeenCalled();

    root.render(tree(60, true));
    expect(attach).toHaveBeenCalledTimes(1);
  });
});

describe("UIRoot focus option", () => {
  it("scopes the root instances and registers with the scene's stack", () => {
    inProductionBuild(() => {
      const stack = new UIFocusStack();
      const { root } = mountUIRoot("pause-menu", { focus: true }, stack);

      root.render(buttons("Resume", "Quit"));
      driveFocus(stack);

      expect(root.focusScope?.candidates).toHaveLength(2);
      expect(stack.active).toBe(root.focusScope);
    });
  });

  it("warns when the scene registered no focus stack", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { root } = mountUIRoot("pause-menu", { focus: true });

    expect(root.focusScope).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      'UIRoot on entity "pause-menu" has no focus stack, so its focus scope ' +
        "reads no keyboard or gamepad input. UIPlugin registers one per " +
        "scene as the scene is entered.",
    );
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
    driveFocus(stack);

    const panel = getRootInstances(
      outerContainer(layer) as never,
    )![0] as UIPanel;
    // The root's own walk stops at the nested scope.
    expect(root.focusScope!.candidates).toHaveLength(0);
    expect(stack.active).toBe(panel.focusScope);
  });

  it("keeps its scope through a render that replaces the top-level elements", () => {
    const stack = new UIFocusStack();
    const { root } = mountUIRoot("pause-menu", { focus: true }, stack);
    root.render(buttons("Resume"));
    const scope = root.focusScope;
    driveFocus(stack);

    root.render(buttons("Load", "Quit"));
    driveFocus(stack);

    expect(root.focusScope).toBe(scope);
    expect(scope!.candidates).toHaveLength(2);
    expect(stack.active).toBe(scope);
  });

  it.each([
    ["its own scope", { focus: true }, createElement(Button, null, "Resume")],
    [
      "a Panel scope inside a root that has none",
      undefined,
      createElement(Panel, { focus: true }, createElement(Button, null, "Ok")),
    ],
  ])("releases %s when the component is destroyed", (_name, opts, tree) => {
    const stack = new UIFocusStack();
    const { root } = mountUIRoot("pause-menu", opts, stack);
    root.render(tree);
    driveFocus(stack);
    expect(stack.active).not.toBeNull();
    expect(root.focusScope === null).toBe(opts === undefined);

    root.onDestroy();

    expect(root.focusScope).toBeNull();
    expect(stack._observe()).toBe(false);
    expect(stack.active).toBeNull();
  });
});

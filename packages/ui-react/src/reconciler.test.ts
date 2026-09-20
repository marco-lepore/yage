import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

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

import { MockContainer } from "../../ui/src/test-pixi.js";
import Yoga from "yoga-layout";
import {
  setYoga,
  createYogaNode,
  UIPanel,
  UIText as UITextNode,
  UIButton as UIButtonNode,
  UIScrollView as UIScrollViewNode,
  UIProgressBar as UIProgressBarNode,
} from "@yagejs/ui";
import { createElement, createRef, Fragment } from "react";
import {
  createRoot,
  getRootInstances,
  addOnCommit,
  removeOnCommit,
} from "./reconciler.js";
import {
  Button,
  Checkbox,
  Panel,
  ProgressBar,
  ScrollView,
  Tooltip,
  UIText as Text,
} from "./components.js";

beforeAll(() => {
  setYoga(Yoga);
});

describe("reconciler", () => {
  let container: MockContainer;

  beforeEach(() => {
    vi.clearAllMocks();
    container = new MockContainer();
  });

  it("createRoot returns render and unmount", () => {
    const root = createRoot(container as never);
    expect(root.render).toBeDefined();
    expect(root.unmount).toBeDefined();
  });

  it("renders a panel element into the container", () => {
    const root = createRoot(container as never);
    root.render(
      createElement("ui-element", { _ctor: UIPanel, direction: "column" }),
    );

    // React reconciler is synchronous for our config
    expect(container.children.length).toBe(1);
  });

  it("renders a text element", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        "ui-element",
        { _ctor: UITextNode, _consumesText: true, style: { fontSize: 20 } },
        "Hello",
      ),
    );

    expect(container.children.length).toBe(1);
  });

  it("renders a button element", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        "ui-element",
        { _ctor: UIButtonNode, _consumesText: true, width: 100, height: 40 },
        "Click",
      ),
    );

    expect(container.children.length).toBe(1);
  });

  it("unmount removes all children", () => {
    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: UIPanel }));

    expect(container.children.length).toBe(1);

    root.unmount();
    expect(container.children.length).toBe(0);
  });

  it("unmount frees the yoga nodes of the whole tree, not just the root", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        "ui-element",
        { _ctor: UIPanel },
        createElement("ui-element", { _ctor: UIPanel, key: "child" }),
      ),
    );
    const rootInstance = getRootInstances(
      container as never,
    )![0] as unknown as {
      yogaNode: { free(): void };
      children: Array<{ yogaNode: { free(): void } }>;
    };
    const rootFree = vi.spyOn(rootInstance.yogaNode, "free");
    const childFree = vi.spyOn(rootInstance.children[0]!.yogaNode, "free");

    root.unmount();

    expect(rootFree).toHaveBeenCalledTimes(1);
    expect(childFree).toHaveBeenCalledTimes(1);
  });

  it("toggling a conditional child ({open && <Panel/>}) frees its yoga node on removal", () => {
    const root = createRoot(container as never);
    const tree = (open: boolean) =>
      createElement(
        "ui-element",
        { _ctor: UIPanel },
        open
          ? createElement("ui-element", { _ctor: UIPanel, key: "conditional" })
          : null,
      );

    root.render(tree(true));
    const rootInstance = getRootInstances(
      container as never,
    )![0] as unknown as {
      children: Array<{ yogaNode: { free(): void } }>;
    };
    const removedChild = rootInstance.children[0]!;
    const childFree = vi.spyOn(removedChild.yogaNode, "free");

    root.render(tree(false));

    expect(childFree).toHaveBeenCalledTimes(1);
  });

  it("destroy() on a removed element is a no-op the second time", () => {
    const root = createRoot(container as never);
    const tree = (open: boolean) =>
      createElement(
        "ui-element",
        { _ctor: UIPanel },
        open
          ? createElement("ui-element", { _ctor: UIPanel, key: "conditional" })
          : null,
      );

    root.render(tree(true));
    const rootInstance = getRootInstances(
      container as never,
    )![0] as unknown as {
      children: Array<{ yogaNode: { free(): void }; destroy(): void }>;
    };
    const removedChild = rootInstance.children[0]!;
    const childFree = vi.spyOn(removedChild.yogaNode, "free");

    root.render(tree(false));
    expect(childFree).toHaveBeenCalledTimes(1);

    // A caller holding a direct reference calling destroy() again must not
    // double-free the (already-freed) Yoga WASM node.
    expect(() => removedChild.destroy()).not.toThrow();
    expect(childFree).toHaveBeenCalledTimes(1);
  });

  it("tracks root instances for layout", () => {
    const root = createRoot(container as never);
    root.render(
      createElement("ui-element", { _ctor: UIPanel, direction: "column" }),
    );

    const instances = getRootInstances(container as never);
    expect(instances).toBeDefined();
    expect(instances!.length).toBe(1);
  });

  it("calls onCommit callbacks after render", () => {
    const cb = vi.fn();
    addOnCommit(cb);

    const root = createRoot(container as never);
    root.render(createElement("ui-element", { _ctor: UIPanel }));

    expect(cb).toHaveBeenCalled();
    removeOnCommit(cb);
  });

  it("nested children are tracked in panel instances", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        "ui-element",
        { _ctor: UIPanel, direction: "column" },
        createElement(
          "ui-element",
          { _ctor: UITextNode, _consumesText: true },
          "Hello",
        ),
        createElement(
          "ui-element",
          { _ctor: UIButtonNode, _consumesText: true, width: 80, height: 30 },
          "OK",
        ),
      ),
    );

    const instances = getRootInstances(container as never);
    const panel = instances![0]!;
    // Panel is a UIPanel with UIContainerElement children
    expect("children" in panel).toBe(true);
    const panelChildren = (panel as { children: unknown[] }).children;
    expect(panelChildren.length).toBe(2);
  });

  it("reorders keyed children without duplicating Panel or Button entries", () => {
    for (const Parent of [Panel, Button]) {
      const root = createRoot(container as never);
      const tree = (keys: string[]) =>
        createElement(
          Parent,
          {},
          ...keys.map((key) => createElement(Panel, { key })),
        );

      root.render(tree(["a", "b", "c"]));
      const parent = getRootInstances(container as never)![0] as unknown as {
        children: unknown[];
      };
      const [a, b, c] = parent.children;

      root.render(tree(["c", "a", "b"]));

      expect(parent.children).toEqual([c, a, b]);
      expect(new Set(parent.children).size).toBe(3);
      root.unmount();
    }
  });

  it("reorders keyed root children without duplicating layout entries", () => {
    const root = createRoot(container as never);
    const tree = (keys: string[]) =>
      createElement(
        Fragment,
        null,
        ...keys.map((key) => createElement(Panel, { key })),
      );

    root.render(tree(["a", "b", "c"]));
    const [a, b, c] = getRootInstances(container as never)!;

    root.render(tree(["c", "a", "b"]));

    const instances = getRootInstances(container as never)!;
    expect(instances).toEqual([c, a, b]);
    expect(new Set(instances).size).toBe(3);
  });

  it("forwards a ScrollView ref to its UIScrollView instance", () => {
    const ref = createRef<UIScrollViewNode>();
    const root = createRoot(container as never);

    root.render(createElement(ScrollView, { ref }));

    expect(ref.current).toBe(getRootInstances(container as never)![0]);
  });

  it("declares ProgressBar as a ref-forwarding component", () => {
    // React 18 is inside the peer range, and it drops a ref passed to a plain
    // function component instead of attaching it.
    expect((ProgressBar as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.forward_ref"),
    );
  });

  it("forwards a ProgressBar ref to its UIProgressBar instance", () => {
    const ref = createRef<UIProgressBarNode>();
    const root = createRoot(container as never);

    root.render(createElement(ProgressBar, { ref, value: 0.5 }));

    expect(ref.current).toBe(getRootInstances(container as never)![0]);
    expect(ref.current!.value).toBe(0.5);
  });

  it("does not crash on missing _ctor (React catches the error)", () => {
    const root = createRoot(container as never);
    // React's error recovery catches the throw from createInstance,
    // so it won't propagate — but the container should remain empty.
    root.render(createElement("ui-element" as never, null));
    expect(container.children.length).toBe(0);
  });

  it("Button with a string child renders an auto-wrapped Text child", () => {
    // The React <Button> wraps string children in <Text> so the underlying
    // UIButton always operates in container mode. We verify it has exactly
    // one Yoga child after render.
    const root = createRoot(container as never);
    root.render(createElement(Button, { onClick: () => {} }, "Click"));

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as {
      children: readonly unknown[];
      yogaNode: { getChildCount(): number };
    };
    expect(btn.children.length).toBe(1);
    expect(btn.yogaNode.getChildCount()).toBe(1);
  });

  it("Button with a numeric child auto-wraps it via String() into a Text", () => {
    const root = createRoot(container as never);
    root.render(createElement(Button, { onClick: () => {} }, 42));

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as {
      children: readonly unknown[];
      yogaNode: { getChildCount(): number };
    };
    expect(btn.children.length).toBe(1);
    expect(btn.yogaNode.getChildCount()).toBe(1);
  });

  it("Button with multiple ReactNode children renders them as flex children", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        Button,
        { onClick: () => {} },
        createElement(Text, null, "Label"),
        createElement(Text, null, "Icon"),
      ),
    );

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as {
      children: readonly unknown[];
      yogaNode: { getChildCount(): number };
    };
    expect(btn.children.length).toBe(2);
    expect(btn.yogaNode.getChildCount()).toBe(2);
  });

  it("Button forwards `truncate` into the auto-wrapped Text", () => {
    // Composes with @yagejs/ui's UIText truncation: a fixed-width Button
    // with a long string label can ellipsize instead of wrapping.
    const root = createRoot(container as never);
    root.render(
      createElement(
        Button,
        { onClick: () => {}, truncate: "ellipsis", width: 80 },
        "A very long label that doesn't fit",
      ),
    );

    const instances = getRootInstances(container as never);
    const btn = instances![0] as unknown as { children: readonly unknown[] };
    expect(btn.children.length).toBe(1);
    // Peek through the JSX wrapper into the UIText that the Button auto-
    // created and confirm the truncate mode landed on the underlying node.
    const label = btn.children[0] as { _truncate: unknown };
    expect(label._truncate).toBe("ellipsis");
  });

  it("Button forwards `truncateWith` into the auto-wrapped Text", () => {
    const root = createRoot(container as never);
    const render = (truncateWith: string): void =>
      root.render(
        createElement(
          Button,
          { onClick: () => {}, truncate: "ellipsis", truncateWith, width: 80 },
          "A very long label that doesn't fit",
        ),
      );

    render("...");
    const btn = getRootInstances(container as never)?.[0] as unknown as {
      children: readonly unknown[];
    };
    const label = btn.children[0] as { _truncateWith: unknown };
    expect(label._truncateWith).toBe("...");

    render("~");
    expect(label._truncateWith).toBe("~");
  });

  it("forwards onHover through the reconciler to the underlying node", () => {
    // End-to-end: React prop → generic reconciler → UIPanel →
    // PointerEvents → callback. Emitting on the node's own container
    // exercises the whole chain.
    const onHover = vi.fn();
    const root = createRoot(container as never);
    root.render(createElement(Panel, { onHover }));

    const panel = getRootInstances(container as never)![0] as unknown as {
      displayObject: MockContainer;
    };
    panel.displayObject.emit("pointerover");
    panel.displayObject.emit("pointerout");

    expect(onHover.mock.calls).toEqual([[true], [false]]);
  });

  it("Tooltip renders only the trigger until opened, then adds the bubble", () => {
    const root = createRoot(container as never);
    const tree = (opened: boolean): React.ReactElement =>
      createElement(
        Tooltip,
        { content: "Save your game", opened },
        createElement(Button, null, "Save"),
      );

    root.render(tree(false));
    let wrapper = getRootInstances(container as never)![0] as unknown as {
      children: readonly unknown[];
    };
    // Just the trigger button — no bubble.
    expect(wrapper.children.length).toBe(1);

    root.render(tree(true));
    wrapper = getRootInstances(container as never)![0] as unknown as {
      children: readonly unknown[];
    };
    // Trigger + the absolutely-positioned bubble panel.
    expect(wrapper.children.length).toBe(2);
  });

  it("Tooltip stays collapsed when disabled even if opened", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        Tooltip,
        { content: "hidden", opened: true, disabled: true },
        createElement(Button, null, "Trigger"),
      ),
    );

    const wrapper = getRootInstances(container as never)![0] as unknown as {
      children: readonly unknown[];
    };
    expect(wrapper.children.length).toBe(1);
  });

  it("commitUpdate calls instance.update()", () => {
    const root = createRoot(container as never);
    root.render(
      createElement(
        "ui-element",
        { _ctor: UITextNode, _consumesText: true, style: { fontSize: 20 } },
        "Hello",
      ),
    );

    // Update with new text
    root.render(
      createElement(
        "ui-element",
        { _ctor: UITextNode, _consumesText: true, style: { fontSize: 20 } },
        "World",
      ),
    );

    // Should not crash and text should be updated
    expect(container.children.length).toBe(1);
  });
});

describe("reconciler dev-warnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A layout leaf: implements UIElement but has NO addElement, so the
  // reconciler's child ops silently drop JSX children. Uniquely named so the
  // once-per-type dedupe doesn't collide with other suites.
  class SilentLeafWidget {
    readonly yogaNode = createYogaNode();
    private readonly _do = new MockContainer();
    get displayObject(): never {
      return this._do as never;
    }
    visible = true;
    update(): void {}
    destroy(): void {
      this.yogaNode.free();
    }
  }

  it("warns once when JSX children are appended to a non-container leaf", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = new MockContainer();
    const root = createRoot(container as never);

    root.render(
      createElement(
        "ui-element",
        { _ctor: SilentLeafWidget },
        createElement("ui-element", { _ctor: UIPanel }),
        createElement("ui-element", { _ctor: UIPanel }),
      ),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.join(" "));
    expect(msg).toContain("SilentLeafWidget");
    expect(msg).toContain("layout leaf");
    expect(msg).toContain("ScrollView");
    warn.mockRestore();
  });

  it("destroys a child rendered under a non-container leaf when it is removed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = new MockContainer();
    const root = createRoot(container as never);
    const destroySpy = vi.spyOn(UIPanel.prototype, "destroy");

    // The child's append onto the leaf parent is warned-and-ignored (never
    // reaches the display tree), so it can't be found via the parent's own
    // child bookkeeping — only React's fiber tree still holds the reference.
    const tree = (open: boolean) =>
      createElement(
        "ui-element",
        { _ctor: SilentLeafWidget },
        open
          ? createElement("ui-element", { _ctor: UIPanel, key: "conditional" })
          : null,
      );

    root.render(tree(true));
    root.render(tree(false));

    expect(destroySpy).toHaveBeenCalledTimes(1);
    destroySpy.mockRestore();
    warn.mockRestore();
  });

  describe("prop removal (commitUpdate diff)", () => {
    it("resets a removed prop to its default instead of leaving the old value", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);

      const withBg = createElement("ui-element", {
        _ctor: UIPanel,
        background: { color: 0xff0000 },
      });
      root.render(withBg);
      const panel = getRootInstances(container as never)![0] as unknown as {
        yogaNode: unknown;
      };

      // Next render omits `background` entirely (conditional-spread pattern:
      // `background={selected ? hl : undefined}` / `{...(cond ? {bg} : {})}`).
      const withoutBg = createElement("ui-element", { _ctor: UIPanel });
      root.render(withoutBg);

      // The panel instance is stable across the update (same host instance).
      expect(getRootInstances(container as never)![0]).toBe(panel);
      // No direct "has background" getter on UIPanel; assert indirectly via
      // the display object the background renderer holds, which is gone while
      // the panel paints no fill — background: undefined must have reached
      // update() as an explicit reset, not been skipped.
      const bgRenderer = (
        panel as unknown as {
          bgRenderer: { displayObject: unknown } | undefined;
        }
      ).bgRenderer;
      expect(bgRenderer?.displayObject).toBeUndefined();
    });

    it("resets a removed onClick handler instead of leaving it bound", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);
      const onClick = vi.fn();

      root.render(createElement(Button, { onClick }, "Click"));
      root.render(createElement(Button, {}, "Click")); // onClick dropped

      const btn = getRootInstances(container as never)![0] as unknown as {
        onClick: (() => void) | undefined;
      };
      expect(btn.onClick).toBeUndefined();
    });
  });

  describe("bare text child warning", () => {
    it("warns once when a raw string/number is passed where createTextInstance is hit", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const container = new MockContainer();
      const root = createRoot(container as never);

      // Panel's underlying UIElement has no addElement matching a bare-text
      // fiber — createTextInstance() itself is what returns null; drive it
      // directly the way React would for a `{"Score: " + score}` child.
      root.render(
        createElement("ui-element", { _ctor: UIPanel }, "a raw text child"),
      );

      const messages = warn.mock.calls.map((c) => String(c.join(" ")));
      expect(messages.some((m) => m.includes("bare text child"))).toBe(true);
      warn.mockRestore();
    });
  });

  describe("bg shorthand alias", () => {
    it("bg styles the panel same as background", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);

      root.render(createElement(Panel, { bg: { color: 0x00ff00 } }));

      const panel = getRootInstances(container as never)![0] as unknown as {
        bgRenderer: unknown;
      };
      expect(panel.bgRenderer).toBeDefined();
    });

    it("canonical background wins over bg, with a once-per-type dev warning", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const container = new MockContainer();
      const root = createRoot(container as never);

      // @ts-expect-error — intentionally passing both for the collision test
      root.render(
        createElement(Panel, {
          bg: { color: 0x00ff00 },
          background: { color: 0xff0000 },
        }),
      );

      const panel = getRootInstances(container as never)![0] as unknown as {
        bgRenderer: { opts: unknown } | undefined;
      };
      expect(panel.bgRenderer).toBeDefined();

      const messages = warn.mock.calls.map((c) => String(c.join(" ")));
      expect(
        messages.some((m) => m.includes("`bg`") && m.includes("`background`")),
      ).toBe(true);
      warn.mockRestore();
    });

    it("removing bg clears the background, same as removing background directly", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);

      root.render(createElement(Panel, { bg: { color: 0x00ff00 } }));
      root.render(createElement(Panel, {})); // bg dropped between renders

      const panel = getRootInstances(container as never)![0] as unknown as {
        bgRenderer: { displayObject: unknown } | undefined;
      };
      expect(panel.bgRenderer?.displayObject).toBeUndefined();
    });

    it("does not expand bg on Pixi* wrappers (own required view-slot prop)", () => {
      // PixiProgressBar's `bg` is a required PixiViewType, not a background
      // alias — the reconciler must never touch it. It has no `_bgAlias`
      // marker, so createInstance/commitUpdate pass `bg` straight through.
      const container = new MockContainer();
      const root = createRoot(container as never);
      const bgView = "some-texture-path";

      root.render(
        createElement("ui-element", {
          _ctor: UIPanel, // stand-in ctor; only checking prop plumbing, not @pixi/ui internals
          bg: bgView,
        }),
      );

      const instance = getRootInstances(container as never)![0] as unknown as {
        bgRenderer: unknown;
      };
      // No `_bgAlias` marker was set, so `bg` was never expanded to
      // `background` — UIPanel's own background stays unset.
      expect(instance.bgRenderer).toBeUndefined();
    });
  });

  describe("focus props", () => {
    it("forwards focusable, and restores the element's default when it is dropped", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);
      const button = (): UIButtonNode =>
        getRootInstances(container as never)![0] as UIButtonNode;

      root.render(createElement(Button, { focusable: false }, "Upload"));
      expect(button().focusable).toBe(false);

      root.render(createElement(Button, {}, "Upload"));
      expect(button().focusable).toBe(true);
    });

    it.each([
      ["a button", Button],
      ["a panel", Panel],
    ] as const)(
      "maps focusBg onto %s's focused background, re-derives it, and clears it",
      (_name, component) => {
        const container = new MockContainer();
        const root = createRoot(container as never);
        const focusBgOpts = (): { color: number } | undefined =>
          (
            getRootInstances(container as never)![0] as unknown as {
              focusBgOpts: { color: number } | undefined;
            }
          ).focusBgOpts;
        const bg = { color: 0x101018 };

        root.render(
          createElement(component, { bg, focusBg: { color: 0x334455 } }),
        );
        expect(focusBgOpts()?.color).toBe(0x334455);

        root.render(
          createElement(component, { bg, focusBg: { color: 0x667788 } }),
        );
        expect(focusBgOpts()?.color).toBe(0x667788);

        root.render(createElement(component, { bg }));
        expect(focusBgOpts()).toBeUndefined();
      },
    );
  });

  describe("derived prop types accept consumeInput (item 4 drift fix)", () => {
    it("Checkbox forwards consumeInput to the underlying container", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);

      root.render(createElement(Checkbox, { consumeInput: false }));

      // Compiling this at all is the regression check (CheckboxProps used to
      // extend only LayoutProps); a mounted instance confirms it also runs.
      expect(getRootInstances(container as never)!.length).toBe(1);
    });

    it("ScrollView forwards consumeInput to the underlying viewport", () => {
      const container = new MockContainer();
      const root = createRoot(container as never);

      root.render(createElement(ScrollView, { consumeInput: false }));

      expect(getRootInstances(container as never)!.length).toBe(1);
    });
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { createRoot as createDomRoot } from "react-dom/client";
import { act } from "react";
import { EngineCtx, SceneCtx } from "./hooks.js";
import { useSplitText } from "./use-split-text.js";
import type { SplitTextControls } from "./use-split-text.js";
import { Process, ProcessSystemKey } from "@yagejs/core";
import type { EngineContext, Scene } from "@yagejs/core";
import type { UISplitText } from "@yagejs/ui";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

type StubNode = UISplitText & { triggerSplit(): void };

function makeStubNode(): StubNode {
  let listener: (() => void) | undefined;
  const chars = [{ alpha: 0 }, { alpha: 0 }, { alpha: 0 }];
  return {
    chars,
    words: [],
    lines: [],
    get segments() {
      return { chars, words: [], lines: [] };
    },
    resplit: vi.fn(),
    onSplit: (fn: () => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    triggerSplit: () => listener?.(),
  } as unknown as StubNode;
}

function makeEngine(added: Process[]): EngineContext {
  const processSystem = {
    addForScene: (_scene: unknown, p: Process) => {
      added.push(p);
    },
  };
  return {
    resolve: (key: unknown) =>
      key === ProcessSystemKey ? processSystem : undefined,
  } as unknown as EngineContext;
}

describe("useSplitText", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createDomRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createDomRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    node: StubNode | null,
    engine: EngineContext,
    capture: (tuple: [unknown, SplitTextControls]) => void,
  ): void {
    function TestComp(): null {
      const tuple = useSplitText<StubNode>();
      // Wire the element before the commit effect runs (the reconciler would
      // normally do this); the hook's accessors read ref.current live.
      tuple[0].current = node;
      capture(tuple);
      return null;
    }
    act(() => {
      root.render(
        createElement(
          EngineCtx.Provider,
          { value: engine },
          createElement(
            SceneCtx.Provider,
            { value: {} as Scene },
            createElement(TestComp),
          ),
        ),
      );
    });
  }

  it("returns a [ref, controls] tuple with live segment accessors", () => {
    const node = makeStubNode();
    let tuple!: [unknown, SplitTextControls];
    render(node, makeEngine([]), (t) => (tuple = t));

    const [ref, controls] = tuple;
    expect(ref).toHaveProperty("current");
    expect(controls.chars).toBe(node.chars);
    expect(controls.segments.chars).toBe(node.chars);
    expect(typeof controls.run).toBe("function");
  });

  it("run() enqueues on the scene queue; the handle cancels just that batch", () => {
    const added: Process[] = [];
    let controls!: SplitTextControls;
    render(makeStubNode(), makeEngine(added), (t) => (controls = t[1]));

    const p1 = new Process({ update: () => {} });
    const p2 = new Process({ update: () => {} });
    const handle = controls.run([p1, p2]);

    expect(added).toEqual([p1, p2]);
    expect(p1.completed).toBe(false);

    handle.cancel();
    expect(p1.completed).toBe(true);
    expect(p2.completed).toBe(true);
  });

  it("cancels in-flight processes when the text re-splits", () => {
    const node = makeStubNode();
    let controls!: SplitTextControls;
    render(node, makeEngine([]), (t) => (controls = t[1]));

    const p = new Process({ update: () => {} });
    controls.run(p);
    expect(p.completed).toBe(false);

    act(() => node.triggerSplit());
    expect(p.completed).toBe(true);
  });

  it("resplit() delegates to the element", () => {
    const node = makeStubNode();
    let controls!: SplitTextControls;
    render(node, makeEngine([]), (t) => (controls = t[1]));

    controls.resplit();
    expect(node.resplit).toHaveBeenCalledTimes(1);
  });
});

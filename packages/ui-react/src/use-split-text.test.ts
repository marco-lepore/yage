// @vitest-environment happy-dom
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createElement, useLayoutEffect } from "react";
import { createRoot as createDomRoot } from "react-dom/client";
import { act } from "react";
import { EngineCtx, SceneCtx } from "./hooks.js";
import { useSplitText } from "./use-split-text.js";
import type { SplitTextControls } from "./use-split-text.js";
import {
  Process,
  ProcessSystem,
  ProcessSystemKey,
  createMockScene,
} from "@yagejs/core";
import type { Scene, EngineContext } from "@yagejs/core";
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

interface Harness {
  scene: Scene;
  context: EngineContext;
  processSystem: ProcessSystem;
}

// A real EngineContext + Scene (core's shared test helper) with a real
// ProcessSystem wired in, so the hook resolves and routes through genuine
// engine plumbing rather than ad-hoc stubs.
function makeHarness(): Harness {
  const { scene, context } = createMockScene();
  const processSystem = new ProcessSystem();
  context.register(ProcessSystemKey, processSystem);
  return { scene, context, processSystem };
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
    harness: Harness,
    capture: (tuple: [unknown, SplitTextControls]) => void,
  ): void {
    function TestComp(): null {
      const tuple = useSplitText<StubNode>();
      useLayoutEffect(() => {
        const setRef = tuple[0];
        setRef(node);
        return () => setRef(null);
      }, [tuple[0]]);
      capture(tuple);
      return null;
    }
    act(() => {
      root.render(
        createElement(
          EngineCtx.Provider,
          { value: harness.context },
          createElement(
            SceneCtx.Provider,
            { value: harness.scene },
            createElement(TestComp),
          ),
        ),
      );
    });
  }

  it("returns a [ref, controls] tuple with live segment accessors", () => {
    const node = makeStubNode();
    let tuple!: [unknown, SplitTextControls];
    render(node, makeHarness(), (t) => (tuple = t));

    const [ref, controls] = tuple;
    expect(ref).toBeTypeOf("function");
    expect(controls.chars).toBe(node.chars);
    expect(controls.segments.chars).toBe(node.chars);
    expect(typeof controls.run).toBe("function");
  });

  it("run() routes processes onto the scene's process pool", () => {
    const harness = makeHarness();
    let controls!: SplitTextControls;
    render(makeStubNode(), harness, (t) => (controls = t[1]));

    const p = new Process({ update: () => {} });
    controls.run(p);
    expect(p.completed).toBe(false);

    // Cancelling the scene's pool tears p down, proving run() routed it
    // through ProcessSystem.addForScene(scene, …).
    harness.processSystem.cancelForScene(harness.scene);
    expect(p.completed).toBe(true);
  });

  it("the run() handle cancels only its own batch", () => {
    let controls!: SplitTextControls;
    render(makeStubNode(), makeHarness(), (t) => (controls = t[1]));

    const a = new Process({ update: () => {} });
    const b = new Process({ update: () => {} });
    const handleA = controls.run(a);
    controls.run(b);

    handleA.cancel();
    expect(a.completed).toBe(true);
    expect(b.completed).toBe(false);
  });

  it("cancels in-flight processes when the text re-splits", () => {
    const node = makeStubNode();
    let controls!: SplitTextControls;
    render(node, makeHarness(), (t) => (controls = t[1]));

    const p = new Process({ update: () => {} });
    controls.run(p);
    expect(p.completed).toBe(false);

    act(() => node.triggerSplit());
    expect(p.completed).toBe(true);
  });

  it("resplit() delegates to the element", () => {
    const node = makeStubNode();
    let controls!: SplitTextControls;
    render(node, makeHarness(), (t) => (controls = t[1]));

    controls.resplit();
    expect(node.resplit).toHaveBeenCalledTimes(1);
  });

  it("subscribes to a replacement node after a keyed remount", () => {
    const first = makeStubNode();
    const second = makeStubNode();
    let tuple!: [unknown, SplitTextControls];
    render(first, makeHarness(), (t) => (tuple = t));
    const setRef = tuple[0] as (node: StubNode | null) => void;
    const process = new Process({ update: () => {} });
    tuple[1].run(process);

    act(() => setRef(second));
    act(() => second.triggerSplit());

    expect(process.completed).toBe(true);
  });
});

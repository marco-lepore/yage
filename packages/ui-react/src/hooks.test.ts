// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot as createDomRoot } from "react-dom/client";
import { act } from "react";
import {
  EngineCtx,
  SceneCtx,
  useEngine,
  useScene,
  useStore,
  useQuery,
  useSceneSelector,
  notifyFrame,
} from "./hooks.js";
import { createStore } from "./store.js";
import { EngineContext, QueryCacheKey, QueryCache } from "@yagejs/core";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("hooks", () => {
  it("useEngine throws when not inside context", () => {
    function TestComp() {
      useEngine();
      return null;
    }

    expect(() => {
      renderToStaticMarkup(createElement(TestComp));
    }).toThrow("useEngine() must be called inside a React tree rendered by UIRoot.");
  });

  it("useScene throws when not inside context", () => {
    function TestComp() {
      useScene();
      return null;
    }

    expect(() => {
      renderToStaticMarkup(createElement(TestComp));
    }).toThrow("useScene() must be called inside a React tree rendered by UIRoot.");
  });

  it("useEngine returns context when provided", () => {
    const mockCtx = { test: true } as never;
    let result: unknown = null;

    function TestComp() {
      result = useEngine();
      return null;
    }

    renderToStaticMarkup(
      createElement(
        EngineCtx.Provider,
        { value: mockCtx },
        createElement(TestComp),
      ),
    );

    expect(result).toBe(mockCtx);
  });

  it("useScene returns scene when provided", () => {
    const mockScene = { name: "test" } as never;
    let result: unknown = null;

    function TestComp() {
      result = useScene();
      return null;
    }

    renderToStaticMarkup(
      createElement(
        SceneCtx.Provider,
        { value: mockScene },
        createElement(TestComp),
      ),
    );

    expect(result).toBe(mockScene);
  });
});

// ---------------------------------------------------------------------------
// Client-rendered hook tests (need useSyncExternalStore)
// ---------------------------------------------------------------------------

function createContainer(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

describe("useStore", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createDomRoot>;

  beforeEach(() => {
    container = createContainer();
    root = createDomRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reads the full store state without a selector", () => {
    const store = createStore({ score: 42, hp: 100 });
    let result: unknown;

    function Comp() {
      result = useStore(store);
      return null;
    }

    act(() => root.render(createElement(Comp)));
    expect(result).toEqual({ score: 42, hp: 100 });
  });

  it("re-renders when store value changes", () => {
    const store = createStore({ score: 0 });
    const renders: number[] = [];

    function Comp() {
      const s = useStore(store, (s) => s.score);
      renders.push(s);
      return null;
    }

    act(() => root.render(createElement(Comp)));
    expect(renders).toEqual([0]);

    act(() => store.set({ score: 10 }));
    expect(renders).toEqual([0, 10]);
  });

  it("skips re-render when selector result is shallowEqual", () => {
    const store = createStore({ a: 1, b: 2 });
    let renderCount = 0;

    function Comp() {
      useStore(store, (s) => ({ a: s.a }));
      renderCount++;
      return null;
    }

    act(() => root.render(createElement(Comp)));
    expect(renderCount).toBe(1);

    // Change b only — selector returns { a: 1 } both times (shallowEqual)
    act(() => store.set({ b: 99 }));
    expect(renderCount).toBe(1);
  });
});

describe("useQuery", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createDomRoot>;
  let queryCache: QueryCache;
  let ctx: EngineContext;

  beforeEach(() => {
    container = createContainer();
    root = createDomRoot(container);
    queryCache = new QueryCache();
    ctx = new EngineContext();
    ctx.register(QueryCacheKey, queryCache);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function wrap(el: React.ReactElement) {
    return createElement(EngineCtx.Provider, { value: ctx }, el);
  }

  it("returns selector output from query result", () => {
    let result: number | undefined;

    function Comp() {
      result = useQuery([], (r) => r.size);
      return null;
    }

    act(() => root.render(wrap(createElement(Comp))));
    expect(result).toBe(0);
  });

  it("updates on frame tick", () => {
    const renders: number[] = [];

    function Comp() {
      const size = useQuery([], (r) => r.size);
      renders.push(size);
      return null;
    }

    act(() => root.render(wrap(createElement(Comp))));
    expect(renders).toEqual([0]);

    // Tick frame — no entities added, size still 0, shallowEqual skips re-render
    act(() => notifyFrame());
    expect(renders).toEqual([0]);
  });

  it("handles empty query gracefully", () => {
    let result: unknown;

    function Comp() {
      result = useQuery([], (r) => r.first ?? null);
      return null;
    }

    act(() => root.render(wrap(createElement(Comp))));
    expect(result).toBe(null);
  });
});

describe("useSceneSelector", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createDomRoot>;

  beforeEach(() => {
    container = createContainer();
    root = createDomRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("computes value from scene", () => {
    const mockScene = { name: "testScene" } as never;
    let result: string | undefined;

    function Comp() {
      result = useSceneSelector((s) => s.name);
      return null;
    }

    act(() =>
      root.render(
        createElement(
          SceneCtx.Provider,
          { value: mockScene },
          createElement(Comp),
        ),
      ),
    );
    expect(result).toBe("testScene");
  });

  it("skips re-render when result is shallowEqual", () => {
    let counter = 0;
    const mockScene = { name: "s" } as never;
    let renderCount = 0;

    function Comp() {
      useSceneSelector(() => {
        counter++;
        return { static: true };
      });
      renderCount++;
      return null;
    }

    act(() =>
      root.render(
        createElement(
          SceneCtx.Provider,
          { value: mockScene },
          createElement(Comp),
        ),
      ),
    );
    expect(renderCount).toBe(1);

    // Frame tick — selector returns { static: true } again (shallowEqual)
    act(() => notifyFrame());
    expect(renderCount).toBe(1);
    // Selector was called though
    expect(counter).toBeGreaterThan(1);
  });
});

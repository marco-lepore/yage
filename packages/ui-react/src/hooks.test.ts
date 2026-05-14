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
import {
  EngineContext,
  QueryCacheKey,
  QueryCache,
  createRecord,
  createValue,
  createCounter,
  createMap,
  createSet,
  createList,
  createStore,
} from "@yagejs/core";

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

  it("reads the full record state without a selector", () => {
    const store = createRecord({ defaults: () => ({ score: 42, hp: 100 }) });
    let result: unknown;

    function Comp() {
      result = useStore(store);
      return null;
    }

    act(() => root.render(createElement(Comp)));
    expect(result).toEqual({ score: 42, hp: 100 });
  });

  it("re-renders when record value changes", () => {
    const store = createRecord({ defaults: () => ({ score: 0 }) });
    const renders: number[] = [];

    function Comp() {
      const s = useStore(store, (src) => src.get().score);
      renders.push(s);
      return null;
    }

    act(() => root.render(createElement(Comp)));
    expect(renders).toEqual([0]);

    act(() => store.set({ score: 10 }));
    expect(renders).toEqual([0, 10]);
  });

  it("skips re-render when selector result is shallowEqual", () => {
    const store = createRecord({ defaults: () => ({ a: 1, b: 2 }) });
    let renderCount = 0;

    function Comp() {
      useStore(store, (src) => ({ a: src.get().a }));
      renderCount++;
      return null;
    }

    act(() => root.render(createElement(Comp)));
    expect(renderCount).toBe(1);

    act(() => store.set({ b: 99 }));
    expect(renderCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// useStore — shape overloads
// ---------------------------------------------------------------------------

describe("useStore overloads (per Reactive* shape)", () => {
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

  it("reads a ReactiveValue", () => {
    const v = createValue<string>({ defaults: () => "hi" });
    let result: unknown;
    function Comp() {
      result = useStore(v);
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toBe("hi");
    act(() => v.set("yo"));
    expect(result).toBe("yo");
  });

  it("reads a ReactiveCounter as a number", () => {
    const c = createCounter({ default: 3 });
    let result: unknown;
    function Comp() {
      result = useStore(c);
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toBe(3);
    act(() => c.increment(2));
    expect(result).toBe(5);
  });

  it("reads a ReactiveMap as entries", () => {
    const m = createMap<string, number>();
    m.set("a", 1);
    let result: Array<[string, number]> | undefined;
    function Comp() {
      result = useStore(m);
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toEqual([["a", 1]]);
    act(() => m.set("b", 2));
    expect(result?.sort()).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("reads a ReactiveSet as an array", () => {
    const s = createSet<string>();
    s.add("x");
    let result: string[] | undefined;
    function Comp() {
      result = useStore(s);
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toEqual(["x"]);
    act(() => s.add("y"));
    expect(result?.sort()).toEqual(["x", "y"]);
  });

  it("reads a ReactiveList as an array", () => {
    const l = createList<string>();
    l.add("a");
    l.add("b");
    let result: string[] | undefined;
    function Comp() {
      result = useStore(l);
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toEqual(["a", "b"]);
    act(() => {
      l.add("c");
    });
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("selector escape hatch reads one map key", () => {
    const m = createMap<string, number>();
    m.set("a", 1);
    let result: number | undefined;
    function Comp() {
      result = useStore(m, (src) => src.get("a"));
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toBe(1);
    act(() => m.set("a", 7));
    expect(result).toBe(7);
  });

  it("reads a compound ReactiveStore as the encoded snapshot", () => {
    const game = createStore((s) => ({
      gold: s.counter({ default: 0 }),
      flags: s.set<string>(),
    }));
    let result: { gold: number; flags: string[] } | undefined;
    function Comp() {
      result = useStore(game);
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result?.gold).toBe(0);
    expect(result?.flags).toEqual([]);
    act(() => game.gold.increment(5));
    expect(result?.gold).toBe(5);
  });

  it("selector on a compound source reads through a leaf", () => {
    const game = createStore((s) => ({
      gold: s.counter({ default: 0 }),
      inv: s.map<string, number>(),
    }));
    let result: number | undefined;
    function Comp() {
      result = useStore(game, (src) => src.gold.value());
      return null;
    }
    act(() => root.render(createElement(Comp)));
    expect(result).toBe(0);
    act(() => game.gold.set(42));
    expect(result).toBe(42);
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

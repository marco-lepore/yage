import { createContext, useContext, useCallback, useRef, useMemo } from "react";
import { useSyncExternalStore } from "react";
import type {
  EngineContext,
  Scene,
  ComponentClass,
  QueryResult,
  Reactive,
  ReactiveValue,
  ReactiveCounter,
  ReactiveRecord,
  ReactiveMap,
  ReactiveSet,
  ReactiveList,
} from "@yagejs/core";
import { QueryCacheKey } from "@yagejs/core";
import { shallowEqual } from "./shallowEqual.js";

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/** Context providing the YAGE EngineContext to React components. */
export const EngineCtx = createContext<EngineContext | null>(null);

/** Context providing the current YAGE Scene to React components. */
export const SceneCtx = createContext<Scene | null>(null);

/** Access the YAGE EngineContext from a React component rendered inside UIRoot. */
export function useEngine(): EngineContext {
  const ctx = useContext(EngineCtx);
  if (!ctx) {
    throw new Error(
      "useEngine() must be called inside a React tree rendered by UIRoot.",
    );
  }
  return ctx;
}

/** Access the current YAGE Scene from a React component rendered inside UIRoot. */
export function useScene(): Scene {
  const scene = useContext(SceneCtx);
  if (!scene) {
    throw new Error(
      "useScene() must be called inside a React tree rendered by UIRoot.",
    );
  }
  return scene;
}

// ---------------------------------------------------------------------------
// Frame subscription (module-level)
// ---------------------------------------------------------------------------

const frameListeners = new Set<() => void>();

/** @internal Called by UIRoot.update() each frame. */
export function notifyFrame(): void {
  for (const fn of frameListeners) {
    fn();
  }
}

function subscribeFrame(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// useStore
// ---------------------------------------------------------------------------

/**
 * Read a reactive store inside React. One overload per `Reactive*` shape;
 * each returns a snapshot of the leaf's natural value and re-renders when
 * the leaf notifies.
 *
 * The selector overload is the escape hatch for partial reads (e.g. one map
 * key, one record field). The selector receives the source itself, not a
 * snapshot — call the source's accessors inside.
 *
 * The compound `defineStore` result is intentionally not accepted — read
 * individual leaves so subscription granularity stays per-leaf.
 */
export function useStore<T extends object>(
  source: ReactiveRecord<T>,
): Readonly<T>;
export function useStore(source: ReactiveCounter): number;
export function useStore<K, V>(source: ReactiveMap<K, V>): Array<[K, V]>;
export function useStore<K>(source: ReactiveSet<K>): K[];
export function useStore<T>(source: ReactiveList<T>): T[];
export function useStore<T>(source: ReactiveValue<T>): T;
export function useStore<S extends Reactive, R>(
  source: S,
  select: (s: S) => R,
  isEqual?: (a: R, b: R) => boolean,
): R;
export function useStore(
  source: Reactive,
  select?: (s: Reactive) => unknown,
  isEqual: (a: unknown, b: unknown) => boolean = shallowEqual as (
    a: unknown,
    b: unknown,
  ) => boolean,
): unknown {
  // Memoise the snapshot reader. Without this, `defaultSnapshotReader` runs
  // unconditionally on every render and yields a new closure, which would
  // give `getSnapshot` a fresh identity each render and force
  // `useSyncExternalStore` to call it again to verify consistency.
  const reader = useMemo(
    () => select ?? defaultSnapshotReader(source),
    [source, select],
  );

  // Always recompute the snapshot before comparing — this keeps results
  // current even when the selector changes between renders. The leaves
  // memoise their snapshots internally (map.entries / set.values / list)
  // and `Atom`-backed shapes return stable references between mutations,
  // so `Object.is` / `shallowEqual` correctly bails out when nothing
  // changed, and React's bail-out keeps the previous render reference.
  const cache = useRef<{ value: unknown } | null>(null);

  const getSnapshot = useCallback((): unknown => {
    const next = reader(source);
    if (cache.current && isEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next };
    return next;
  }, [source, reader, isEqual]);

  const subscribe = useCallback(
    (onChange: () => void) => source.subscribe(onChange),
    [source],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Pick the natural snapshot reader for each Reactive* shape. We dispatch by
 * which method the source exposes — every leaf is one shape exactly, so
 * checking for the shape-defining method is sufficient and avoids a brand.
 */
function defaultSnapshotReader(
  source: Reactive,
): (s: Reactive) => unknown {
  const s = source as Partial<
    ReactiveCounter &
      ReactiveMap<unknown, unknown> &
      ReactiveSet<unknown> &
      ReactiveList<unknown> &
      ReactiveValue<unknown> &
      ReactiveRecord<object>
  >;
  if (typeof s.value === "function" && typeof s.increment === "function") {
    return (x) => (x as ReactiveCounter).value();
  }
  if (typeof s.entries === "function") {
    return (x) => (x as ReactiveMap<unknown, unknown>).entries();
  }
  if (typeof s.values === "function" && typeof s.add === "function") {
    return (x) => (x as ReactiveSet<unknown>).values();
  }
  if (typeof s.list === "function") {
    return (x) => (x as ReactiveList<unknown>).list();
  }
  if (typeof s.get === "function") {
    // ReactiveRecord and ReactiveValue both expose get(). They differ in arity
    // but both return their natural snapshot when called with no arg.
    return (x) =>
      (x as ReactiveValue<unknown> & ReactiveRecord<object>).get() as unknown;
  }
  throw new Error("useStore: source is not a recognised Reactive* shape.");
}

// ---------------------------------------------------------------------------
// useQuery
// ---------------------------------------------------------------------------

/**
 * Run an ECS query and map results through a selector. Frame-polled.
 *
 * The query is registered once and stays live for the component's lifetime.
 */
export function useQuery<R>(
  filter: readonly ComponentClass[],
  selector: (result: QueryResult) => R,
  isEqual: (a: R, b: R) => boolean = shallowEqual as (a: R, b: R) => boolean,
): R {
  const ctx = useEngine();
  const queryCache = useMemo(
    () => ctx.resolve(QueryCacheKey),
    [ctx],
  );

  // Register query once and keep a stable ref
  const queryRef = useRef<QueryResult | null>(null);
  if (queryRef.current === null) {
    queryRef.current = queryCache.register(filter);
  }
  const query = queryRef.current;

  const cache = useRef<{ value: R } | null>(null);

  const getSnapshot = useCallback((): R => {
    const next = selector(query);
    if (cache.current && isEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next };
    return next;
  }, [selector, isEqual, query]);

  return useSyncExternalStore(subscribeFrame, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// useSceneSelector
// ---------------------------------------------------------------------------

/**
 * Run an arbitrary selector against the current scene each frame.
 *
 * General escape hatch for anything not covered by `useQuery`.
 */
export function useSceneSelector<R>(
  selector: (scene: Scene) => R,
  isEqual: (a: R, b: R) => boolean = shallowEqual as (a: R, b: R) => boolean,
): R {
  const scene = useScene();

  const cache = useRef<{ value: R } | null>(null);

  const getSnapshot = useCallback((): R => {
    const next = selector(scene);
    if (cache.current && isEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next };
    return next;
  }, [selector, scene, isEqual]);

  return useSyncExternalStore(subscribeFrame, getSnapshot, getSnapshot);
}

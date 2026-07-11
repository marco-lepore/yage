import { createContext, useContext, useCallback, useEffect, useRef, useMemo } from "react";
import { useSyncExternalStore } from "react";
import type {
  EngineContext,
  Scene,
  ComponentClass,
  QueryResult,
  Reactive,
  Serializable,
  ReactiveValue,
  ReactiveCounter,
  ReactiveRecord,
  ReactiveMap,
  ReactiveSet,
  ReactiveList,
  ReactiveStore,
  StoreLeaves,
  EncodedStore,
} from "@yagejs/core";
import { QueryCacheKey, STATE_KIND } from "@yagejs/core";
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
 * Read a reactive source inside React. One overload per `Reactive*` shape;
 * each returns a snapshot of the source's natural value and re-renders when
 * the source notifies.
 *
 * The selector overload is the escape hatch for partial reads (e.g. one map
 * key, one record field, a derived value off a compound). The selector
 * receives the source itself, not a snapshot — call the source's accessors
 * inside.
 *
 * Dispatch is symbol-driven: each shape exposes a `[STATE_KIND]` brand which
 * picks the right default reader. New shapes added to the public API must
 * extend the dispatch table below.
 */
export function useStore<T extends object, TE>(
  source: ReactiveRecord<T, TE>,
): Readonly<T>;
export function useStore(source: ReactiveCounter): number;
export function useStore<K, V>(source: ReactiveMap<K, V>): Array<[K, V]>;
export function useStore<K>(source: ReactiveSet<K>): K[];
export function useStore<T>(source: ReactiveList<T>): T[];
export function useStore<T, TE>(source: ReactiveValue<T, TE>): T;
export function useStore<L extends StoreLeaves>(
  source: ReactiveStore<L>,
): EncodedStore<L>;
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
 * Pick the natural snapshot reader for each `Reactive*` shape, keyed by the
 * source's `[STATE_KIND]` brand. Throws if the source has no brand — every
 * source produced by a `create*` factory carries one.
 */
function defaultSnapshotReader(
  source: Reactive,
): (s: Reactive) => unknown {
  const kind = (source as { [STATE_KIND]?: string })[STATE_KIND];
  switch (kind) {
    case "counter":
      return (x) => (x as ReactiveCounter).value();
    case "map":
      return (x) => (x as ReactiveMap<unknown, unknown>).entries();
    case "set":
      return (x) => (x as ReactiveSet<unknown>).values();
    case "list":
      return (x) => (x as ReactiveList<unknown>).list();
    case "value":
      return (x) => (x as ReactiveValue<unknown>).get();
    case "record":
      return (x) => (x as ReactiveRecord<object>).get();
    case "store":
      return (x) => (x as Reactive & Serializable<unknown>).serialize();
    default:
      throw new Error(
        `useStore: source is not a recognised Reactive* shape (kind=${String(
          kind,
        )}).`,
      );
  }
}

// ---------------------------------------------------------------------------
// useQuery
// ---------------------------------------------------------------------------

/** True if two filters have the same component classes in the same order. */
function sameFilter(
  a: readonly ComponentClass[],
  b: readonly ComponentClass[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Run an ECS query and map results through a selector. Frame-polled.
 *
 * The query is registered once and released when the component unmounts.
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

  // Inline array literals are the common authoring shape (`useQuery([Foo,
  // Bar], ...)`), which gives `filter` a new identity on every render. Only
  // re-key off `filter` when its contents actually changed, so an inline
  // array doesn't force a re-registration on every render.
  const filterRef = useRef(filter);
  if (filterRef.current !== filter && !sameFilter(filterRef.current, filter)) {
    filterRef.current = filter;
  }
  const stableFilter = filterRef.current;

  const queryRef = useRef<{
    q: QueryResult;
    filter: readonly ComponentClass[];
  } | null>(null);

  // Registration happens only here, never during render. React may invoke
  // and discard a render (StrictMode, interrupted concurrent work) without
  // running effects, so a render-time registration would leak an entry in
  // the cache that nothing ever unregisters.
  useEffect(() => {
    const held = queryCache.register(stableFilter);
    queryRef.current = { q: held, filter: stableFilter };
    return () => {
      queryCache.unregister(held);
      queryRef.current = null;
    };
  }, [queryCache, stableFilter]);

  const cache = useRef<{ value: R } | null>(null);

  const getSnapshot = useCallback((): R => {
    // Before the effect above registers (first paint, or the one frame after
    // a filter change before the effect re-runs), fall back to a detached
    // one-shot read — it's seeded from the same live entities the
    // registered query will pick up once the effect runs.
    const held = queryRef.current;
    const query =
      held && held.filter === stableFilter
        ? held.q
        : queryCache.queryOnce(stableFilter);
    const next = selector(query);
    if (cache.current && isEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next };
    return next;
  }, [selector, isEqual, queryCache, stableFilter]);

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

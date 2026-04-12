import { createContext, useContext, useCallback, useRef, useMemo } from "react";
import { useSyncExternalStore } from "react";
import type { EngineContext, Scene, ComponentClass, QueryResult } from "@yage/core";
import { QueryCacheKey } from "@yage/core";
import type { Store } from "./store.js";
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
 * Read from a reactive store with optional selector.
 *
 * Push-based via `useSyncExternalStore` — re-renders only when the selected
 * value changes.
 */
export function useStore<T extends Record<string, unknown>>(
  store: Store<T>,
): Readonly<T>;
export function useStore<T extends Record<string, unknown>, R>(
  store: Store<T>,
  selector: (state: Readonly<T>) => R,
  isEqual?: (a: R, b: R) => boolean,
): R;
export function useStore<T extends Record<string, unknown>, R = Readonly<T>>(
  store: Store<T>,
  selector?: (state: Readonly<T>) => R,
  isEqual: (a: R, b: R) => boolean = shallowEqual as (a: R, b: R) => boolean,
): R {
  const sel = selector ?? ((s: Readonly<T>) => s as unknown as R);

  // Cache the last result to skip re-renders when isEqual says same
  const cache = useRef<{ value: R; snap: Readonly<T> } | null>(null);

  const getSnapshot = useCallback((): R => {
    const snap = store.get();
    if (cache.current && cache.current.snap === snap) {
      return cache.current.value;
    }
    const next = sel(snap);
    if (cache.current && isEqual(cache.current.value, next)) {
      // Value unchanged — return stable reference
      cache.current = { value: cache.current.value, snap };
      return cache.current.value;
    }
    cache.current = { value: next, snap };
    return next;
  }, [store, sel, isEqual]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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

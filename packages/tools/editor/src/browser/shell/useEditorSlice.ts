import { useCallback, useSyncExternalStore } from "react";
import type { EditorState, EditorStore } from "../store/index.js";

/**
 * Re-render this component whenever the part of the state it reads changes.
 *
 * `useSyncExternalStore` bails out when `Object.is` holds between the previous
 * value and the new one, so a selector must return something stable: a field
 * the reducer replaces only when it changes, or a primitive derived from one.
 * A selector that builds a fresh object or array re-renders on every action
 * and defeats the whole point of taking a slice.
 *
 * This is what keeps a drag off the panels that have nothing to do with it. A
 * `gesture-moved` fires once per pointer move, and a component that reads no
 * part of `gesture` does not re-render for it.
 */
export function useEditorSlice<T>(
  store: EditorStore,
  select: (state: EditorState) => T,
): T {
  // Memoized so the store is not unsubscribed and resubscribed on every
  // render. `select` is read fresh each render instead, which is what lets a
  // caller write it inline.
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  return useSyncExternalStore(subscribe, () => select(store.getState()));
}

/**
 * Re-render this component whenever the store publishes a new state.
 *
 * For a component that reads most of the state anyway. Anything narrower takes
 * {@link useEditorSlice}.
 */
export function useEditorState(store: EditorStore): EditorState {
  return useEditorSlice(store, identity);
}

function identity(state: EditorState): EditorState {
  return state;
}

/** A lightweight reactive key-value store. */
export interface Store<T extends Record<string, unknown>> {
  /** Return a frozen snapshot of the current state. */
  get(): Readonly<T>;
  /** Merge partial state. Only notifies if at least one value changed (Object.is per key). */
  set(partial: Partial<T>): void;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * Create a reactive store.
 *
 * The scene creates and writes to the store; React reads via `useStore`.
 */
export function createStore<T extends Record<string, unknown>>(
  initial: T,
): Store<T> {
  let state: T = { ...initial };
  let frozen: Readonly<T> = Object.freeze({ ...state });
  const listeners = new Set<() => void>();

  return {
    get(): Readonly<T> {
      return frozen;
    },

    set(partial: Partial<T>): void {
      let changed = false;
      for (const key of Object.keys(partial) as Array<keyof T>) {
        if (!Object.is(state[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;

      state = { ...state, ...partial };
      frozen = Object.freeze({ ...state });
      for (const fn of listeners) {
        fn();
      }
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

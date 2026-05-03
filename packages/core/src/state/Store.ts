/**
 * Store — object-shaped reactive store with shallow merge and frozen snapshots.
 *
 * `get()` returns a frozen snapshot whose reference is stable between sets.
 * `set(partial)` merges keys via spread and notifies only when at least one key
 * changed (Object.is per key). Same semantics as the previous ui-react Store.
 */
export interface Store<T extends object> {
  get(): Readonly<T>;
  set(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
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
      for (const fn of listeners) fn();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

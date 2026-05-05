/**
 * Store — object-shaped reactive store with shallow merge.
 *
 * `get()` returns a `Readonly<T>` whose reference is stable between sets.
 * `set(partial)` merges keys via spread and notifies only when at least one key
 * changed (Object.is per key). Mutation through the snapshot bypasses
 * subscribers — TypeScript's `Readonly<T>` enforces the contract; do not reach
 * into nested objects to mutate them, use `set` instead.
 */
export interface Store<T extends object> {
  get(): Readonly<T>;
  set(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let snapshot: T = { ...initial };
  const listeners = new Set<() => void>();

  return {
    get(): Readonly<T> {
      return snapshot;
    },
    set(partial: Partial<T>): void {
      let changed = false;
      for (const key of Object.keys(partial) as Array<keyof T>) {
        if (!Object.is(snapshot[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;

      snapshot = { ...snapshot, ...partial };
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

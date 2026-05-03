/**
 * Atom — minimal reactive cell.
 *
 * Signal-shaped: `get`, `set`, `subscribe`. Identity-based change detection
 * (`Object.is`); subscribers are notified only when the value actually changes.
 */
export interface Atom<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: (value: T) => void): () => void;
}

export function createAtom<T>(initial: T): Atom<T> {
  let value: T = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    get(): T {
      return value;
    },
    set(next: T): void {
      if (Object.is(value, next)) return;
      value = next;
      for (const fn of listeners) fn(value);
    },
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

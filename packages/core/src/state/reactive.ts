/**
 * Reactive state contracts.
 *
 * Three primitive interfaces — {@link Reactive}, {@link Serializable},
 * {@link Resettable} — describe the orthogonal facets every state factory
 * implements. The save layer consumes any `Serializable<T>` (optionally with
 * `Reactive` for `autoPersist`); React's `useStore` consumes any `Reactive*`
 * shape. Ids and version envelopes live at the save call site, not on the
 * primitive.
 *
 * Every shape carries a `[STATE_KIND]` brand. The brand is a real exported
 * symbol — leaf factories set it at construction time, and `useStore`
 * dispatches on it for snapshot extraction. No more duck-typing on overlapping
 * method names.
 */

/** Subscribe to changes; returns an unsubscribe function. */
export interface Reactive {
  subscribe(listener: () => void): () => void;
}

/** Serialise to / hydrate from a typed encoded form. */
export interface Serializable<TEncoded = unknown> {
  serialize(): TEncoded;
  hydrate(raw: TEncoded): void;
}

/** Restore to construction defaults. */
export interface Resettable {
  reset(): void;
}

/** Runtime + compile-time dispatch tag for reactive shapes. */
export const STATE_KIND: unique symbol = Symbol.for("yagejs.state.kind");

/** Single typed cell. */
export interface ReactiveValue<T>
  extends Reactive,
    Serializable<{ value: T }>,
    Resettable {
  readonly [STATE_KIND]: "value";
  get(): T;
  set(value: T): void;
}

/** Integer counter with arithmetic helpers. */
export interface ReactiveCounter
  extends Reactive,
    Serializable<number>,
    Resettable {
  readonly [STATE_KIND]: "counter";
  value(): number;
  set(n: number): void;
  increment(by?: number): void;
  decrement(by?: number): void;
  /** Set to `value` clamped into `[min, max]`. */
  clamp(value: number, min: number, max: number): void;
}

/** Object-shaped store with shallow merge on `set`. */
export interface ReactiveRecord<T extends object>
  extends Reactive,
    Serializable<T>,
    Resettable {
  readonly [STATE_KIND]: "record";
  get(): Readonly<T>;
  set(partial: Partial<T>): void;
}

/** Key → value map. */
export interface ReactiveMap<K, V>
  extends Reactive,
    Serializable<Array<[K, V]>>,
    Resettable {
  readonly [STATE_KIND]: "map";
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  has(key: K): boolean;
  entries(): Array<[K, V]>;
  size(): number;
  clear(): void;
}

/** Set of keys. */
export interface ReactiveSet<K>
  extends Reactive,
    Serializable<K[]>,
    Resettable {
  readonly [STATE_KIND]: "set";
  add(key: K): void;
  delete(key: K): void;
  has(key: K): boolean;
  values(): K[];
  size(): number;
  clear(): void;
}

/**
 * Encoded form for a `ReactiveList`: items in insertion order plus the
 * monotonic `nextId` counter so ids stay stable across save/restore.
 */
export interface ListEncoded<T> {
  items: Array<{ id: number; value: T }>;
  nextId: number;
}

/**
 * Ordered list of items with monotonically-assigned numeric ids. Insertion
 * order is preserved across save/restore; ids are stable.
 */
export interface ReactiveList<T>
  extends Reactive,
    Serializable<ListEncoded<T>>,
    Resettable {
  readonly [STATE_KIND]: "list";
  /** Insert and return the assigned id. */
  add(item: T): number;
  /** Remove by id; returns true if the id was present. */
  remove(id: number): boolean;
  get(id: number): T | undefined;
  /** Shallow-merge a partial update over an existing item; returns true on hit. */
  update(id: number, partial: Partial<T>): boolean;
  /** Items in insertion order. */
  list(): T[];
  size(): number;
  clear(): void;
}

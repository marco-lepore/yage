/**
 * Reactive subscription contracts.
 *
 * Every reactive primitive in `@yagejs/core/state` extends `Reactive`. Each
 * shape adds its own read/write methods. React's `useStore` reads through
 * these interfaces, the compound `defineStore` collects them as leaves, and
 * the save layer hydrates/dumps them as `PersistentLike`.
 *
 * `Reactive*` is the public subscription surface — it doesn't carry an id,
 * version, or serialize protocol. The persistent variants (`PersistentLike`
 * + concrete factories) sit on top of these.
 */
export interface Reactive {
  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

// Phantom brands disambiguate the two shapes that share `get`/`set` method
// names but disagree on parameter types: `ReactiveValue<T>` (single cell)
// and `ReactiveRecord<T>` (object with shallow merge). Without brands TS
// overload resolution can pick the wrong one — e.g. `ReactiveValue<boolean>`
// would otherwise match `ReactiveRecord<Boolean>`. The brands have no
// runtime representation; leaf factories satisfy them via internal casts.
declare const __ReactiveValueBrand: unique symbol;
declare const __ReactiveRecordBrand: unique symbol;

/** Single typed cell. */
export interface ReactiveValue<T> extends Reactive {
  /** @internal phantom brand — do not access. */
  readonly [__ReactiveValueBrand]: T;
  get(): T;
  set(value: T): void;
}

/** Integer counter with arithmetic helpers. */
export interface ReactiveCounter extends Reactive {
  value(): number;
  set(n: number): void;
  increment(by?: number): void;
  decrement(by?: number): void;
  /** Set to `value` clamped into `[min, max]`. */
  clamp(value: number, min: number, max: number): void;
}

/** Object-shaped store with shallow merge on `set`. */
export interface ReactiveRecord<T extends object> extends Reactive {
  /** @internal phantom brand — do not access. */
  readonly [__ReactiveRecordBrand]: T;
  get(): Readonly<T>;
  set(partial: Partial<T>): void;
}

/** Key → value map. */
export interface ReactiveMap<K, V> extends Reactive {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  has(key: K): boolean;
  entries(): Array<[K, V]>;
  size(): number;
  clear(): void;
}

/** Set of keys. */
export interface ReactiveSet<K> extends Reactive {
  add(key: K): void;
  delete(key: K): void;
  has(key: K): boolean;
  values(): K[];
  size(): number;
  clear(): void;
}

/**
 * Ordered list of items with monotonically-assigned numeric ids. Insertion
 * order is preserved across save/restore; ids are stable.
 */
export interface ReactiveList<T> extends Reactive {
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

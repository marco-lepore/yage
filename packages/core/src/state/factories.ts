/**
 * Reactive state factories.
 *
 * Each factory returns a fresh instance implementing the matching `Reactive*`
 * shape — which extends `Reactive`, `Serializable<TEncoded>`, and `Resettable`.
 * No id, no version: persistence vocabulary (ids, versions, migrate) lives at
 * the save call site (`@yagejs/save`), not on the primitive.
 *
 * Two layers:
 *  - **Leaf factories** (`createValue`, `createCounter`, `createRecord`,
 *    `createMap`, `createSet`, `createList`) — single-shape, usable on their
 *    own.
 *  - **Compound factory** (`createStore`) — bundles a set of leaves so they
 *    serialise/restore atomically.
 *
 * Every factory takes a `default` option that accepts either a value or a
 * `() => value` factory function. The function form is preferred for mutable
 * defaults (records, maps, sets, lists) so each reset yields a fresh instance
 * rather than sharing one reference; for primitives the value form is fine.
 * If your value itself is a function, wrap it: `default: () => myFn`.
 */

import { createAtom, type Atom } from "./Atom.js";
import { jsonCodec, setCodec, mapCodec, type Codec } from "./codecs.js";
import {
  STATE_KIND,
  type Reactive,
  type ReactiveCounter,
  type ReactiveList,
  type ReactiveMap,
  type ReactiveRecord,
  type ReactiveSet,
  type ReactiveValue,
  type ListEncoded,
  type ListKey,
  type Resettable,
  type Serializable,
} from "./reactive.js";

/**
 * Normalise a `T | (() => T)` default to a factory function. Disambiguation
 * relies on `typeof === "function"`; if you intend to store a function as the
 * value, wrap it: `default: () => myFn`.
 */
function toFactory<T>(d: T | (() => T)): () => T {
  return typeof d === "function" ? (d as () => T) : () => d;
}

// ---------------------------------------------------------------------------
// createValue
// ---------------------------------------------------------------------------

export interface CreateValueOptions<T, TEncoded = T> {
  default: T | (() => T);
  codec?: Codec<T, TEncoded>;
}

export function createValue<T, TEncoded = T>(
  opts: CreateValueOptions<T, TEncoded>,
): ReactiveValue<T, TEncoded> {
  const codec =
    opts.codec ?? (jsonCodec<T>() as unknown as Codec<T, TEncoded>);
  const makeDefault = toFactory(opts.default);
  const atom: Atom<T> = createAtom<T>(makeDefault());

  const api: ReactiveValue<T, TEncoded> = {
    [STATE_KIND]: "value",
    get: () => atom.get(),
    set: (next) => atom.set(next),
    subscribe: (fn) => atom.subscribe(() => fn()),
    serialize: () => ({ value: codec.encode(atom.get()) }),
    hydrate: (raw) => {
      if (raw == null || typeof raw !== "object" || !("value" in raw)) {
        throw new Error(
          `createValue.hydrate: expected { value }, got ${typeof raw}`,
        );
      }
      atom.set(codec.decode((raw as { value: unknown }).value));
    },
    reset: () => atom.set(makeDefault()),
  };
  return api;
}

// ---------------------------------------------------------------------------
// createCounter
// ---------------------------------------------------------------------------

export interface CreateCounterOptions {
  default?: number | (() => number);
}

export function createCounter(opts?: CreateCounterOptions): ReactiveCounter {
  const makeDefault =
    opts?.default !== undefined ? toFactory(opts.default) : () => 0;
  const atom = createAtom<number>(makeDefault());

  const api: ReactiveCounter = {
    [STATE_KIND]: "counter",
    value: () => atom.get(),
    set: (n) => atom.set(n),
    increment: (by = 1) => atom.set(atom.get() + by),
    decrement: (by = 1) => atom.set(atom.get() - by),
    clamp: (value, min, max) => {
      const v = value < min ? min : value > max ? max : value;
      atom.set(v);
    },
    subscribe: (fn) => atom.subscribe(() => fn()),
    serialize: () => atom.get(),
    hydrate: (raw) => {
      if (typeof raw !== "number") {
        throw new Error(
          `createCounter.hydrate: expected number, got ${typeof raw}`,
        );
      }
      atom.set(raw);
    },
    reset: () => atom.set(makeDefault()),
  };
  return api;
}

// ---------------------------------------------------------------------------
// createRecord
// ---------------------------------------------------------------------------

export interface CreateRecordOptions<T extends object, TEncoded = T> {
  default: T | (() => T);
  codec?: Codec<T, TEncoded>;
}

export function createRecord<T extends object, TEncoded = T>(
  opts: CreateRecordOptions<T, TEncoded>,
): ReactiveRecord<T, TEncoded> {
  const codec =
    opts.codec ?? (jsonCodec<T>() as unknown as Codec<T, TEncoded>);
  const makeDefault = toFactory(opts.default);
  let snapshot: T = { ...makeDefault() };
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const fn of listeners) fn();
  };

  const api: ReactiveRecord<T, TEncoded> = {
    [STATE_KIND]: "record",
    get: () => snapshot as Readonly<T>,
    set: (partial) => {
      let changed = false;
      for (const key of Object.keys(partial) as Array<keyof T>) {
        if (!Object.is(snapshot[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      snapshot = { ...snapshot, ...partial };
      notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    serialize: () => codec.encode(snapshot),
    hydrate: (raw) => {
      const next = codec.decode(raw);
      // Mirror `set()`'s change check: only notify when at least one key
      // differs. Keeps compound `hydrate` rollback from firing spurious
      // notifications when an untouched leaf is restored to its prior snapshot.
      let changed = false;
      for (const key of Object.keys(next) as Array<keyof T>) {
        if (!Object.is(snapshot[key], next[key])) {
          changed = true;
          break;
        }
      }
      for (const key of Object.keys(snapshot) as Array<keyof T>) {
        if (!(key in next)) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      snapshot = { ...next };
      notify();
    },
    reset: () => {
      snapshot = { ...makeDefault() };
      notify();
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// createMap
// ---------------------------------------------------------------------------

export interface CreateMapOptions<K, V> {
  default?: Iterable<[K, V]> | (() => Iterable<[K, V]>);
}

export function createMap<K, V>(
  opts?: CreateMapOptions<K, V>,
): ReactiveMap<K, V> {
  const makeDefault =
    opts?.default !== undefined
      ? toFactory(opts.default)
      : (): Iterable<[K, V]> => [];
  const buildDefault = (): Map<K, V> => new Map<K, V>(makeDefault());
  const codec = mapCodec<K, V>();
  const atom = createAtom<Map<K, V>>(buildDefault());

  // Memoise the entries snapshot so repeated reads (e.g. React renders) return
  // the same array reference between mutations.
  let entriesSnapshot: Array<[K, V]> | null = null;
  const replace = (next: Map<K, V>): void => {
    entriesSnapshot = null;
    atom.set(next);
  };

  const api: ReactiveMap<K, V> = {
    [STATE_KIND]: "map",
    get: (k) => atom.get().get(k),
    set: (k, v) => {
      const current = atom.get();
      if (current.has(k) && Object.is(current.get(k), v)) return;
      const next = new Map(current);
      next.set(k, v);
      replace(next);
    },
    delete: (k) => {
      const current = atom.get();
      if (!current.has(k)) return;
      const next = new Map(current);
      next.delete(k);
      replace(next);
    },
    has: (k) => atom.get().has(k),
    entries: () => {
      if (entriesSnapshot === null) {
        entriesSnapshot = Array.from(atom.get().entries());
      }
      return entriesSnapshot;
    },
    size: () => atom.get().size,
    clear: () => {
      if (atom.get().size === 0) return;
      replace(new Map());
    },
    subscribe: (fn) => atom.subscribe(() => fn()),
    serialize: () => codec.encode(atom.get()),
    hydrate: (raw) => replace(codec.decode(raw)),
    reset: () => replace(buildDefault()),
  };
  return api;
}

// ---------------------------------------------------------------------------
// createSet
// ---------------------------------------------------------------------------

export interface CreateSetOptions<K> {
  default?: Iterable<K> | (() => Iterable<K>);
}

export function createSet<K>(opts?: CreateSetOptions<K>): ReactiveSet<K> {
  const makeDefault =
    opts?.default !== undefined
      ? toFactory(opts.default)
      : (): Iterable<K> => [];
  const buildDefault = (): Set<K> => new Set<K>(makeDefault());
  const codec = setCodec<K>();
  const atom = createAtom<Set<K>>(buildDefault());

  let valuesSnapshot: K[] | null = null;
  const replace = (next: Set<K>): void => {
    valuesSnapshot = null;
    atom.set(next);
  };

  const api: ReactiveSet<K> = {
    [STATE_KIND]: "set",
    add: (k) => {
      const current = atom.get();
      if (current.has(k)) return;
      const next = new Set(current);
      next.add(k);
      replace(next);
    },
    delete: (k) => {
      const current = atom.get();
      if (!current.has(k)) return;
      const next = new Set(current);
      next.delete(k);
      replace(next);
    },
    has: (k) => atom.get().has(k),
    values: () => {
      if (valuesSnapshot === null) {
        valuesSnapshot = Array.from(atom.get().values());
      }
      return valuesSnapshot;
    },
    size: () => atom.get().size,
    clear: () => {
      if (atom.get().size === 0) return;
      replace(new Set());
    },
    subscribe: (fn) => atom.subscribe(() => fn()),
    serialize: () => codec.encode(atom.get()),
    hydrate: (raw) => replace(codec.decode(raw)),
    reset: () => replace(buildDefault()),
  };
  return api;
}

// ---------------------------------------------------------------------------
// createList
// ---------------------------------------------------------------------------

export interface CreateListOptions<T> {
  default?: Iterable<T> | (() => Iterable<T>);
  /**
   * Derive a domain key from each item to enable O(1) keyed lookup via
   * `findId` / `getByKey` / `upsert`. Without it those methods throw. The key
   * field may change via `update`; the index reindexes on every mutation.
   *
   * Keys are unique: a keyed list holds at most one item per derived key.
   * `add`, `update`, and `upsert` throw if the operation would leave two live
   * items sharing a key. This keeps the key→id index unambiguous — every key
   * resolves to exactly one item.
   */
  keyBy?: (item: T) => ListKey;
}

interface ListState<T> {
  items: Array<{ id: number; value: T }>;
  nextId: number;
}

export function createList<T>(opts?: CreateListOptions<T>): ReactiveList<T> {
  const makeDefault =
    opts?.default !== undefined
      ? toFactory(opts.default)
      : (): Iterable<T> => [];
  const keyBy = opts?.keyBy;

  const buildDefault = (): ListState<T> => {
    const items: Array<{ id: number; value: T }> = [];
    let nextId = 1;
    const seenKeys = keyBy ? new Set<ListKey>() : null;
    for (const value of makeDefault()) {
      if (keyBy !== undefined && seenKeys !== null) {
        const key = keyBy(value);
        if (seenKeys.has(key)) {
          throw new Error(
            `createList: default contains duplicate key ${JSON.stringify(key)}. ` +
              `A keyed list holds at most one item per key.`,
          );
        }
        seenKeys.add(key);
      }
      items.push({ id: nextId, value });
      nextId += 1;
    }
    return { items, nextId };
  };

  let state: ListState<T> = buildDefault();
  const listeners = new Set<() => void>();

  // key → id index, maintained only when keyBy is supplied. Rebuilt from the
  // current items so any mutation (add/remove/update/clear/hydrate/reset) can
  // restore it in one pass; the index is never serialized. Key uniqueness is
  // enforced on the mutation path, so the index is unambiguous: at most one
  // entry per key.
  const keyIndex: Map<ListKey, number> | null = keyBy ? new Map() : null;
  const rebuildIndex = (): void => {
    if (keyIndex === null || keyBy === undefined) return;
    keyIndex.clear();
    for (const entry of state.items) {
      keyIndex.set(keyBy(entry.value), entry.id);
    }
  };
  rebuildIndex();

  const requireKeyBy = (method: string): ((item: T) => ListKey) => {
    if (keyBy === undefined) {
      throw new Error(
        `ReactiveList.${method} requires a keyBy option on createList/s.list`,
      );
    }
    return keyBy;
  };

  // Reject a mutation that would leave two live items sharing `key`. `ownerId`
  // is the id the key is allowed to resolve to (the item being updated in
  // place); a collision with any other id throws. No-op for non-keyed lists.
  const assertKeyFree = (
    method: string,
    key: ListKey,
    ownerId: number | undefined,
  ): void => {
    if (keyIndex === null) return;
    const holder = keyIndex.get(key);
    if (holder !== undefined && holder !== ownerId) {
      throw new Error(
        `ReactiveList.${method}: key ${JSON.stringify(key)} is already held ` +
          `by item id ${holder}. A keyed list holds at most one item per key.`,
      );
    }
  };

  let listSnapshot: T[] | null = null;
  const notify = (): void => {
    listSnapshot = null;
    rebuildIndex();
    for (const fn of listeners) fn();
  };

  const api: ReactiveList<T> = {
    [STATE_KIND]: "list",
    add: (item) => {
      if (keyBy !== undefined) {
        assertKeyFree("add", keyBy(item), undefined);
      }
      const id = state.nextId;
      state = {
        items: [...state.items, { id, value: item }],
        nextId: id + 1,
      };
      notify();
      return id;
    },
    remove: (id) => {
      const idx = state.items.findIndex((entry) => entry.id === id);
      if (idx < 0) return false;
      const next = state.items.slice();
      next.splice(idx, 1);
      state = { items: next, nextId: state.nextId };
      notify();
      return true;
    },
    get: (id) => state.items.find((entry) => entry.id === id)?.value,
    update: (id, partial) => {
      const idx = state.items.findIndex((entry) => entry.id === id);
      if (idx < 0) return false;
      const current = state.items[idx];
      if (current === undefined) return false;
      const merged =
        typeof current.value === "object" && current.value !== null
          ? ({ ...(current.value as object), ...partial } as T)
          : (partial as T);
      if (keyBy !== undefined) {
        assertKeyFree("update", keyBy(merged), id);
      }
      const next = state.items.slice();
      next[idx] = { id, value: merged };
      state = { items: next, nextId: state.nextId };
      notify();
      return true;
    },
    findId: (key) => {
      requireKeyBy("findId");
      return keyIndex?.get(key);
    },
    getByKey: (key) => {
      requireKeyBy("getByKey");
      const id = keyIndex?.get(key);
      if (id === undefined) return undefined;
      return state.items.find((entry) => entry.id === id)?.value;
    },
    upsert: (key, item) => {
      const derived = requireKeyBy("upsert")(item);
      if (derived !== key) {
        throw new Error(
          `ReactiveList.upsert: item's derived key ${JSON.stringify(derived)} ` +
            `does not match the lookup key ${JSON.stringify(key)}. ` +
            `upsert(key, item) requires keyBy(item) === key.`,
        );
      }
      // The item's key equals `key`, so replacing the slot that already holds
      // `key` (if any) preserves uniqueness; a fresh key adds a new item. The
      // existing slot is replaced with `item` as-is — no field merge — so the
      // stored value's derived key always equals `key`. Merging `current.value`
      // could retain a stale key-contributing field that `item` omits, leaving
      // the slot indexed under a different key than the caller looked up.
      const existing = keyIndex?.get(key);
      if (existing !== undefined) {
        const idx = state.items.findIndex((entry) => entry.id === existing);
        if (idx >= 0) {
          const next = state.items.slice();
          next[idx] = { id: existing, value: item };
          state = { items: next, nextId: state.nextId };
          notify();
          return existing;
        }
      }
      const id = state.nextId;
      state = {
        items: [...state.items, { id, value: item }],
        nextId: id + 1,
      };
      notify();
      return id;
    },
    list: () => {
      if (listSnapshot === null) {
        listSnapshot = state.items.map((entry) => entry.value);
      }
      return listSnapshot;
    },
    size: () => state.items.length,
    clear: () => {
      if (state.items.length === 0) return;
      state = { items: [], nextId: state.nextId };
      notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    serialize: () => ({
      items: state.items.map((entry) => ({ id: entry.id, value: entry.value })),
      nextId: state.nextId,
    }),
    hydrate: (raw) => {
      if (raw == null || typeof raw !== "object") {
        throw new Error("createList.hydrate: expected object");
      }
      const obj = raw as { items?: unknown; nextId?: unknown };
      if (!Array.isArray(obj.items) || typeof obj.nextId !== "number") {
        throw new Error(
          "createList.hydrate: expected { items: [], nextId: number }",
        );
      }
      // ids are factory-assigned safe integers ≥ 1 and monotonic; nextId must
      // sit strictly above the largest existing id so future `add()` calls
      // don't collide with hydrated rows. Reject anything that would put the
      // list into a self-inconsistent state — `findIndex` would silently
      // return the wrong row, or `update(id)` would shadow an existing entry.
      if (!Number.isSafeInteger(obj.nextId) || obj.nextId < 1) {
        throw new Error(
          `createList.hydrate: nextId must be a safe integer ≥ 1, got ${obj.nextId}`,
        );
      }
      const seenIds = new Set<number>();
      let maxId = 0;
      const items = obj.items.map((entry) => {
        if (entry == null || typeof entry !== "object") {
          throw new Error("createList.hydrate: malformed item");
        }
        const e = entry as { id?: unknown; value?: unknown };
        if (typeof e.id !== "number" || !Number.isSafeInteger(e.id) || e.id < 1) {
          throw new Error(
            `createList.hydrate: item id must be a safe integer ≥ 1, got ${String(e.id)}`,
          );
        }
        if (seenIds.has(e.id)) {
          throw new Error(`createList.hydrate: duplicate item id ${e.id}`);
        }
        seenIds.add(e.id);
        if (e.id > maxId) maxId = e.id;
        return { id: e.id, value: e.value as T };
      });
      if (obj.nextId <= maxId) {
        throw new Error(
          `createList.hydrate: nextId (${obj.nextId}) must be greater than the largest item id (${maxId})`,
        );
      }
      // A keyed list holds at most one item per derived key. Reject a payload
      // that would violate that invariant — otherwise `rebuildIndex` would
      // silently keep only the last item under a shared key and `findId`/
      // `getByKey` would resolve to the wrong row.
      if (keyBy !== undefined) {
        const seenKeys = new Set<ListKey>();
        for (const entry of items) {
          const key = keyBy(entry.value);
          if (seenKeys.has(key)) {
            throw new Error(
              `createList.hydrate: duplicate key ${JSON.stringify(key)}. ` +
                `A keyed list holds at most one item per key.`,
            );
          }
          seenKeys.add(key);
        }
      }
      state = { items, nextId: obj.nextId };
      notify();
    },
    reset: () => {
      state = buildDefault();
      notify();
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// createStore — compound primitive
// ---------------------------------------------------------------------------

/**
 * Builder passed to `createStore` to construct typed leaves. Each method
 * returns a `Reactive*` of the matching shape. Leaves don't carry an id —
 * the compound owns the save contract for the tree.
 */
export interface LeafBuilder {
  value<T, TEncoded = T>(opts: {
    default: T | (() => T);
    codec?: Codec<T, TEncoded>;
  }): ReactiveValue<T, TEncoded>;
  counter(opts?: { default?: number | (() => number) }): ReactiveCounter;
  record<T extends object, TEncoded = T>(opts: {
    default: T | (() => T);
    codec?: Codec<T, TEncoded>;
  }): ReactiveRecord<T, TEncoded>;
  map<K, V>(opts?: {
    default?: Iterable<[K, V]> | (() => Iterable<[K, V]>);
  }): ReactiveMap<K, V>;
  set<K>(opts?: {
    default?: Iterable<K> | (() => Iterable<K>);
  }): ReactiveSet<K>;
  list<T>(opts?: {
    default?: Iterable<T> | (() => Iterable<T>);
    keyBy?: (item: T) => ListKey;
  }): ReactiveList<T>;
}

/** Reserved compound member names — leaf keys cannot collide with these. */
type ReservedKey = "subscribe" | "serialize" | "hydrate" | "reset";

/** Shape of the leaves dictionary returned by a `createStore` builder. */
export type StoreLeaves = {
  [K: string]: Reactive;
} & {
  [K in ReservedKey]?: never;
};

/**
 * Encoded form a single leaf consumes during `hydrate`. Drives `EncodedStore`
 * so migrate return types stay type-safe per leaf shape.
 */
export type EncodedForLeaf<L> =
  L extends ReactiveValue<unknown, infer TE>
    ? { value: TE }
    : L extends ReactiveCounter
      ? number
      : L extends ReactiveMap<infer K, infer V>
        ? Array<[K, V]>
        : L extends ReactiveSet<infer K>
          ? K[]
          : L extends ReactiveList<infer T>
            ? ListEncoded<T>
            : L extends ReactiveRecord<object, infer TE>
              ? TE
              : unknown;

/** Encoded payload for a compound — one entry per leaf, in encoded form. */
export type EncodedStore<L extends StoreLeaves> = {
  [K in keyof L]: EncodedForLeaf<L[K]>;
};

/**
 * A compound store: the leaves dictionary `L` plus the three reactive
 * contracts. Reading from the compound through `useStore(compound)` returns a
 * snapshot of the encoded form; for granular subscriptions read individual
 * leaves directly.
 */
export type ReactiveStore<L extends StoreLeaves> = L &
  Reactive &
  Serializable<EncodedStore<L>> &
  Resettable & {
    readonly [STATE_KIND]: "store";
  };

const RESERVED: ReadonlySet<string> = new Set([
  "subscribe",
  "serialize",
  "hydrate",
  "reset",
]);

interface InternalLeaf {
  key: string;
  leaf: Reactive & Serializable<unknown> & Resettable;
}

/**
 * Define a compound store: many typed leaves bundled into one
 * serialize/restore unit. The builder receives `s` and returns a record of
 * leaves; the result spreads those leaves at the top level so
 * `game.gold.increment()` works.
 */
export function createStore<L extends StoreLeaves>(
  build: (s: LeafBuilder) => L,
): ReactiveStore<L> {
  // Builder methods can't know which property name a leaf will land under —
  // the assignment happens after `s.x()` returns. Collect leaves in insertion
  // order; after `build()` returns we walk the dict and bind each leaf to its
  // key by identity.
  const pending: Array<Reactive & Serializable<unknown> & Resettable> = [];
  const collect = <A extends Reactive & Serializable<unknown> & Resettable>(
    leaf: A,
  ): A => {
    pending.push(leaf);
    return leaf;
  };

  const builder: LeafBuilder = {
    value: (o) =>
      collect(
        createValue({
          default: o.default,
          ...(o.codec !== undefined ? { codec: o.codec } : {}),
        }),
      ),
    counter: (o) =>
      collect(
        createCounter(o?.default !== undefined ? { default: o.default } : {}),
      ),
    record: (o) =>
      collect(
        createRecord({
          default: o.default,
          ...(o.codec !== undefined ? { codec: o.codec } : {}),
        }),
      ),
    map: (o) =>
      collect(
        createMap(o?.default !== undefined ? { default: o.default } : {}),
      ),
    set: (o) =>
      collect(
        createSet(o?.default !== undefined ? { default: o.default } : {}),
      ),
    list: (o) =>
      collect(
        createList({
          ...(o?.default !== undefined ? { default: o.default } : {}),
          ...(o?.keyBy !== undefined ? { keyBy: o.keyBy } : {}),
        }),
      ),
  };

  const leavesDict = build(builder);

  // Bind each leaf to its key by identity. Enforce: no reserved-name
  // collisions, no stray leaves from another scope, no leaf bound to two keys.
  const pendingSet = new Set<unknown>(pending);
  const keyByLeaf = new Map<unknown, string>();
  const internalLeaves: InternalLeaf[] = [];
  for (const [key, leaf] of Object.entries(leavesDict)) {
    if (RESERVED.has(key)) {
      throw new Error(
        `createStore: leaf key "${key}" collides with a reserved member ` +
          `(${[...RESERVED].join(", ")}).`,
      );
    }
    if (!pendingSet.has(leaf)) {
      throw new Error(
        `createStore: "${key}" was not created by this builder. ` +
          `Every leaf must come from the s.* methods passed to the builder.`,
      );
    }
    const prev = keyByLeaf.get(leaf);
    if (prev !== undefined) {
      throw new Error(
        `createStore: the same leaf is assigned to both ` +
          `"${prev}" and "${key}". Each leaf must appear under exactly one key.`,
      );
    }
    keyByLeaf.set(leaf, key);
  }
  for (const leaf of pending) {
    const key = keyByLeaf.get(leaf);
    if (key === undefined) {
      throw new Error(
        `createStore: a leaf was constructed but never assigned to the ` +
          `returned object. Every s.*() result must appear as a property.`,
      );
    }
    internalLeaves.push({
      key,
      leaf: leaf as Reactive & Serializable<unknown> & Resettable,
    });
  }

  // Memoise the encoded snapshot so successive `serialize()` calls between
  // mutations return the same object reference. This keeps `useStore(compound)`
  // stable across React's tearing-detection reads (otherwise the rebuilt dict
  // is a fresh reference every call and `useSyncExternalStore` thinks the
  // snapshot is changing on its own).
  let encodedSnapshot: EncodedStore<L> | null = null;
  const invalidateSnapshot = (): void => {
    encodedSnapshot = null;
  };

  const subscribeAggregate = (listener: () => void): (() => void) => {
    const offs = internalLeaves.map((l) =>
      l.leaf.subscribe(() => {
        invalidateSnapshot();
        listener();
      }),
    );
    return () => {
      for (const off of offs) off();
    };
  };

  // Also invalidate the cached snapshot on every leaf change, even when no
  // external subscriber is attached — otherwise a `serialize()` after a
  // mutation would still return the stale cached value.
  for (const { leaf } of internalLeaves) {
    leaf.subscribe(invalidateSnapshot);
  }

  const serialize = (): EncodedStore<L> => {
    if (encodedSnapshot !== null) return encodedSnapshot;
    const data: Record<string, unknown> = {};
    for (const { key, leaf } of internalLeaves) {
      data[key] = leaf.serialize();
    }
    encodedSnapshot = data as EncodedStore<L>;
    return encodedSnapshot;
  };

  const hydrate = (raw: EncodedStore<L>): void => {
    invalidateSnapshot();
    if (raw == null || typeof raw !== "object") {
      throw new Error(
        `createStore.hydrate: expected object payload, got ${typeof raw}`,
      );
    }
    const dict = raw as Record<string, unknown>;
    // Best-effort atomic hydrate: snapshot every leaf upfront, attempt each
    // decode; on the first failure, roll back only the leaves we actually
    // wrote to. Leaves whose key was absent from `dict` (partial payload, or a
    // newer version that added leaves) were never touched and don't need a
    // restore — re-hydrating them would just fire spurious change events.
    const snapshots = internalLeaves.map(({ leaf }) => leaf.serialize());
    const written: number[] = [];
    try {
      for (let i = 0; i < internalLeaves.length; i += 1) {
        const entry = internalLeaves[i];
        if (entry === undefined) continue;
        if (Object.prototype.hasOwnProperty.call(dict, entry.key)) {
          entry.leaf.hydrate(dict[entry.key]);
          written.push(i);
        }
      }
    } catch (err) {
      for (const i of written) {
        const entry = internalLeaves[i];
        if (entry !== undefined) entry.leaf.hydrate(snapshots[i]);
      }
      throw err;
    }
  };

  const reset = (): void => {
    invalidateSnapshot();
    for (const { leaf } of internalLeaves) leaf.reset();
  };

  const compound = {
    ...leavesDict,
    [STATE_KIND]: "store" as const,
    subscribe: subscribeAggregate,
    serialize,
    hydrate,
    reset,
  };

  return compound as ReactiveStore<L>;
}

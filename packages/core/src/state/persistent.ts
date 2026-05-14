import { createAtom, type Atom } from "./Atom.js";
import { createStore, type Store } from "./Store.js";
import { jsonCodec, setCodec, mapCodec, type Codec } from "./codecs.js";
import type {
  Reactive,
  ReactiveCounter,
  ReactiveList,
  ReactiveMap,
  ReactiveRecord,
  ReactiveSet,
  ReactiveValue,
} from "./reactive.js";

// ---------------------------------------------------------------------------
// Public PersistentLike contract
// ---------------------------------------------------------------------------

/**
 * Common persistence shape implemented by every defineX output and by compound
 * stores. The save layer accepts anything matching this structural type —
 * stores don't depend on the save layer.
 */
export interface PersistentLike {
  readonly id: string;
  readonly version: number;
  serialize(): { version: number; data: unknown };
  hydrate(payload: { version: number; data: unknown }): void;
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Internal leaf protocol
//
// Each leaf in a compound store exposes a small encode/decode surface keyed
// off `LEAF` (a module-private symbol so the protocol doesn't leak into the
// public API). Standalone factories share the same leaf implementation under
// the hood — they just add an id, version, registry hook, and migrate path.
// ---------------------------------------------------------------------------

const LEAF: unique symbol = Symbol("yage.state.leaf");

interface Leaf<TPublic> extends Reactive {
  readonly [LEAF]: {
    encode(): unknown;
    decode(raw: unknown): void;
    reset(): void;
  };
  /** The shape's public surface (counter ops, map ops, etc.). */
  readonly api: TPublic;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by `hydrate` when stored data is from a newer version than this build. */
export class StoreVersionTooNewError extends Error {
  readonly storeId: string;
  readonly storedVersion: number;
  readonly currentVersion: number;
  constructor(storeId: string, storedVersion: number, currentVersion: number) {
    super(
      `Store "${storeId}" was saved at version ${storedVersion}, ` +
        `but this build is at version ${currentVersion}. Cannot downgrade.`,
    );
    this.name = "StoreVersionTooNewError";
    this.storeId = storeId;
    this.storedVersion = storedVersion;
    this.currentVersion = currentVersion;
  }
}

/** Thrown by `hydrate` when stored data is older than the current version and no `migrate` is configured. */
export class StoreMigrationMissingError extends Error {
  readonly storeId: string;
  readonly storedVersion: number;
  readonly currentVersion: number;
  constructor(storeId: string, storedVersion: number, currentVersion: number) {
    super(
      `Store "${storeId}" needs migration from version ${storedVersion} ` +
        `to ${currentVersion}, but no migrate() was provided.`,
    );
    this.name = "StoreMigrationMissingError";
    this.storeId = storeId;
    this.storedVersion = storedVersion;
    this.currentVersion = currentVersion;
  }
}

// ---------------------------------------------------------------------------
// Registry — tracks every defined standalone/compound store so tests can
// reset them all. Keyed by id so a re-evaluation of the same module replaces
// the entry transparently.
// ---------------------------------------------------------------------------

interface RegisteredEntry {
  readonly id: string;
  reset(): void;
}

const registry = new Map<string, RegisteredEntry>();

function register(entry: RegisteredEntry): void {
  registry.set(entry.id, entry);
}

/**
 * Reset every persistent store created by any define* factory back to its
 * defaults. Test-only.
 *
 * @internal
 */
export function _resetAllStoresForTesting(): void {
  for (const entry of registry.values()) entry.reset();
}

/**
 * Drop every persistent store from the internal registry. Use only when you
 * intend to redefine stores with the same ids (e.g. between test files that
 * share a module namespace via Vitest's module cache).
 *
 * @internal
 */
export function _clearStoreRegistryForTesting(): void {
  registry.clear();
}

// ---------------------------------------------------------------------------
// Leaf factories (used by both standalone factories and the compound builder)
// ---------------------------------------------------------------------------

interface ValueLeafOptions<T> {
  defaults: () => T;
  codec?: Codec<T>;
}

function makeValueLeaf<T>(opts: ValueLeafOptions<T>): Leaf<ReactiveValue<T>> {
  const codec = opts.codec ?? jsonCodec<T>();
  const atom: Atom<T> = createAtom<T>(opts.defaults());

  // Phantom brand satisfied via cast — brand is declare-only, no runtime value.
  const api = {
    get: () => atom.get(),
    set: (next: T) => atom.set(next),
    subscribe: (fn: () => void) => atom.subscribe(() => fn()),
  } as unknown as ReactiveValue<T>;

  return {
    api,
    subscribe: api.subscribe,
    [LEAF]: {
      encode: () => ({ value: codec.encode(atom.get()) }),
      decode: (raw) => {
        if (raw == null || typeof raw !== "object" || !("value" in raw)) {
          throw new Error(
            `value leaf decode: expected { value }, got ${typeof raw}`,
          );
        }
        atom.set(codec.decode((raw as { value: unknown }).value));
      },
      reset: () => atom.set(opts.defaults()),
    },
  };
}

interface CounterLeafOptions {
  defaults?: () => number;
}

function makeCounterLeaf(
  opts: CounterLeafOptions,
): Leaf<ReactiveCounter> {
  const defaults = (): number => opts.defaults?.() ?? 0;
  const atom = createAtom<number>(defaults());

  const api: ReactiveCounter = {
    value: () => atom.get(),
    set: (n) => atom.set(n),
    increment: (by = 1) => atom.set(atom.get() + by),
    decrement: (by = 1) => atom.set(atom.get() - by),
    clamp: (value, min, max) => {
      const v = value < min ? min : value > max ? max : value;
      atom.set(v);
    },
    subscribe: (fn) => atom.subscribe(() => fn()),
  };

  return {
    api,
    subscribe: api.subscribe,
    [LEAF]: {
      encode: () => atom.get(),
      decode: (raw) => {
        if (typeof raw !== "number") {
          throw new Error(`counter leaf decode: expected number, got ${typeof raw}`);
        }
        atom.set(raw);
      },
      reset: () => atom.set(defaults()),
    },
  };
}

interface RecordLeafOptions<T extends object> {
  defaults: () => T;
  codec?: Codec<T>;
}

function makeRecordLeaf<T extends object>(
  opts: RecordLeafOptions<T>,
): Leaf<ReactiveRecord<T>> {
  const codec = opts.codec ?? jsonCodec<T>();
  const inner: Store<T> = createStore<T>(opts.defaults());

  // Phantom brand satisfied via cast.
  const api = {
    get: inner.get,
    set: inner.set,
    subscribe: inner.subscribe,
  } as unknown as ReactiveRecord<T>;

  return {
    api,
    subscribe: api.subscribe,
    [LEAF]: {
      encode: () => codec.encode(inner.get() as T),
      decode: (raw) => {
        const next = codec.decode(raw);
        inner.set({ ...next });
      },
      reset: () => inner.set({ ...opts.defaults() }),
    },
  };
}

interface MapLeafOptions<K, V> {
  defaults?: () => Iterable<[K, V]>;
}

function makeMapLeaf<K, V>(opts: MapLeafOptions<K, V>): Leaf<ReactiveMap<K, V>> {
  const defaults = (): Map<K, V> => new Map<K, V>(opts.defaults?.() ?? []);
  const codec = mapCodec<K, V>();
  const atom = createAtom<Map<K, V>>(defaults());

  // Memoise the entries snapshot so repeated reads (e.g. React renders) return
  // the same array reference between mutations. Without this, every `useStore`
  // render would see a fresh array and force a re-render even when nothing
  // changed.
  let entriesSnapshot: Array<[K, V]> | null = null;
  const replace = (next: Map<K, V>): void => {
    entriesSnapshot = null;
    atom.set(next);
  };

  const api: ReactiveMap<K, V> = {
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
  };

  return {
    api,
    subscribe: api.subscribe,
    [LEAF]: {
      encode: () => codec.encode(atom.get()),
      decode: (raw) => replace(codec.decode(raw)),
      reset: () => replace(defaults()),
    },
  };
}

interface SetLeafOptions<K> {
  defaults?: () => Iterable<K>;
}

function makeSetLeaf<K>(opts: SetLeafOptions<K>): Leaf<ReactiveSet<K>> {
  const defaults = (): Set<K> => new Set<K>(opts.defaults?.() ?? []);
  const codec = setCodec<K>();
  const atom = createAtom<Set<K>>(defaults());

  // Memoise the values snapshot — see makeMapLeaf for the rationale.
  let valuesSnapshot: K[] | null = null;
  const replace = (next: Set<K>): void => {
    valuesSnapshot = null;
    atom.set(next);
  };

  const api: ReactiveSet<K> = {
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
  };

  return {
    api,
    subscribe: api.subscribe,
    [LEAF]: {
      encode: () => codec.encode(atom.get()),
      decode: (raw) => replace(codec.decode(raw)),
      reset: () => replace(defaults()),
    },
  };
}

interface ListLeafOptions<T> {
  defaults?: () => Iterable<T>;
}

interface ListSnapshot<T> {
  items: Array<{ id: number; value: T }>;
  nextId: number;
}

function makeListLeaf<T>(opts: ListLeafOptions<T>): Leaf<ReactiveList<T>> {
  const buildDefault = (): ListSnapshot<T> => {
    const items: Array<{ id: number; value: T }> = [];
    let nextId = 1;
    for (const value of opts.defaults?.() ?? []) {
      items.push({ id: nextId, value });
      nextId += 1;
    }
    return { items, nextId };
  };

  let state: ListSnapshot<T> = buildDefault();
  const listeners = new Set<() => void>();

  // Memoise the values snapshot — see makeMapLeaf for the rationale.
  let listSnapshot: T[] | null = null;

  const notify = (): void => {
    listSnapshot = null;
    for (const fn of listeners) fn();
  };

  const api: ReactiveList<T> = {
    add: (item) => {
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
      // Shallow merge for object items; for non-objects, callers should use
      // remove+add instead. Partial<T> permits any subset of T.
      const merged =
        typeof current.value === "object" && current.value !== null
          ? ({ ...(current.value as object), ...partial } as T)
          : (partial as T);
      const next = state.items.slice();
      next[idx] = { id, value: merged };
      state = { items: next, nextId: state.nextId };
      notify();
      return true;
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
  };

  return {
    api,
    subscribe: api.subscribe,
    [LEAF]: {
      encode: () => ({
        items: state.items.map((entry) => ({ id: entry.id, value: entry.value })),
        nextId: state.nextId,
      }),
      decode: (raw) => {
        if (raw == null || typeof raw !== "object") {
          throw new Error("list leaf decode: expected object");
        }
        const obj = raw as { items?: unknown; nextId?: unknown };
        if (!Array.isArray(obj.items) || typeof obj.nextId !== "number") {
          throw new Error("list leaf decode: expected { items: [], nextId: number }");
        }
        const items = obj.items.map((entry) => {
          if (entry == null || typeof entry !== "object") {
            throw new Error("list leaf decode: malformed item");
          }
          const e = entry as { id?: unknown; value?: unknown };
          if (typeof e.id !== "number") {
            throw new Error("list leaf decode: item missing numeric id");
          }
          return { id: e.id, value: e.value as T };
        });
        state = { items, nextId: obj.nextId };
        notify();
      },
      reset: () => {
        state = buildDefault();
        notify();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Standalone factories
// ---------------------------------------------------------------------------

interface BaseOptions {
  /** Schema version. Defaults to 1. Bump when shape changes; provide `migrate`. */
  version?: number;
}

/** Wrap a leaf with id/version/migration to form a top-level PersistentLike. */
function wrapStandalone<TApi, TMigrated>(
  id: string,
  version: number,
  leaf: Leaf<TApi>,
  migrate:
    | ((old: unknown, fromVersion: number) => TMigrated)
    | undefined,
  consumeMigrated: (migrated: TMigrated) => void,
): TApi & PersistentLike {
  const persistent: PersistentLike = {
    id,
    version,
    subscribe: leaf.subscribe,
    serialize: () => ({ version, data: leaf[LEAF].encode() }),
    hydrate: (payload) => {
      if (payload.version > version) {
        throw new StoreVersionTooNewError(id, payload.version, version);
      }
      if (payload.version < version) {
        if (!migrate) {
          throw new StoreMigrationMissingError(id, payload.version, version);
        }
        consumeMigrated(migrate(payload.data, payload.version));
        return;
      }
      leaf[LEAF].decode(payload.data);
    },
  };
  register({ id, reset: () => leaf[LEAF].reset() });
  return Object.assign(leaf.api as object, persistent) as TApi & PersistentLike;
}

// --- defineRecord (was defineStore<T>) ------------------------------------

export interface DefineRecordOptions<T extends object> extends BaseOptions {
  defaults: () => T;
  codec?: Codec<T>;
  /**
   * Migrate previously-stored data to the current version. Receives the raw
   * decoded payload and the version it was written at. Called when
   * `payload.version < version` during `hydrate`.
   */
  migrate?: (old: unknown, fromVersion: number) => T;
}

export interface PersistentRecord<T extends object>
  extends ReactiveRecord<T>,
    PersistentLike {
  reset(): void;
}

export function defineRecord<T extends object>(
  id: string,
  opts: DefineRecordOptions<T>,
): PersistentRecord<T> {
  const version = opts.version ?? 1;
  const leaf = makeRecordLeaf<T>({
    defaults: opts.defaults,
    ...(opts.codec !== undefined ? { codec: opts.codec } : {}),
  });
  const base = wrapStandalone<ReactiveRecord<T>, T>(
    id,
    version,
    leaf,
    opts.migrate,
    (next) => {
      // Migrated value bypasses the leaf's codec — write through the inner
      // record directly so the snapshot reference updates and listeners fire.
      leaf.api.set(next);
    },
  );
  return Object.assign(base, {
    reset: () => leaf[LEAF].reset(),
  }) as PersistentRecord<T>;
}

// --- defineValue ----------------------------------------------------------

export interface DefineValueOptions<T> extends BaseOptions {
  defaults: () => T;
  codec?: Codec<T>;
  /** Migrate older stored data to the current version. */
  migrate?: (old: unknown, fromVersion: number) => T;
}

export interface PersistentValue<T> extends ReactiveValue<T>, PersistentLike {
  reset(): void;
}

export function defineValue<T>(
  id: string,
  opts: DefineValueOptions<T>,
): PersistentValue<T> {
  const version = opts.version ?? 1;
  const leaf = makeValueLeaf<T>({
    defaults: opts.defaults,
    ...(opts.codec !== undefined ? { codec: opts.codec } : {}),
  });
  const base = wrapStandalone<ReactiveValue<T>, T>(
    id,
    version,
    leaf,
    opts.migrate,
    (next) => leaf.api.set(next),
  );
  return Object.assign(base, {
    reset: () => leaf[LEAF].reset(),
  }) as PersistentValue<T>;
}

// --- defineCounter --------------------------------------------------------

export interface DefineCounterOptions extends BaseOptions {
  defaults?: () => number;
  /** Migrate older stored data to the current version. */
  migrate?: (old: unknown, fromVersion: number) => number;
}

export interface PersistentCounter extends ReactiveCounter, PersistentLike {
  reset(): void;
}

export function defineCounter(
  id: string,
  opts?: DefineCounterOptions,
): PersistentCounter {
  const version = opts?.version ?? 1;
  const leaf = makeCounterLeaf({
    ...(opts?.defaults !== undefined ? { defaults: opts.defaults } : {}),
  });
  const base = wrapStandalone<ReactiveCounter, number>(
    id,
    version,
    leaf,
    opts?.migrate,
    (next) => {
      if (typeof next !== "number") {
        throw new Error(
          `defineCounter "${id}".hydrate: migrate returned non-number ${typeof next}`,
        );
      }
      leaf.api.set(next);
    },
  );
  return Object.assign(base, {
    reset: () => leaf[LEAF].reset(),
  }) as PersistentCounter;
}

// --- defineMap ------------------------------------------------------------

export interface DefineMapOptions<K, V> extends BaseOptions {
  defaults?: () => Iterable<[K, V]>;
  /** Migrate older stored data; receives the decoded `[K, V][]` payload. */
  migrate?: (old: unknown, fromVersion: number) => Map<K, V>;
}

export interface PersistentMap<K, V> extends ReactiveMap<K, V>, PersistentLike {
  reset(): void;
}

export function defineMap<K, V>(
  id: string,
  opts?: DefineMapOptions<K, V>,
): PersistentMap<K, V> {
  const version = opts?.version ?? 1;
  const leaf = makeMapLeaf<K, V>({
    ...(opts?.defaults !== undefined ? { defaults: opts.defaults } : {}),
  });
  const base = wrapStandalone<ReactiveMap<K, V>, Map<K, V>>(
    id,
    version,
    leaf,
    opts?.migrate,
    (next) => {
      leaf.api.clear();
      for (const [k, v] of next) leaf.api.set(k, v);
    },
  );
  return Object.assign(base, {
    reset: () => leaf[LEAF].reset(),
  }) as PersistentMap<K, V>;
}

// --- defineSet ------------------------------------------------------------

export interface DefineSetOptions<K> extends BaseOptions {
  defaults?: () => Iterable<K>;
  /** Migrate older stored data; receives the decoded `K[]` payload. */
  migrate?: (old: unknown, fromVersion: number) => Set<K>;
}

export interface PersistentSet<K> extends ReactiveSet<K>, PersistentLike {
  reset(): void;
}

export function defineSet<K>(
  id: string,
  opts?: DefineSetOptions<K>,
): PersistentSet<K> {
  const version = opts?.version ?? 1;
  const leaf = makeSetLeaf<K>({
    ...(opts?.defaults !== undefined ? { defaults: opts.defaults } : {}),
  });
  const base = wrapStandalone<ReactiveSet<K>, Set<K>>(
    id,
    version,
    leaf,
    opts?.migrate,
    (next) => {
      leaf.api.clear();
      for (const k of next) leaf.api.add(k);
    },
  );
  return Object.assign(base, {
    reset: () => leaf[LEAF].reset(),
  }) as PersistentSet<K>;
}

// --- defineList -----------------------------------------------------------

export interface DefineListOptions<T> extends BaseOptions {
  defaults?: () => Iterable<T>;
  /**
   * Migrate older stored data. Receives the raw decoded payload (an object
   * `{ items, nextId }` for v1, or whatever shape older versions stored).
   * Returns the new in-memory items list; ids are reassigned in insertion
   * order starting at 1.
   */
  migrate?: (old: unknown, fromVersion: number) => Iterable<T>;
}

export interface PersistentList<T> extends ReactiveList<T>, PersistentLike {
  reset(): void;
}

export function defineList<T>(
  id: string,
  opts?: DefineListOptions<T>,
): PersistentList<T> {
  const version = opts?.version ?? 1;
  const leaf = makeListLeaf<T>({
    ...(opts?.defaults !== undefined ? { defaults: opts.defaults } : {}),
  });
  const base = wrapStandalone<ReactiveList<T>, Iterable<T>>(
    id,
    version,
    leaf,
    opts?.migrate,
    (next) => {
      leaf.api.clear();
      for (const item of next) leaf.api.add(item);
    },
  );
  return Object.assign(base, {
    reset: () => leaf[LEAF].reset(),
  }) as PersistentList<T>;
}

// ---------------------------------------------------------------------------
// Compound store — defineStore(id, builder, opts?)
//
// The primary surface. A compound collects typed leaves; each keeps its
// native shape API and the tree as a whole registers as one save target.
// ---------------------------------------------------------------------------

/**
 * Builder passed to `defineStore` to construct typed leaves. Each method
 * returns a `Reactive*` of the matching shape. Leaves don't carry an id —
 * the parent compound owns persistence.
 */
export interface LeafBuilder {
  value<T>(opts: { default: T; codec?: Codec<T> }): ReactiveValue<T>;
  counter(opts?: { default?: number }): ReactiveCounter;
  record<T extends object>(opts: {
    defaults: () => T;
    codec?: Codec<T>;
  }): ReactiveRecord<T>;
  map<K, V>(opts?: { defaults?: () => Iterable<[K, V]> }): ReactiveMap<K, V>;
  set<K>(opts?: { defaults?: () => Iterable<K> }): ReactiveSet<K>;
  list<T>(opts?: { defaults?: () => Iterable<T> }): ReactiveList<T>;
}

/** Reserved compound member names — leaf keys cannot collide with these. */
type ReservedKey = "id" | "version" | "subscribe" | "serialize" | "hydrate" | "reset";

/** Type of the leaves dictionary returned by a `defineStore` builder. */
export type CompoundLeaves = {
  [K: string]: Reactive;
} & {
  [K in ReservedKey]?: never;
};

/**
 * A compound store: the leaves dictionary `L` plus PersistentLike + reset.
 *
 * `useStore(compound)` is intentionally not supported — read individual
 * leaves so subscription granularity stays per-leaf.
 */
export type CompoundStore<L extends CompoundLeaves> = L &
  PersistentLike & {
    reset(): void;
  };

export interface DefineStoreOptions<L extends CompoundLeaves> {
  version?: number;
  /**
   * Migrate previously-stored payloads to the current tree shape. Receives the
   * raw decoded `data` (the flat `{ leafKey: leafData }` dict) and the version
   * it was written at. Return the new-format dict to be dispatched to leaves.
   */
  migrate?: (old: unknown, fromVersion: number) => CompoundDataFor<L>;
}

/** Raw data dict for a compound — one entry per leaf. */
export type CompoundDataFor<L extends CompoundLeaves> = {
  [K in keyof L]?: unknown;
};

const RESERVED: ReadonlySet<string> = new Set([
  "id",
  "version",
  "subscribe",
  "serialize",
  "hydrate",
  "reset",
]);

interface InternalLeafRef {
  key: string;
  leaf: Leaf<unknown>;
}

/**
 * Define a compound store: one id, one save target, many typed leaves. The
 * builder receives `s` and returns a record of leaves; the result spreads
 * those leaves at the top level so `compound.gold.increment()` works.
 */
export function defineStore<L extends CompoundLeaves>(
  id: string,
  build: (s: LeafBuilder) => L,
  opts?: DefineStoreOptions<L>,
): CompoundStore<L> {
  const version = opts?.version ?? 1;

  // Builder methods can't know which property name a leaf will land under —
  // the assignment happens after `s.x()` returns. Collect leaves in insertion
  // order; after `build()` returns we walk the dict and bind each leaf to
  // its key by identity.
  const pending: Array<Leaf<unknown>> = [];
  const collect = <A>(leaf: Leaf<A>): A => {
    pending.push(leaf as Leaf<unknown>);
    return leaf.api;
  };
  const internalLeaves: InternalLeafRef[] = [];

  const builder: LeafBuilder = {
    value: (o) =>
      collect(
        makeValueLeaf({
          defaults: () => o.default,
          ...(o.codec !== undefined ? { codec: o.codec } : {}),
        }),
      ),
    counter: (o) =>
      collect(
        makeCounterLeaf(
          o?.default !== undefined ? { defaults: () => o.default as number } : {},
        ),
      ),
    record: (o) =>
      collect(
        makeRecordLeaf({
          defaults: o.defaults,
          ...(o.codec !== undefined ? { codec: o.codec } : {}),
        }),
      ),
    map: (o) =>
      collect(
        makeMapLeaf(
          o?.defaults !== undefined ? { defaults: o.defaults } : {},
        ),
      ),
    set: (o) =>
      collect(
        makeSetLeaf(
          o?.defaults !== undefined ? { defaults: o.defaults } : {},
        ),
      ),
    list: (o) =>
      collect(
        makeListLeaf(
          o?.defaults !== undefined ? { defaults: o.defaults } : {},
        ),
      ),
  };

  const leavesDict = build(builder);

  // Bind each public api to its key by matching identity against `pending`.
  // Three invariants are enforced here, all of which would otherwise be silent
  // footguns: reserved-name collisions, dict values that weren't produced by
  // this builder (e.g. a stray Reactive from another scope), and the same
  // leaf assigned to more than one key (serialize/hydrate would only see the
  // last-bound key, leaving the other property's data orphaned).
  const pendingApis = new Set<unknown>(pending.map((leaf) => leaf.api));
  const keyByApi = new Map<unknown, string>();
  for (const [key, api] of Object.entries(leavesDict)) {
    if (RESERVED.has(key)) {
      throw new Error(
        `defineStore("${id}"): leaf key "${key}" collides with a reserved member ` +
          `(${[...RESERVED].join(", ")}).`,
      );
    }
    if (!pendingApis.has(api)) {
      throw new Error(
        `defineStore("${id}"): "${key}" was not created by this builder. ` +
          `Every leaf must come from the s.* methods passed to the builder.`,
      );
    }
    const prev = keyByApi.get(api);
    if (prev !== undefined) {
      throw new Error(
        `defineStore("${id}"): the same leaf is assigned to both ` +
          `"${prev}" and "${key}". Each leaf must appear under exactly one key.`,
      );
    }
    keyByApi.set(api, key);
  }
  for (const leaf of pending) {
    const key = keyByApi.get(leaf.api);
    if (key === undefined) {
      throw new Error(
        `defineStore("${id}"): a leaf was constructed but never assigned to the ` +
          `returned object. Every s.*() result must appear as a property.`,
      );
    }
    internalLeaves.push({ key, leaf });
  }

  const subscribeAggregate = (listener: () => void): (() => void) => {
    const offs = internalLeaves.map((l) => l.leaf.subscribe(listener));
    return () => {
      for (const off of offs) off();
    };
  };

  const persistent: PersistentLike & { reset(): void } = {
    id,
    version,
    subscribe: subscribeAggregate,
    serialize: () => {
      const data: Record<string, unknown> = {};
      for (const { key, leaf } of internalLeaves) {
        data[key] = leaf[LEAF].encode();
      }
      return { version, data };
    },
    hydrate: (payload) => {
      if (payload.version > version) {
        throw new StoreVersionTooNewError(id, payload.version, version);
      }
      let data: unknown = payload.data;
      if (payload.version < version) {
        if (!opts?.migrate) {
          throw new StoreMigrationMissingError(id, payload.version, version);
        }
        data = opts.migrate(payload.data, payload.version);
      }
      if (data == null || typeof data !== "object") {
        throw new Error(
          `defineStore("${id}").hydrate: expected object payload, got ${typeof data}`,
        );
      }
      const dict = data as Record<string, unknown>;
      // Best-effort atomic hydrate. Snapshot every leaf upfront, then attempt
      // each decode; on the first failure, roll every leaf back to its
      // pre-hydrate state. Subscribers still see the intermediate writes —
      // making decode purely transactional would require a separate "stage
      // then commit" hook in the leaf protocol — but the final state is
      // consistent: either every leaf is at the new payload, or every leaf is
      // back at its prior value.
      const snapshots = internalLeaves.map(({ leaf }) => leaf[LEAF].encode());
      try {
        for (const { key, leaf } of internalLeaves) {
          if (Object.prototype.hasOwnProperty.call(dict, key)) {
            leaf[LEAF].decode(dict[key]);
          }
        }
      } catch (err) {
        for (let i = 0; i < internalLeaves.length; i += 1) {
          const entry = internalLeaves[i];
          if (entry !== undefined) entry.leaf[LEAF].decode(snapshots[i]);
        }
        throw err;
      }
    },
    reset: () => {
      for (const { leaf } of internalLeaves) leaf[LEAF].reset();
    },
  };

  register({ id, reset: persistent.reset });

  return Object.assign({} as L, leavesDict, persistent) as CompoundStore<L>;
}

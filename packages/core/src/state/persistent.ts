import { createAtom, type Atom } from "./Atom.js";
import { createStore, type Store } from "./Store.js";
import { jsonCodec, setCodec, mapCodec, type Codec } from "./codecs.js";

/**
 * Common persistence shape implemented by every defineX output. The save layer
 * accepts anything matching this structural type — stores don't depend on the
 * save layer.
 */
export interface PersistentLike {
  readonly id: string;
  readonly version: number;
  serialize(): { version: number; data: unknown };
  hydrate(payload: { version: number; data: unknown }): void;
  subscribe(listener: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Internal registry — tracks every defined store so tests can reset them all.
// ---------------------------------------------------------------------------

interface RegisteredEntry {
  readonly id: string;
  reset(): void;
}

const registry = new Set<RegisteredEntry>();

function register(factory: string, entry: RegisteredEntry): void {
  for (const existing of registry) {
    if (existing.id === entry.id) {
      throw new Error(
        `${factory}: a store with id "${entry.id}" is already defined. ` +
          `Store ids must be unique.`,
      );
    }
  }
  registry.add(entry);
}

/**
 * Reset every persistent store created by defineStore / defineSet / defineMap /
 * defineCounter back to its defaults. Test-only.
 *
 * @internal
 */
export function _resetAllStoresForTesting(): void {
  for (const entry of registry) entry.reset();
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
// defineStore — object-shaped persistent store
// ---------------------------------------------------------------------------

export interface DefineStoreOptions<T> {
  /** Schema version. Defaults to 1. Bump when shape changes; provide `migrate`. */
  version?: number;
  /** Factory producing the default value. Called on creation and on `reset()`. */
  defaults: () => T;
  /** Codec for `T`. Defaults to identity (jsonCodec). */
  codec?: Codec<T>;
  /**
   * Migrate previously-stored data to the current version. Receives the raw
   * decoded payload and the version it was written at. Called when
   * `payload.version < version` during `hydrate`.
   */
  migrate?: (old: unknown, fromVersion: number) => T;
}

export interface PersistentStore<T extends object>
  extends Store<T>,
    PersistentLike {
  reset(): void;
}

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

export function defineStore<T extends object>(
  id: string,
  opts: DefineStoreOptions<T>,
): PersistentStore<T> {
  const version = opts.version ?? 1;
  const codec: Codec<T> = opts.codec ?? jsonCodec<T>();
  const defaults = opts.defaults;

  const inner = createStore<T>(defaults());

  const replaceAll = (next: T): void => {
    inner.set({ ...next });
  };

  const store: PersistentStore<T> = {
    id,
    version,

    get: inner.get,
    set: inner.set,
    subscribe: inner.subscribe,

    reset(): void {
      replaceAll(defaults());
    },

    serialize(): { version: number; data: unknown } {
      return { version, data: codec.encode(inner.get() as T) };
    },

    hydrate(payload: { version: number; data: unknown }): void {
      if (payload.version > version) {
        throw new StoreVersionTooNewError(id, payload.version, version);
      }
      let next: T;
      if (payload.version < version) {
        if (!opts.migrate) {
          throw new StoreMigrationMissingError(id, payload.version, version);
        }
        next = opts.migrate(payload.data, payload.version);
      } else {
        next = codec.decode(payload.data);
      }
      replaceAll(next);
    },
  };

  register("defineStore", { id, reset: () => store.reset() });
  return store;
}

// ---------------------------------------------------------------------------
// defineSet — persistent set of keys
// ---------------------------------------------------------------------------

export interface PersistentSet<K> extends PersistentLike {
  has(key: K): boolean;
  add(key: K): void;
  remove(key: K): void;
  clear(): void;
  size(): number;
  values(): IterableIterator<K>;
  reset(): void;
}

export interface DefineSetOptions<K> {
  version?: number;
  defaults?: () => Iterable<K>;
  /**
   * Migrate older stored data to the current version. Receives the raw decoded
   * payload (a `K[]` from setCodec) and the version it was written at. Required
   * when bumping `version`; otherwise older payloads throw at hydrate.
   */
  migrate?: (old: unknown, fromVersion: number) => Set<K>;
}

export function defineSet<K>(
  id: string,
  opts?: DefineSetOptions<K>,
): PersistentSet<K> {
  const version = opts?.version ?? 1;
  const defaults = (): Set<K> => new Set<K>(opts?.defaults?.() ?? []);
  const codec = setCodec<K>();
  const atom: Atom<Set<K>> = createAtom<Set<K>>(defaults());

  const replace = (next: Set<K>): void => {
    atom.set(next);
  };

  const store: PersistentSet<K> = {
    id,
    version,

    has(key) {
      return atom.get().has(key);
    },
    add(key) {
      const current = atom.get();
      if (current.has(key)) return;
      const next = new Set(current);
      next.add(key);
      replace(next);
    },
    remove(key) {
      const current = atom.get();
      if (!current.has(key)) return;
      const next = new Set(current);
      next.delete(key);
      replace(next);
    },
    clear() {
      if (atom.get().size === 0) return;
      replace(new Set());
    },
    size() {
      return atom.get().size;
    },
    values() {
      return atom.get().values();
    },

    subscribe(listener) {
      return atom.subscribe(() => listener());
    },

    reset() {
      replace(defaults());
    },

    serialize() {
      return { version, data: codec.encode(atom.get()) };
    },
    hydrate(payload) {
      if (payload.version > version) {
        throw new StoreVersionTooNewError(id, payload.version, version);
      }
      if (payload.version < version) {
        if (!opts?.migrate) {
          throw new StoreMigrationMissingError(id, payload.version, version);
        }
        replace(opts.migrate(payload.data, payload.version));
        return;
      }
      replace(codec.decode(payload.data));
    },
  };

  register("defineSet", { id, reset: () => store.reset() });
  return store;
}

// ---------------------------------------------------------------------------
// defineMap — persistent key→value map
// ---------------------------------------------------------------------------

export interface PersistentMap<K, V> extends PersistentLike {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  remove(key: K): void;
  clear(): void;
  size(): number;
  entries(): IterableIterator<[K, V]>;
  reset(): void;
}

export interface DefineMapOptions<K, V> {
  version?: number;
  defaults?: () => Iterable<[K, V]>;
  /**
   * Migrate older stored data to the current version. Receives the raw decoded
   * payload (a `[K, V][]` from mapCodec) and the version it was written at.
   * Required when bumping `version`; otherwise older payloads throw at hydrate.
   */
  migrate?: (old: unknown, fromVersion: number) => Map<K, V>;
}

export function defineMap<K, V>(
  id: string,
  opts?: DefineMapOptions<K, V>,
): PersistentMap<K, V> {
  const version = opts?.version ?? 1;
  const defaults = (): Map<K, V> => new Map<K, V>(opts?.defaults?.() ?? []);
  const codec = mapCodec<K, V>();
  const atom = createAtom<Map<K, V>>(defaults());

  const replace = (next: Map<K, V>): void => {
    atom.set(next);
  };

  const store: PersistentMap<K, V> = {
    id,
    version,

    has(key) {
      return atom.get().has(key);
    },
    get(key) {
      return atom.get().get(key);
    },
    set(key, value) {
      const current = atom.get();
      if (current.has(key) && Object.is(current.get(key), value)) return;
      const next = new Map(current);
      next.set(key, value);
      replace(next);
    },
    remove(key) {
      const current = atom.get();
      if (!current.has(key)) return;
      const next = new Map(current);
      next.delete(key);
      replace(next);
    },
    clear() {
      if (atom.get().size === 0) return;
      replace(new Map());
    },
    size() {
      return atom.get().size;
    },
    entries() {
      return atom.get().entries();
    },

    subscribe(listener) {
      return atom.subscribe(() => listener());
    },

    reset() {
      replace(defaults());
    },

    serialize() {
      return { version, data: codec.encode(atom.get()) };
    },
    hydrate(payload) {
      if (payload.version > version) {
        throw new StoreVersionTooNewError(id, payload.version, version);
      }
      if (payload.version < version) {
        if (!opts?.migrate) {
          throw new StoreMigrationMissingError(id, payload.version, version);
        }
        replace(opts.migrate(payload.data, payload.version));
        return;
      }
      replace(codec.decode(payload.data));
    },
  };

  register("defineMap", { id, reset: () => store.reset() });
  return store;
}

// ---------------------------------------------------------------------------
// defineCounter — persistent integer counter
// ---------------------------------------------------------------------------

export interface PersistentCounter extends PersistentLike {
  value(): number;
  set(n: number): void;
  increment(by?: number): void;
  decrement(by?: number): void;
  reset(): void;
}

export interface DefineCounterOptions {
  version?: number;
  defaults?: () => number;
  /**
   * Migrate older stored data to the current version. Receives the raw decoded
   * payload (a number) and the version it was written at. Required when
   * bumping `version`; otherwise older payloads throw at hydrate.
   */
  migrate?: (old: unknown, fromVersion: number) => number;
}

export function defineCounter(
  id: string,
  opts?: DefineCounterOptions,
): PersistentCounter {
  const version = opts?.version ?? 1;
  const defaults = (): number => opts?.defaults?.() ?? 0;
  const atom = createAtom<number>(defaults());

  const store: PersistentCounter = {
    id,
    version,

    value() {
      return atom.get();
    },
    set(n) {
      atom.set(n);
    },
    increment(by = 1) {
      atom.set(atom.get() + by);
    },
    decrement(by = 1) {
      atom.set(atom.get() - by);
    },

    subscribe(listener) {
      return atom.subscribe(() => listener());
    },

    reset() {
      atom.set(defaults());
    },

    serialize() {
      return { version, data: atom.get() };
    },
    hydrate(payload) {
      if (payload.version > version) {
        throw new StoreVersionTooNewError(id, payload.version, version);
      }
      if (payload.version < version) {
        if (!opts?.migrate) {
          throw new StoreMigrationMissingError(id, payload.version, version);
        }
        const migrated = opts.migrate(payload.data, payload.version);
        if (typeof migrated !== "number") {
          throw new Error(
            `defineCounter "${id}".hydrate: migrate returned non-number ${typeof migrated}`,
          );
        }
        atom.set(migrated);
        return;
      }
      if (typeof payload.data !== "number") {
        throw new Error(
          `defineCounter "${id}".hydrate: expected number, got ${typeof payload.data}`,
        );
      }
      atom.set(payload.data);
    },
  };

  register("defineCounter", { id, reset: () => store.reset() });
  return store;
}

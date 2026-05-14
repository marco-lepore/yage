import type { Reactive, Serializable } from "@yagejs/core";

/**
 * Pluggable storage backend used by the Save instance. Adapters speak strings
 * — codecs and serialization happen above this layer.
 */
export interface SaveAdapter {
  /** Read raw bytes for a key. Returns null when the key is absent. */
  read(key: string): Promise<string | null>;
  /** Write raw bytes for a key. Overwrites existing value. */
  write(key: string, value: string): Promise<void>;
  /** Delete the value at a key. No-op when absent. */
  delete(key: string): Promise<void>;
  /** List all keys starting with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

/** Public metadata about a single saved slot, returned by `listSlots`. */
export interface SlotInfo<M = unknown> {
  name: string;
  savedAt: number;
  metadata?: M;
}

/** Internal manifest entry stored alongside each store's slots. */
interface ManifestEntry {
  name: string;
  savedAt: number;
  metadata?: unknown;
}

/** Internal manifest format. */
interface SlotManifest {
  version: 1;
  slots: Record<string, ManifestEntry>;
}

/** Thrown by `loadSlot`/`deleteSlot` when the named slot doesn't exist. */
export class SlotNotFoundError extends Error {
  readonly storeId: string;
  readonly slot: string;
  constructor(storeId: string, slot: string) {
    super(`No save found for store "${storeId}" in slot "${slot}".`);
    this.name = "SlotNotFoundError";
    this.storeId = storeId;
    this.slot = slot;
  }
}

/** Thrown when a store id or slot name contains a reserved character. */
export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKeyError";
  }
}

/** Thrown by `restore`/`loadSlot` when stored data is from a newer version than this build. */
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

/** Thrown by `restore`/`loadSlot` when the persisted payload doesn't match the version envelope shape (corrupt, legacy, or written by something other than `Save`). */
export class CorruptPayloadError extends Error {
  readonly storeId: string;
  constructor(storeId: string, detail: string) {
    super(`Save: payload for "${storeId}" is not a valid version envelope (${detail}).`);
    this.name = "CorruptPayloadError";
    this.storeId = storeId;
  }
}

/** Thrown by `restore`/`loadSlot` when stored data is older and no `migrate` was provided. */
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

export interface CreateSaveOptions {
  adapter: SaveAdapter;
}

/** Options for a versioned read (`restore`, `loadSlot`, `autoPersist`). */
export interface RestoreOptions<T> {
  /** Current schema version. Defaults to 1. */
  version?: number;
  /**
   * Migrate previously-stored payload to the current encoded form. Receives
   * the raw decoded payload (whatever shape the older version wrote) and the
   * version it was written at. Return the new encoded form that this build's
   * `Serializable.hydrate` accepts.
   */
  migrate?: (old: unknown, fromVersion: number) => T;
}

/** Options for a versioned write (`persist`, `saveSlot`). */
export interface PersistOptions {
  /** Current schema version. Defaults to 1. */
  version?: number;
}

export interface SaveSlotOptions<M = unknown> extends PersistOptions {
  metadata?: M;
}

interface VersionEnvelope {
  version: number;
  data: unknown;
}

// Each adapter key is built from URI-encoded segments joined by `/`. Encoding
// every user-supplied segment is what guarantees that legal-but-pathological
// store ids or slot names (e.g. id="a/b" or slot="m") can't construct keys
// that overlap with documents, slots, or manifests for other stores. The
// suffix tags (`d`/`s`/`m`) are fixed and never come from user input.
const SEP = "/";
const DOC_TAG = "d";
const SLOT_TAG = "s";
const MANIFEST_TAG = "m";

function validateStoreId(id: string): void {
  if (id.length === 0) {
    throw new InvalidKeyError("Save: store id must be non-empty.");
  }
}

function validateSlotName(slot: string): void {
  if (slot.length === 0) {
    throw new InvalidKeyError("Save: slot name must be non-empty.");
  }
}

function docKey(id: string): string {
  validateStoreId(id);
  return `${encodeURIComponent(id)}${SEP}${DOC_TAG}`;
}

function slotKey(id: string, slot: string): string {
  validateStoreId(id);
  validateSlotName(slot);
  return `${encodeURIComponent(id)}${SEP}${SLOT_TAG}${SEP}${encodeURIComponent(slot)}`;
}

function manifestKey(id: string): string {
  validateStoreId(id);
  return `${encodeURIComponent(id)}${SEP}${MANIFEST_TAG}`;
}

async function readManifest(
  adapter: SaveAdapter,
  id: string,
): Promise<SlotManifest> {
  const raw = await adapter.read(manifestKey(id));
  if (raw == null) return { version: 1, slots: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<SlotManifest>;
    if (parsed && typeof parsed === "object" && parsed.slots) {
      return { version: 1, slots: parsed.slots };
    }
  } catch {
    // Fall through to empty manifest — the next save rewrites it.
  }
  return { version: 1, slots: {} };
}

async function writeManifest(
  adapter: SaveAdapter,
  id: string,
  manifest: SlotManifest,
): Promise<void> {
  await adapter.write(manifestKey(id), JSON.stringify(manifest));
}

function encodeEnvelope<T>(
  thing: Serializable<T>,
  version: number,
): VersionEnvelope {
  return { version, data: thing.serialize() };
}

function applyEnvelope<T>(
  id: string,
  thing: Serializable<T>,
  envelope: VersionEnvelope,
  currentVersion: number,
  migrate: ((old: unknown, fromVersion: number) => T) | undefined,
): void {
  // The envelope comes from JSON.parse on adapter-stored bytes — anything could
  // be on disk (corrupt save, a legacy payload from before this layer existed,
  // a key written by another app sharing the same namespace). Surface a typed
  // save-domain error rather than letting `envelope.version` throw a TypeError
  // or silently feeding `undefined` into hydrate.
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    typeof (envelope as { version?: unknown }).version !== "number" ||
    !("data" in envelope)
  ) {
    throw new CorruptPayloadError(
      id,
      `expected { version: number, data: unknown }, got ${envelope === null ? "null" : typeof envelope}`,
    );
  }
  if (envelope.version > currentVersion) {
    throw new StoreVersionTooNewError(id, envelope.version, currentVersion);
  }
  if (envelope.version < currentVersion) {
    if (!migrate) {
      throw new StoreMigrationMissingError(
        id,
        envelope.version,
        currentVersion,
      );
    }
    thing.hydrate(migrate(envelope.data, envelope.version));
    return;
  }
  thing.hydrate(envelope.data as T);
}

/**
 * Save instance — IO over typed `Serializable` values. Created with
 * `createSave({ adapter })` and registered in the engine via `SavePlugin` so
 * components can resolve it through `SaveServiceKey`.
 */
export class Save {
  readonly adapter: SaveAdapter;

  /**
   * Per-store manifest update queue. Two concurrent saveSlot/deleteSlot calls
   * against the same store would otherwise read-modify-write the manifest
   * blindly — the later writer wins and the earlier change is silently lost.
   * Funnelling manifest mutations through a per-store promise chain serializes
   * them while leaving slot data writes (which target distinct keys)
   * unaffected. Per-store, not global, because manifests for different stores
   * never collide.
   */
  private readonly manifestQueues = new Map<string, Promise<void>>();

  constructor(opts: CreateSaveOptions) {
    this.adapter = opts.adapter;
  }

  /** Persist the value as an unslotted document. */
  async persist<T>(
    id: string,
    thing: Serializable<T>,
    opts?: PersistOptions,
  ): Promise<void> {
    const version = opts?.version ?? 1;
    const payload = encodeEnvelope(thing, version);
    await this.adapter.write(docKey(id), JSON.stringify(payload));
  }

  /**
   * Restore an unslotted document. No-op when the document doesn't exist —
   * the value keeps its current (default) state.
   */
  async restore<T>(
    id: string,
    thing: Serializable<T>,
    opts?: RestoreOptions<T>,
  ): Promise<void> {
    const raw = await this.adapter.read(docKey(id));
    if (raw == null) return;
    const envelope = JSON.parse(raw) as VersionEnvelope;
    applyEnvelope(id, thing, envelope, opts?.version ?? 1, opts?.migrate);
  }

  /**
   * Save into a named slot. The slot manifest is updated with the timestamp
   * and optional metadata.
   */
  async saveSlot<T, M = unknown>(
    id: string,
    slot: string,
    thing: Serializable<T>,
    opts?: SaveSlotOptions<M>,
  ): Promise<void> {
    const version = opts?.version ?? 1;
    const payload = encodeEnvelope(thing, version);
    await this.adapter.write(slotKey(id, slot), JSON.stringify(payload));

    // Slot data is written before the manifest. If the manifest write fails,
    // the slot data exists at its slot key but `listSlots` won't see it
    // (loadSlot can still find it by name). Acceptable for localStorage-class
    // adapters where writes are effectively atomic; adapters with unreliable
    // writes should retry the manifest update or wrap both writes in a
    // transaction.
    const entry: ManifestEntry = {
      name: slot,
      savedAt: Date.now(),
    };
    if (opts?.metadata !== undefined) entry.metadata = opts.metadata;
    await this.updateManifest(id, (manifest) => {
      manifest.slots[slot] = entry;
    });
  }

  /** Load a slot. Throws `SlotNotFoundError` when missing. */
  async loadSlot<T>(
    id: string,
    slot: string,
    thing: Serializable<T>,
    opts?: RestoreOptions<T>,
  ): Promise<void> {
    const raw = await this.adapter.read(slotKey(id, slot));
    if (raw == null) throw new SlotNotFoundError(id, slot);
    const envelope = JSON.parse(raw) as VersionEnvelope;
    applyEnvelope(id, thing, envelope, opts?.version ?? 1, opts?.migrate);
  }

  /** List slots for a store id, optionally filtered by prefix. */
  async listSlots<M = unknown>(
    id: string,
    opts?: { prefix?: string },
  ): Promise<SlotInfo<M>[]> {
    const manifest = await readManifest(this.adapter, id);
    const entries = Object.values(manifest.slots);
    const filtered =
      opts?.prefix !== undefined
        ? entries.filter((e) => e.name.startsWith(opts.prefix as string))
        : entries;
    return filtered.map((e) => {
      const info: SlotInfo<M> = { name: e.name, savedAt: e.savedAt };
      if (e.metadata !== undefined) info.metadata = e.metadata as M;
      return info;
    });
  }

  /** Delete a slot. No-op when the slot doesn't exist. */
  async deleteSlot(id: string, slot: string): Promise<void> {
    // Slot data is deleted before the manifest is updated. If the manifest
    // write fails, the manifest still references a slot whose data is gone
    // and a subsequent `loadSlot` will throw `SlotNotFoundError`. Acceptable
    // for localStorage-class adapters; adapters with unreliable writes should
    // retry the manifest update.
    await this.adapter.delete(slotKey(id, slot));
    await this.updateManifest(id, (manifest) => {
      if (!(slot in manifest.slots)) return;
      // Build a fresh slots map without the deleted entry — avoids dynamic
      // delete on a record (lint: no-dynamic-delete).
      const next: Record<string, ManifestEntry> = {};
      for (const [name, entry] of Object.entries(manifest.slots)) {
        if (name !== slot) next[name] = entry;
      }
      manifest.slots = next;
    });
  }

  /**
   * Read-modify-write the manifest for a store, serialized through the
   * per-store queue. The mutator runs on the freshly-read manifest; if it's
   * a no-op the write is skipped (the mutator can opt out by leaving the
   * passed manifest unchanged — but we always write back to keep the contract
   * predictable; a no-op write is cheap).
   */
  private updateManifest(
    storeId: string,
    mutate: (manifest: SlotManifest) => void,
  ): Promise<void> {
    const prev = this.manifestQueues.get(storeId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const manifest = await readManifest(this.adapter, storeId);
      mutate(manifest);
      await writeManifest(this.adapter, storeId, manifest);
    });
    // Swallow rejections in the chain so a single failure doesn't poison the
    // queue for subsequent updates; callers still see the original rejection
    // because we return `next`, not the swallowed copy.
    this.manifestQueues.set(
      storeId,
      next.catch(() => undefined),
    );
    return next;
  }

  /**
   * Subscribe to a reactive value and persist on every change, coalesced to a
   * single in-flight write per id. Returns a stop function — call it to
   * unsubscribe.
   *
   * Writes are serialized: while a `persist()` is in flight, further changes
   * mark the value dirty and trigger one more write *after* the current one
   * resolves. The last-set state always wins, even on a slow async adapter,
   * because each flush re-reads `thing.serialize()` rather than capturing the
   * value at scheduling time. Multiple synchronous mutations collapse into
   * one write because the dirty flag is consumed atomically.
   *
   * `setTimeout` is intentionally not used here: `Save` runs alongside the
   * page lifecycle, not the engine loop, and may be active before the engine
   * starts or after it stops (e.g. settings menus on a paused game). Using
   * engine-time processes here would tie persistence to a running scheduler.
   */
  autoPersist<T>(
    id: string,
    thing: Serializable<T> & Reactive,
    opts?: PersistOptions,
  ): () => void {
    let inFlight = false;
    let dirty = false;
    let stopped = false;

    const flush = async (): Promise<void> => {
      while (dirty && !stopped) {
        dirty = false;
        try {
          await this.persist(id, thing, opts);
        } catch (err) {
          console.error(
            `autoPersist: failed to persist store "${id}":`,
            err,
          );
        }
      }
      inFlight = false;
    };

    const off = thing.subscribe(() => {
      if (stopped) return;
      dirty = true;
      if (inFlight) return;
      inFlight = true;
      // Defer the first iteration to a microtask so multiple synchronous
      // mutations collapse into one flush iteration.
      queueMicrotask(() => {
        if (stopped) {
          inFlight = false;
          return;
        }
        void flush();
      });
    });

    return () => {
      stopped = true;
      off();
    };
  }
}

/** Construct a Save instance bound to the given adapter. */
export function createSave(opts: CreateSaveOptions): Save {
  return new Save(opts);
}

import type { PersistentLike } from "@yagejs/core";

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

/** Thrown when restoring an unslotted document that doesn't exist. */
export class DocumentNotFoundError extends Error {
  readonly storeId: string;
  constructor(storeId: string) {
    super(`No persisted document found for store "${storeId}".`);
    this.name = "DocumentNotFoundError";
    this.storeId = storeId;
  }
}

export interface CreateSaveOptions {
  adapter: SaveAdapter;
}

const MANIFEST_SUFFIX = ":__slots__";

function docKey(id: string): string {
  return id;
}

function slotKey(id: string, slot: string): string {
  return `${id}:${slot}`;
}

function manifestKey(id: string): string {
  return `${id}${MANIFEST_SUFFIX}`;
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

/**
 * Save instance — IO over typed stores. Created with `createSave({ adapter })`
 * and registered in the engine via `SavePlugin` so components can resolve it
 * through `SaveServiceKey`.
 */
export class Save {
  readonly adapter: SaveAdapter;

  constructor(opts: CreateSaveOptions) {
    this.adapter = opts.adapter;
  }

  /** Persist the store as an unslotted document. */
  async persist(store: PersistentLike): Promise<void> {
    const payload = store.serialize();
    await this.adapter.write(docKey(store.id), JSON.stringify(payload));
  }

  /**
   * Restore an unslotted document into the store. No-op when the document
   * doesn't exist — the store keeps its current (default) value.
   */
  async restore(store: PersistentLike): Promise<void> {
    const raw = await this.adapter.read(docKey(store.id));
    if (raw == null) return;
    store.hydrate(JSON.parse(raw));
  }

  /** Restore many stores in parallel. */
  async restoreAll(stores: PersistentLike[]): Promise<void> {
    await Promise.all(stores.map((s) => this.restore(s)));
  }

  /**
   * Save the store into a named slot. The slot manifest is updated with the
   * timestamp and optional metadata.
   */
  async saveSlot<M = unknown>(
    store: PersistentLike,
    slot: string,
    opts?: { metadata?: M },
  ): Promise<void> {
    const payload = store.serialize();
    await this.adapter.write(slotKey(store.id, slot), JSON.stringify(payload));

    // Slot data is written before the manifest. If the manifest write fails,
    // the slot data exists at `${id}:${slot}` but `listSlots` won't see it
    // (loadSlot can still find it by name). Acceptable for localStorage-class
    // adapters where writes are effectively atomic; adapters with unreliable
    // writes should retry the manifest update or wrap both writes in a
    // transaction.
    const manifest = await readManifest(this.adapter, store.id);
    const entry: ManifestEntry = {
      name: slot,
      savedAt: Date.now(),
    };
    if (opts?.metadata !== undefined) entry.metadata = opts.metadata;
    manifest.slots[slot] = entry;
    await writeManifest(this.adapter, store.id, manifest);
  }

  /** Load a slot into the store. Throws `SlotNotFoundError` when missing. */
  async loadSlot(store: PersistentLike, slot: string): Promise<void> {
    const raw = await this.adapter.read(slotKey(store.id, slot));
    if (raw == null) throw new SlotNotFoundError(store.id, slot);
    store.hydrate(JSON.parse(raw));
  }

  /** List slots for a store, optionally filtered by prefix. */
  async listSlots<M = unknown>(
    store: PersistentLike,
    opts?: { prefix?: string },
  ): Promise<SlotInfo<M>[]> {
    const manifest = await readManifest(this.adapter, store.id);
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
  async deleteSlot(store: PersistentLike, slot: string): Promise<void> {
    // Slot data is deleted before the manifest is updated. If the manifest
    // write fails, the manifest still references a slot whose data is gone
    // and a subsequent `loadSlot` will throw `SlotNotFoundError`. Acceptable
    // for localStorage-class adapters; adapters with unreliable writes
    // should retry the manifest update.
    await this.adapter.delete(slotKey(store.id, slot));
    const manifest = await readManifest(this.adapter, store.id);
    if (slot in manifest.slots) {
      // Build a fresh slots map without the deleted entry — avoids dynamic
      // delete on a record (lint: no-dynamic-delete).
      const next: Record<string, ManifestEntry> = {};
      for (const [name, entry] of Object.entries(manifest.slots)) {
        if (name !== slot) next[name] = entry;
      }
      manifest.slots = next;
      await writeManifest(this.adapter, store.id, manifest);
    }
  }

  /**
   * Subscribe to the store and persist on every change, coalesced to one
   * write per microtask. Returns a stop function — call it to unsubscribe.
   *
   * Multiple synchronous `set` calls (e.g. several `store.set` in a row inside
   * a single event handler) collapse into one write. Each separate user event
   * triggers its own write. For real time-based debouncing across user
   * interactions, wrap the store yourself.
   *
   * `setTimeout` is intentionally not used here: `Save` runs alongside the
   * page lifecycle, not the engine loop, and may be active before the engine
   * starts or after it stops (e.g. settings menus on a paused game). Using
   * engine-time processes here would tie persistence to a running scheduler.
   */
  autoPersist(store: PersistentLike): () => void {
    let scheduled = false;
    let stopped = false;

    const off = store.subscribe(() => {
      if (stopped || scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (stopped) return;
        // Fire-and-forget; surfaces failures via console for visibility.
        this.persist(store).catch((err) => {
          console.error(
            `autoPersist: failed to persist store "${store.id}":`,
            err,
          );
        });
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

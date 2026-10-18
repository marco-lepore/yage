import type { Reactive, Serializable } from "@yagejs/core";

/**
 * Storage backend of a `Save`. Values are strings; envelopes and codecs live
 * above this layer.
 *
 * Every adapter guarantees, for each key:
 *
 * - Atomic replace: after an interrupted `write` or `delete`, `read` returns
 *   the previous value or the new one, never a mix.
 * - Completion: a resolved `write` or `delete` is reflected by every later
 *   `read` and `list`, and is held by the storage when the process is killed
 *   afterwards. Survival of a power loss depends on the storage.
 * - Order: operations on one key take effect in call order.
 * - Failure: an operation that cannot complete rejects; a rejected `write`
 *   leaves the previous value or the new one.
 *
 * Different keys are independent: two writes are never one transaction. State
 * that has to change together belongs in one document.
 */
export interface SaveAdapter {
  /**
   * The value stored at `key`, or `null` when none is. Stored bytes that are
   * not an intact value are returned as stored.
   */
  read(key: string): Promise<string | null>;
  /** Store `value` at `key`, replacing any previous value. */
  write(key: string, value: string): Promise<void>;
  /** Remove the value at `key`. Resolves when none is stored, also when none was. */
  delete(key: string): Promise<void>;
  /**
   * The keys starting with `prefix` that hold a value, in any order. Reflects
   * every operation that completed before the call.
   */
  list(prefix: string): Promise<string[]>;
}

/** Public metadata about a single saved slot, returned by `listSlots`. */
export interface SlotInfo<M = unknown> {
  name: string;
  savedAt: number;
  metadata?: M;
}

/** What one slot key holds: the versioned payload plus the slot's details. */
interface SlotDocument {
  version: number;
  savedAt: number;
  metadata?: unknown;
  data: unknown;
}

/** One live `autoPersist` subscription and the state `flush` reads. */
interface AutoPersistRegistration {
  readonly id: string;
  /** The run that is writing, or `undefined` between runs. */
  chain: Promise<void> | undefined;
  /** The error of the latest write, while no later write has succeeded. */
  failure: { error: unknown } | undefined;
  stopped: boolean;
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
    super(
      `Save: payload for "${storeId}" is not a valid version envelope (${detail}).`,
    );
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
// that overlap with the documents or slots of another store. The tags
// (`d`/`s`/`m`) are fixed and never come from user input. `m` is read only by
// the upgrade that merges a store written by an earlier layout.
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

function slotPrefix(id: string): string {
  validateStoreId(id);
  return `${encodeURIComponent(id)}${SEP}${SLOT_TAG}${SEP}`;
}

function slotKey(id: string, slot: string): string {
  const prefix = slotPrefix(id);
  validateSlotName(slot);
  return `${prefix}${encodeURIComponent(slot)}`;
}

function manifestKey(id: string): string {
  validateStoreId(id);
  return `${encodeURIComponent(id)}${SEP}${MANIFEST_TAG}`;
}

/**
 * Parse bytes that came out of the adapter. Storage is a trust boundary: the
 * bytes can be a hand edit, a key another app wrote into the same namespace,
 * or a damaged file, so a parse failure becomes the save-domain error rather
 * than a raw `SyntaxError`.
 */
function parseDocument(id: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CorruptPayloadError(
      id,
      `bytes are not JSON (${(err as Error).message})`,
    );
  }
}

/** The slot details a document carries, or `null` when it carries none. */
function readSlotInfo<M>(name: string, raw: string): SlotInfo<M> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const document = parsed as Record<string, unknown>;
  if (typeof document["version"] !== "number") return null;
  if (!Object.hasOwn(document, "data")) return null;
  const savedAt = document["savedAt"];
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  const info: SlotInfo<M> = { name, savedAt };
  if (document["metadata"] !== undefined) {
    info.metadata = document["metadata"] as M;
  }
  return info;
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
   * The in-flight upgrade per store id, so the slots of one store are merged
   * into the current layout once per instance.
   */
  private readonly slotUpgrades = new Map<string, Promise<void>>();

  /** Every live `autoPersist` registration, in the order they were made. */
  private readonly registrations = new Set<AutoPersistRegistration>();

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
    const envelope = parseDocument(id, raw) as VersionEnvelope;
    applyEnvelope(id, thing, envelope, opts?.version ?? 1, opts?.migrate);
  }

  /**
   * Save into a named slot. The slot is one document holding the payload, the
   * time it was written and the optional metadata, so the save is a single
   * storage operation.
   */
  async saveSlot<T, M = unknown>(
    id: string,
    slot: string,
    thing: Serializable<T>,
    opts?: SaveSlotOptions<M>,
  ): Promise<void> {
    const key = slotKey(id, slot);
    // Encoded before the first await, so the slot holds the value as it was
    // at the call even when the caller changes it before the write runs.
    const document: SlotDocument = {
      version: opts?.version ?? 1,
      savedAt: Date.now(),
      data: thing.serialize(),
    };
    if (opts?.metadata !== undefined) document.metadata = opts.metadata;
    const payload = JSON.stringify(document);
    await this.upgradeSlots(id);
    await this.adapter.write(key, payload);
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
    const envelope = parseDocument(id, raw) as VersionEnvelope;
    applyEnvelope(id, thing, envelope, opts?.version ?? 1, opts?.migrate);
  }

  /**
   * The store's slots, newest first, optionally filtered by name prefix.
   * Reads every slot document of the store. A document that carries no slot
   * details is left out of the listing and left in storage.
   */
  async listSlots<M = unknown>(
    id: string,
    opts?: { prefix?: string },
  ): Promise<SlotInfo<M>[]> {
    const prefix = slotPrefix(id);
    await this.upgradeSlots(id);
    const keys = await this.adapter.list(prefix);
    const wanted: Array<{ key: string; name: string }> = [];
    for (const key of keys) {
      let name: string;
      try {
        name = decodeURIComponent(key.slice(prefix.length));
      } catch {
        continue;
      }
      if (opts?.prefix !== undefined && !name.startsWith(opts.prefix)) continue;
      wanted.push({ key, name });
    }
    const documents = await Promise.all(
      wanted.map(async (entry) => this.adapter.read(entry.key)),
    );
    const slots: SlotInfo<M>[] = [];
    for (const [index, entry] of wanted.entries()) {
      const raw = documents[index];
      if (raw == null) continue;
      const info = readSlotInfo<M>(entry.name, raw);
      if (info !== null) slots.push(info);
    }
    // Newest first; slot names are unique, so equal times order by name.
    slots.sort((a, b) => b.savedAt - a.savedAt || (a.name < b.name ? -1 : 1));
    return slots;
  }

  /** Delete a slot. No-op when the slot doesn't exist. */
  async deleteSlot(id: string, slot: string): Promise<void> {
    const key = slotKey(id, slot);
    await this.upgradeSlots(id);
    await this.adapter.delete(key);
  }

  /**
   * Merge a store written in the earlier layout, where the slot details lived
   * in a record beside the slot documents, into the slot documents. Runs at
   * most once per store id, before the first slot operation that needs the
   * details. Interrupted, it leaves the earlier record in place and the next
   * slot operation runs it again.
   */
  private upgradeSlots(id: string): Promise<void> {
    const running = this.slotUpgrades.get(id);
    if (running !== undefined) return running;
    const upgrade = this.mergeSlotDetails(id);
    this.slotUpgrades.set(id, upgrade);
    upgrade.catch(() => {
      this.slotUpgrades.delete(id);
    });
    return upgrade;
  }

  private async mergeSlotDetails(id: string): Promise<void> {
    const key = manifestKey(id);
    const raw = await this.adapter.read(key);
    if (raw == null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object") return;
    const slots = (parsed as Record<string, unknown>)["slots"];
    if (slots === null || typeof slots !== "object") return;
    for (const [name, entry] of Object.entries(
      slots as Record<string, unknown>,
    )) {
      if (name.length === 0 || entry === null || typeof entry !== "object") {
        continue;
      }
      const details = entry as Record<string, unknown>;
      const savedAt = details["savedAt"];
      if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) continue;
      const slotKeyForName = slotKey(id, name);
      const stored = await this.adapter.read(slotKeyForName);
      if (stored == null) continue;
      let document: unknown;
      try {
        document = JSON.parse(stored);
      } catch {
        continue;
      }
      if (document === null || typeof document !== "object") continue;
      const fields = document as Record<string, unknown>;
      if (typeof fields["version"] !== "number") continue;
      if (!Object.hasOwn(fields, "data")) continue;
      if (typeof fields["savedAt"] === "number") continue;
      const merged: SlotDocument = {
        version: fields["version"],
        savedAt,
        data: fields["data"],
      };
      if (details["metadata"] !== undefined) {
        merged.metadata = details["metadata"];
      }
      await this.adapter.write(slotKeyForName, JSON.stringify(merged));
    }
    await this.adapter.delete(key);
  }

  /**
   * Subscribe to a reactive value and persist on every change, coalesced to a
   * single in-flight write per id. Returns a stop function — call it to
   * unsubscribe.
   *
   * Writes are serialized: while a `persist()` is in flight, further changes
   * mark the value dirty and trigger one more write *after* the current one
   * resolves. The last-set state always wins, even on a slow async adapter,
   * because each write re-reads `thing.serialize()` rather than capturing the
   * value at scheduling time. Multiple synchronous mutations collapse into
   * one write because the dirty flag is consumed atomically.
   *
   * A failed write is reported: {@link Save.flush} rejects while the latest
   * write of this store has failed, and a failure nothing awaits is an
   * unhandled promise rejection.
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
    validateStoreId(id);
    const registration: AutoPersistRegistration = {
      id,
      chain: undefined,
      failure: undefined,
      stopped: false,
    };
    this.registrations.add(registration);
    let dirty = false;

    const run = async (): Promise<void> => {
      let lastError: { error: unknown } | undefined;
      let wrote = false;
      while (dirty && !registration.stopped) {
        dirty = false;
        wrote = true;
        try {
          await this.persist(id, thing, opts);
          lastError = undefined;
        } catch (error) {
          lastError = { error };
        }
      }
      registration.chain = undefined;
      if (registration.stopped) this.registrations.delete(registration);
      if (!wrote) return;
      registration.failure = lastError;
      if (lastError !== undefined) throw lastError.error;
    };

    const off = thing.subscribe(() => {
      dirty = true;
      if (registration.chain !== undefined) return;
      // Defer the first iteration to a microtask so multiple synchronous
      // mutations collapse into one write. The chain carries the failure of
      // the last write: `flush` takes it, and with no `flush` waiting the
      // rejection is the runtime's own report.
      registration.chain = new Promise<void>((resolve, reject) => {
        queueMicrotask(() => {
          run().then(resolve, reject);
        });
      });
    });

    return () => {
      registration.stopped = true;
      off();
      if (registration.chain === undefined) {
        this.registrations.delete(registration);
      }
    };
  }

  /**
   * Wait for the writes `autoPersist` started or scheduled before this call,
   * including the further writes a change made meanwhile adds to the same
   * chain. Rejects with an `AggregateError` when the latest automatic write
   * of any store failed and no later write of it succeeded.
   */
  async flush(): Promise<void> {
    const snapshot = [...this.registrations];
    const chains: Promise<void>[] = [];
    for (const registration of snapshot) {
      if (registration.chain !== undefined) chains.push(registration.chain);
    }
    await Promise.allSettled(chains);
    const errors: unknown[] = [];
    const ids: string[] = [];
    for (const registration of snapshot) {
      const failure = registration.failure;
      if (failure === undefined) continue;
      errors.push(failure.error);
      ids.push(JSON.stringify(registration.id));
    }
    if (errors.length === 0) return;
    throw new AggregateError(
      errors,
      `Save.flush: automatic writes failed for ${ids.join(", ")}.`,
    );
  }
}

/** Construct a Save instance bound to the given adapter. */
export function createSave(opts: CreateSaveOptions): Save {
  return new Save(opts);
}

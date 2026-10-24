import type { SaveAdapter } from "../Save.js";
import { MAX_KEY_BYTES, exceedsKeyBudget, keyBytes } from "../keyBudget.js";

/** A directory of files that a {@link fileAdapter} keeps its values in. */
export interface SaveFileStore {
  /** The content of the named file, or `null` when no file has that name. */
  read(name: string): Promise<string | null>;
  /**
   * Create or replace the named file. Resolves once the storage holds the
   * content. An interruption may leave a partial file.
   */
  write(name: string, content: string): Promise<void>;
  /** Remove the named file. Resolves when it is absent, also when it never existed. */
  delete(name: string): Promise<void>;
  /** The names of every file in the directory, in any order. */
  list(): Promise<string[]>;
}

export interface FileAdapterOptions {
  /** Where the values live. One adapter per store. */
  store: SaveFileStore;
}

/**
 * RFC 4648 base32 in lower case. A file name therefore holds only `a-z`,
 * `2-7`, `-` and `.`: no path separator, no pair of names that a
 * case-insensitive file system folds together, no reserved device name, and
 * no trailing dot.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const NAME_PREFIX = "k-";
const MAIN_SUFFIX = ".sav";
const SHADOW_SUFFIX = ".new";
const FILE_NAME = /^k-([a-z2-7]*)\.(sav|new)$/;
const FRAME_HEADER = /^yage-save 1 (\d+) ([0-9a-f]{8})\n/;

const encoder = new TextEncoder();

/** The index of the first UTF-16 code unit that has no partner, or `-1`. */
function loneSurrogateIndex(value: string): number {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code >= 0xdc00) return i;
    const next = value.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

function encodeName(key: string): string {
  const bytes = encoder.encode(key);
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return NAME_PREFIX + out;
}

/**
 * The bytes a base32 part stands for, or `null` when it stands for none. The
 * caller has matched {@link FILE_NAME}, so every character is in the
 * alphabet; what is left to reject is a length no byte count produces and
 * trailing bits that are not zero.
 */
function decodeName(encoded: string): Uint8Array | null {
  const remainder = encoded.length % 8;
  if (remainder === 1 || remainder === 3 || remainder === 6) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of encoded) {
    buffer = (buffer << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (bits > 0 && ((buffer << (8 - bits)) & 255) !== 0) return null;
  return new Uint8Array(bytes);
}

/** FNV-1a over the UTF-16 code units, as eight lower-case hex digits. */
function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function frame(value: string): string {
  return `yage-save 1 ${value.length} ${checksum(value)}\n${value}`;
}

/** The value a file holds, or `null` when its content is torn or absent. */
function unframe(content: string | null): string | null {
  if (content === null) return null;
  const match = FRAME_HEADER.exec(content);
  if (match === null) return null;
  const value = content.slice(match[0].length);
  if (value.length !== Number(match[1])) return null;
  if (checksum(value) !== match[2]) return null;
  return value;
}

function checkKey(method: string, key: string): void {
  const index = loneSurrogateIndex(key);
  if (index >= 0) {
    throw new Error(
      `fileAdapter.${method}: key must be a well-formed string, ` +
        `got a lone surrogate at index ${index}.`,
    );
  }
}

/**
 * A `SaveAdapter` over a directory of files whose writes may tear when
 * interrupted. Each value is written to a shadow file first and checksummed,
 * so an interrupted write leaves the previous value or the new one readable.
 * `write` takes keys of at most 96 bytes in UTF-8. No file holds a longer key,
 * so `read` returns `null` for one and `delete` resolves.
 */
export function fileAdapter(options: FileAdapterOptions): SaveAdapter {
  const store = options.store;
  /** The last operation on each key, so operations on one key keep order. */
  const queue = new Map<string, Promise<unknown>>();

  function inOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queue.get(key);
    const next =
      previous === undefined ? operation() : previous.then(operation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queue.set(key, settled);
    void settled.then(() => {
      if (queue.get(key) === settled) queue.delete(key);
    });
    return next;
  }

  function fileNames(key: string): { main: string; shadow: string } {
    const encoded = encodeName(key);
    return { main: encoded + MAIN_SUFFIX, shadow: encoded + SHADOW_SUFFIX };
  }

  return {
    async read(key) {
      checkKey("read", key);
      if (exceedsKeyBudget(key)) return null;
      return inOrder(key, async () => {
        const { main, shadow } = fileNames(key);
        const stored = await store.read(main);
        const value = unframe(stored);
        if (value !== null) return value;
        const held = unframe(await store.read(shadow));
        if (held !== null) return held;
        return stored;
      });
    },

    async write(key, value) {
      checkKey("write", key);
      if (exceedsKeyBudget(key)) {
        throw new Error(
          `fileAdapter.write: key must be at most ${MAX_KEY_BYTES} bytes ` +
            `in UTF-8, got ${keyBytes(key)} (${JSON.stringify(key)}).`,
        );
      }
      const index = loneSurrogateIndex(value);
      if (index >= 0) {
        throw new Error(
          "fileAdapter.write: value must be a well-formed string, " +
            `got a lone surrogate at index ${index}.`,
        );
      }
      return inOrder(key, async () => {
        const { main, shadow } = fileNames(key);
        // Finish an operation an interruption left halfway, so the shadow
        // file is only ever overwritten while the main file is intact. That
        // is what keeps one readable copy through a second interruption.
        const stored = await store.read(main);
        if (unframe(stored) === null) {
          const held = await store.read(shadow);
          if (unframe(held) !== null) await store.write(main, held as string);
        }
        const framed = frame(value);
        await store.write(shadow, framed);
        await store.write(main, framed);
        await store.delete(shadow);
      });
    },

    async delete(key) {
      checkKey("delete", key);
      if (exceedsKeyBudget(key)) return;
      return inOrder(key, async () => {
        const { main, shadow } = fileNames(key);
        // The first removal never takes the only intact copy, so an
        // interruption between the two leaves the key reading its value or
        // nothing.
        if (unframe(await store.read(main)) !== null) {
          await store.delete(shadow);
          await store.delete(main);
        } else {
          await store.delete(main);
          await store.delete(shadow);
        }
      });
    },

    async list(prefix) {
      const mains = new Set<string>();
      const shadows = new Map<string, string>();
      for (const name of await store.list()) {
        const match = FILE_NAME.exec(name);
        if (match === null) continue;
        const bytes = decodeName(match[1] as string);
        if (bytes === null) continue;
        let key: string;
        try {
          key = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          continue;
        }
        if (match[2] === "sav") mains.add(key);
        else shadows.set(key, name);
      }
      const keys: string[] = [];
      for (const key of mains) {
        if (key.startsWith(prefix)) keys.push(key);
      }
      for (const [key, name] of shadows) {
        if (mains.has(key) || !key.startsWith(prefix)) continue;
        if (unframe(await store.read(name)) !== null) keys.push(key);
      }
      return keys;
    },
  };
}

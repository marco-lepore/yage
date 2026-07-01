/**
 * {@link VariableStorage} implementations — the read/write bridge between a
 * conversation and game state. One **opaque** name namespace; scoping is
 * the host's policy. Three building blocks:
 *
 *   • {@link MemoryVariableStorage} — the zero-config default. A plain Map; holds
 *     dialogue-locals and seeded defaults, persists across plays.
 *   • {@link cells} — first-class **two-way binding**: `{ gold: { get, set } }`
 *     drives a value the *script* owns the arithmetic of (a read-only getter
 *     throws on `set`). A bare `() => value` is the read-only shorthand.
 *   • {@link compose} — layer several storages into one (reads/writes route to
 *     the first that `has` the name; a brand-new name lands in the last —
 *     so put a writable store last to catch seeds + locals).
 *   • {@link createRecordStorage} — a storage over a plain mutable
 *     `Record<string, string | number | boolean>` you already own, with no
 *     null guard to write by hand: a `set(name, null)` from the runtime
 *     deletes the key so the record stays typed non-null.
 *
 * The interface lives in `types.ts`; this file is the concrete kit. Seed-if-
 * absent + persistence are policy of the *caller* (`session.play`), not the
 * storage — these just hold values.
 */

import type { VariableStorage, VarMap, VarValue } from "./types.js";

/** Materialize a storage's enumerable variables into a plain map — backs
 *  `{token}` interpolation params and `handle.getVars()`. */
export function materialize(storage: VariableStorage): VarMap {
  const out: VarMap = {};
  for (const [name, value] of storage.entries()) out[name] = value;
  return out;
}

/** The zero-config default storage: a Map-backed, fully-enumerable store. */
export class MemoryVariableStorage implements VariableStorage {
  private readonly map = new Map<string, VarValue>();

  constructor(initial?: Readonly<VarMap>) {
    if (initial) for (const [name, value] of Object.entries(initial)) this.map.set(name, value);
  }

  get(name: string): VarValue | undefined {
    return this.map.get(name);
  }
  set(name: string, value: VarValue): void {
    this.map.set(name, value);
  }
  has(name: string): boolean {
    return this.map.has(name);
  }
  entries(): Iterable<readonly [string, VarValue]> {
    return this.map.entries();
  }
  /** Drop everything — host-controlled reset (variables persist across plays by default). */
  clear(): void {
    this.map.clear();
  }
}

/** A two-way (or read-only) binding for one game-owned value. A bare function is
 *  the read-only shorthand for `{ get }`. */
export type Cell =
  | { get(): VarValue; set?(value: VarValue): void }
  | (() => VarValue);

/**
 * A {@link VariableStorage} over named accessors into game state. `has` is true
 * for exactly the declared names; `get` invokes the getter live; `set` writes
 * through the setter, or throws if the cell is read-only (a getter with no
 * setter). This is the seam for a value whose arithmetic the *script* owns
 * (`set gold = gold - 50`).
 */
export function cells(defs: Readonly<Record<string, Cell>>): VariableStorage {
  // Own-property checks only (like i18n's `interpolate`): a bare `name in defs`
  // walks the prototype chain, so `has("toString")` / `has("constructor")` would
  // report true and read an inherited Object.prototype member as a cell.
  const read = (name: string): VarValue => {
    const cell = defs[name]!;
    return typeof cell === "function" ? cell() : cell.get();
  };
  return {
    get(name) {
      return Object.hasOwn(defs, name) ? read(name) : undefined;
    },
    set(name, value) {
      if (!Object.hasOwn(defs, name)) {
        throw new Error(`dialogue: cells() has no accessor for "${name}"`);
      }
      const cell = defs[name]!;
      if (typeof cell === "function" || cell.set === undefined) {
        throw new Error(
          `dialogue: "${name}" is read-only (a cells getter without a setter)`,
        );
      }
      cell.set(value);
    },
    has(name) {
      return Object.hasOwn(defs, name);
    },
    *entries() {
      for (const name of Object.keys(defs)) yield [name, read(name)] as const;
    },
  };
}

/**
 * A {@link VariableStorage} over a plain mutable record you already own — the
 * zero-guard bridge for the common "back the dialogue namespace with a
 * non-null `Record<string, string | number | boolean>`" case (a reactive game
 * store's record leaf, a save-game blob, …). `get` returns the value or
 * `undefined`; `has` is own-property only; `entries` yields the own entries.
 *
 * The runtime can call `set(name, null)` — from a literal `null` in a `set`
 * directive and from reading an absent variable (`undefined` is coerced to
 * `null`). This helper treats a `null` write as **unset**: it deletes the key
 * rather than storing `null`, so the backing record stays typed non-null and
 * the host's own reads never see a `null` member. Any other value writes
 * through directly. The record is mutated in place — pass the same object the
 * host reads from to keep them in sync.
 */
export function createRecordStorage(
  record: Record<string, string | number | boolean>,
): VariableStorage {
  return {
    get(name) {
      return Object.hasOwn(record, name) ? record[name] : undefined;
    },
    set(name, value) {
      if (value === null) {
        Reflect.deleteProperty(record, name);
        return;
      }
      record[name] = value;
    },
    has(name) {
      return Object.hasOwn(record, name);
    },
    *entries() {
      for (const [name, value] of Object.entries(record)) yield [name, value] as const;
    },
  };
}

/**
 * Layer storages into one. `get`/`has` consult them in order (first that `has`
 * the name wins); `set` writes through the first that `has` it, else the **last**
 * storage — so a brand-new name (a dialogue-local or a seeded default) lands in
 * whatever writable store you put last. Typical: `compose(cells(...game), new
 * MemoryVariableStorage())`.
 */
export function compose(...storages: readonly VariableStorage[]): VariableStorage {
  if (storages.length === 0) {
    throw new Error("dialogue: compose() needs at least one storage");
  }
  const last = storages[storages.length - 1]!;
  return {
    get(name) {
      for (const s of storages) if (s.has(name)) return s.get(name);
      return undefined;
    },
    set(name, value) {
      for (const s of storages) {
        if (s.has(name)) {
          s.set(name, value);
          return;
        }
      }
      last.set(name, value);
    },
    has(name) {
      return storages.some((s) => s.has(name));
    },
    *entries() {
      const seen = new Set<string>();
      for (const s of storages) {
        for (const [name, value] of s.entries()) {
          if (!seen.has(name)) {
            seen.add(name);
            yield [name, value] as const;
          }
        }
      }
    },
  };
}

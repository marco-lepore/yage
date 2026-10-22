import type { LootCount, LootEntry, LootPool, LootTable } from "./types.js";

/** @internal A validated entry with its weight and item quantity filled in. */
export type CompiledEntry<T, C, K extends string> = (
  | Exclude<LootEntry<T, C, K>, { readonly kind: "item" }>
  | (Extract<LootEntry<T, C, K>, { readonly kind: "item" }> & {
      readonly quantity: LootCount;
    })
) & { readonly weight: number | ((context: C) => number) };

/** @internal A validated pool with its roll count filled in. */
export interface CompiledPool<T, C, K extends string> extends Omit<
  LootPool<T, C, K>,
  "rolls" | "entries"
> {
  readonly rolls: LootCount;
  readonly entries: readonly CompiledEntry<T, C, K>[];
}

/** @internal */
export type CompiledTables<T, C, K extends string> = ReadonlyMap<
  K,
  { readonly pools: readonly CompiledPool<T, C, K>[] }
>;

/** @internal */
export function fail(path: string, message: string): never {
  throw new Error(`LootTables.${path}: ${message}`);
}

/** @internal */
export function count(value: LootCount, path: string): LootCount {
  const min = typeof value === "number" ? value : value?.min;
  const max = typeof value === "number" ? value : value?.max;
  for (const [name, n] of [
    ["min", min],
    ["max", max],
  ] as const) {
    if (!Number.isSafeInteger(n) || n < 0)
      fail(path, `${name} must be a nonnegative safe integer, got ${n}`);
  }
  if (min > max || !Number.isSafeInteger(max - min + 1))
    fail(path, `invalid inclusive range ${min}..${max}`);
  return typeof value === "number" ? value : Object.freeze({ min, max });
}

/** @internal */
export function weight(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0)
    fail(path, `weight must be finite and nonnegative, got ${value}`);
  return value;
}

function id(value: string, used: Set<string>, path: string): void {
  if (typeof value !== "string" || !value.trim())
    fail(path, "id must be nonempty");
  if (used.has(value)) fail(path, `duplicate id ${value}`);
  used.add(value);
}

function condition(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "function")
    fail(path, "when must be a function");
}

/** @internal */
export function definitions<T, C, K extends string>(
  input: Readonly<Record<K, LootTable<T, C, K>>>,
): CompiledTables<T, C, K> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("constructor", "catalog must be an object");
  const tables = new Map<K, { pools: readonly CompiledPool<T, C, K>[] }>();
  const ids = new Set<string>();
  for (const key of Object.keys(input) as K[]) {
    id(key, ids, "constructor");
    const table = input[key];
    if (!table || !Array.isArray(table.pools as unknown))
      fail(key, "pools must be an array");
    const pools = new Set<string>();
    tables.set(
      key,
      Object.freeze({
        pools: Object.freeze(
          Array.from(table.pools, (pool): CompiledPool<T, C, K> => {
            if (!pool) fail(key, "pool must be an object");
            id(pool.id, pools, key);
            const path = `${key}/${pool.id}`;
            condition(pool.when, path);
            if (pool.unique !== undefined && typeof pool.unique !== "boolean")
              fail(path, "unique must be a boolean");
            if (!Array.isArray(pool.entries as unknown))
              fail(path, "entries must be an array");
            const entries = new Set<string>();
            return Object.freeze({
              ...pool,
              rolls: count(
                pool.rolls === undefined ? 1 : pool.rolls,
                `${path}.rolls`,
              ),
              entries: Object.freeze(
                Array.from(pool.entries, (entry): CompiledEntry<T, C, K> => {
                  if (!entry) fail(path, "entry must be an object");
                  id(entry.id, entries, path);
                  const location = `${path}/${entry.id}`;
                  condition(entry.when, location);
                  const entryWeight =
                    typeof entry.weight === "function"
                      ? entry.weight
                      : weight(
                          entry.weight === undefined ? 1 : entry.weight,
                          location,
                        );
                  switch (entry.kind) {
                    case "item":
                      if (!("item" in entry))
                        fail(location, "item must be present");
                      return Object.freeze({
                        ...entry,
                        weight: entryWeight,
                        quantity: count(
                          entry.quantity === undefined ? 1 : entry.quantity,
                          `${location}.quantity`,
                        ),
                      });
                    case "table":
                      if (
                        typeof entry.table !== "string" ||
                        !Object.hasOwn(input, entry.table)
                      )
                        fail(location, `unknown table ${entry.table}`);
                      return Object.freeze({ ...entry, weight: entryWeight });
                    case "empty":
                      return Object.freeze({ ...entry, weight: entryWeight });
                    default:
                      return fail(
                        location,
                        "kind must be item, table or empty",
                      );
                  }
                }),
              ),
            });
          }),
        ),
      }),
    );
  }
  // A cycle would expand forever on the first roll that reaches it.
  const checked = new Set<K>();
  const path: K[] = [];
  const visit = (key: K): void => {
    if (path.includes(key))
      fail("constructor", `cycle ${[...path, key].join(" -> ")}`);
    if (checked.has(key)) return;
    path.push(key);
    for (const pool of tables.get(key)!.pools)
      for (const entry of pool.entries)
        if (entry.kind === "table") visit(entry.table);
    path.pop();
    checked.add(key);
  };
  for (const key of tables.keys()) visit(key);
  return tables;
}

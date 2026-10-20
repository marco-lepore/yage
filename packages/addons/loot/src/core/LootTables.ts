import { ErrorBoundary, Logger } from "@yagejs/core";
import { definitions, fail, weight } from "./definitions.js";
import type {
  LootCandidate,
  LootCondition,
  LootCount,
  LootModel,
  LootResult,
  LootReward,
  LootRollOptions,
  LootSource,
  LootTable,
  LootTablesOptions,
  LootTrace,
} from "./types.js";

/** Validated, reusable table definitions. All draw state belongs to a roll call. */
export class LootTables<
  T,
  C = void,
  K extends string = string,
> implements LootModel<T, C, K> {
  readonly tableIds: readonly K[];
  readonly errorBoundary: ErrorBoundary;
  readonly maxWork: number;
  private readonly tables: ReadonlyMap<K, LootTable<T, C, K>>;
  private readonly work: ReadonlyMap<K, number>;

  constructor(
    catalog: Readonly<Record<K, LootTable<T, C, NoInfer<K>>>>,
    options: LootTablesOptions = {},
  ) {
    this.maxWork = options.maxWork ?? 100000;
    if (
      !Number.isSafeInteger(this.maxWork) ||
      this.maxWork < 1 ||
      this.maxWork >= Number.MAX_SAFE_INTEGER
    )
      fail(
        "constructor",
        `maxWork must be a positive safe integer below ${Number.MAX_SAFE_INTEGER}, got ${this.maxWork}`,
      );
    const compiled = definitions(catalog, this.maxWork);
    this.tables = compiled.tables;
    this.work = compiled.work;
    this.tableIds = Object.freeze([...this.tables.keys()]);
    this.errorBoundary =
      options.errorBoundary ?? new ErrorBoundary(new Logger());
  }

  roll(table: K, options: LootRollOptions<C>): LootResult<T> {
    if (!this.tables.has(table)) fail("roll", `unknown table ${table}`);
    if (this.work.get(table)! > this.maxWork)
      fail(
        "roll",
        `${table} exceeds maxWork ${this.maxWork}; reduce rolls or nesting, or raise maxWork`,
      );
    if (!options?.random || typeof options.random.float !== "function")
      fail("roll", "random.float must be a function");
    const boundary = options.errorBoundary ?? this.errorBoundary;
    const context = options.context as C;
    const rewards: LootReward<T>[] = [];
    const trace: LootTrace[] = [];
    let randomDraws = 0;
    let invocationCount = 0;
    const invoke = <V>(kind: string, path: string, fn: () => V): V => {
      let value!: V;
      boundary.wrapCallback(
        () => {
          value = fn();
        },
        { ...options.errorContext, kind: `Loot ${kind}`, event: path },
      );
      return value;
    };
    const random = (path: string): number =>
      invoke("random", path, () => {
        const value = options.random.float();
        if (!Number.isFinite(value) || value < 0 || value >= 1)
          fail(
            path,
            `random.float must return a finite number in [0, 1), got ${value}`,
          );
        randomDraws++;
        return value;
      });
    const sample = (value: LootCount, path: string): number => {
      if (typeof value === "number") return value;
      if (value.min === value.max) return value.min;
      return Math.min(
        value.max,
        value.min + Math.floor(random(path) * (value.max - value.min + 1)),
      );
    };
    const rejection = (
      when: LootCondition<C> | undefined,
      path: string,
    ): string | undefined => {
      if (!when) return undefined;
      return invoke("condition", path, () => {
        const result = when(context);
        if (result === true) return undefined;
        if (result === false) return "condition-failed";
        if (typeof result === "string" && result.trim()) return result;
        return fail(
          path,
          `condition must return a boolean or nonempty rejection reason, got ${String(result)}`,
        );
      });
    };
    const run = (key: K, parent?: LootSource): void => {
      const invocation = invocationCount++;
      for (const pool of this.tables.get(key)!.pools) {
        const path = `${key}/${pool.id}`;
        const base = {
          table: key,
          pool: pool.id,
          invocation,
          ...(parent && { parent }),
        };
        const reason = rejection(pool.when, path);
        if (reason !== undefined) {
          trace.push(
            Object.freeze({
              ...base,
              roll: null,
              status: "condition",
              reason,
              candidates: Object.freeze([]),
            }),
          );
          continue;
        }
        const rolls = sample(pool.rolls ?? 1, `${path}.rolls`);
        if (rolls === 0) {
          trace.push(
            Object.freeze({
              ...base,
              roll: null,
              status: "zero-rolls",
              candidates: Object.freeze([]),
            }),
          );
          continue;
        }
        // Policies are pure and evaluated once per pool invocation.
        const candidates = pool.entries.map((entry): LootCandidate => {
          const location = `${path}/${entry.id}`;
          const reason = rejection(entry.when, location);
          if (reason !== undefined)
            return {
              entry: entry.id,
              weight: 0,
              probability: 0,
              status: "condition",
              reason,
            };
          const evaluate = entry.weight;
          const value =
            typeof evaluate === "function"
              ? invoke("weight", location, () =>
                  weight(evaluate(context), location),
                )
              : (evaluate ?? 1);
          return {
            entry: entry.id,
            weight: value,
            probability: 0,
            status: value === 0 ? "zero-weight" : "eligible",
          };
        });
        const used = new Set<string>();
        for (let roll = 0; roll < rolls; roll++) {
          const available = candidates.map((candidate) =>
            used.has(candidate.entry)
              ? {
                  ...candidate,
                  status: "already-selected" as const,
                  probability: 0,
                }
              : { ...candidate },
          );
          let max = 0;
          for (const candidate of available)
            if (candidate.status === "eligible")
              max = Math.max(max, candidate.weight);
          let total = 0;
          for (const candidate of available)
            if (candidate.status === "eligible")
              total += candidate.weight / max;
          for (const candidate of available)
            if (candidate.status === "eligible")
              candidate.probability = candidate.weight / max / total;
          const explanation = Object.freeze(
            available.map((candidate) => Object.freeze(candidate)),
          );
          if (total === 0) {
            trace.push(
              Object.freeze({
                ...base,
                roll,
                status: "no-eligible",
                candidates: explanation,
              }),
            );
            break;
          }
          // Scale by the largest weight so a sum of finite weights cannot overflow.
          let threshold = random(`${path}[${roll}]`) * total;
          let selected = -1;
          for (let i = 0; i < available.length; i++) {
            const candidate = available[i]!;
            if (candidate.status !== "eligible" || candidate.probability === 0)
              continue;
            selected = i;
            threshold -= candidate.weight / max;
            if (threshold < 0) break;
          }
          const entry = pool.entries[selected]!;
          if (pool.unique) used.add(entry.id);
          const source = Object.freeze({
            table: key,
            pool: pool.id,
            invocation,
            roll,
            entry: entry.id,
          });
          const quantity =
            entry.kind === "item"
              ? sample(entry.quantity ?? 1, `${path}/${entry.id}.quantity`)
              : undefined;
          trace.push(
            Object.freeze({
              ...base,
              roll,
              status: "selected",
              candidates: explanation,
              entry: entry.id,
              kind: entry.kind,
              ...(quantity !== undefined && { quantity }),
            }),
          );
          if (entry.kind === "table") run(entry.table, source);
          else if (entry.kind === "item" && quantity! > 0)
            rewards.push(
              Object.freeze({ item: entry.item, quantity: quantity!, source }),
            );
        }
      }
    };
    run(table);
    return Object.freeze({
      table,
      rewards: Object.freeze(rewards),
      trace: Object.freeze(trace),
      randomDraws,
    });
  }
}

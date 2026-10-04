import { ErrorBoundary, Logger } from "@yagejs/core";
import { FormulaGraph, finite } from "./FormulaGraph.js";
import type { StatFormula } from "./FormulaGraph.js";
import type {
  StatBreakdown,
  StatDefinition,
  StatEffect,
  StatEffectHandle,
  StatModifier,
  StatStacking,
  StatsSnapshot,
  StatValue,
} from "./types.js";

interface Source<K extends string> {
  id: number;
  source: string | null;
  group: string | null;
  rank: number;
  remaining: number | null;
  modifiers: StatModifier<K>[];
}

type StatNode<K extends string> = `${StatValue}:${K}`;
type StatInputs<K extends string> = Omit<StatBreakdown<K>, "value">;

interface Evaluation<K extends string> {
  modifiers: readonly StatModifier<K>[];
  breakdowns: Map<K, StatInputs<K>>;
}

export interface StatsOptions {
  readonly groups?: Readonly<Record<string, StatStacking>>;
  readonly errorBoundary?: ErrorBoundary;
}

/** Numeric stats with explicit modifier math, source ownership, and timed effects. */
export class Stats<K extends string> {
  private readonly definitions = new Map<K, StatDefinition<K>>();
  private bases = new Map<K, number>();
  private sources = new Map<number, Source<K>>();
  private readonly groups = new Map<string, StatStacking>();
  private readonly graph: FormulaGraph<StatNode<K>, Evaluation<K>>;
  readonly keys: readonly K[];
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private evaluating = false;

  constructor(
    definitions: Readonly<Record<K, StatDefinition<NoInfer<K>>>>,
    options: StatsOptions = {},
  ) {
    const formulas = Object.create(null) as Record<
      StatNode<K>,
      StatFormula<StatNode<K>, Evaluation<K>>
    >;
    this.keys = Object.freeze(Object.keys(definitions) as K[]);
    for (const key of this.keys) {
      const input = definitions[key];
      const def: StatDefinition<K> = {
        ...input,
        ...(input.derived
          ? {
              derived: {
                ...input.derived,
                dependencies: input.derived.dependencies.map((dependency) =>
                  typeof dependency === "string"
                    ? dependency
                    : { ...dependency },
                ),
              },
            }
          : {}),
      };
      if (def.derived && typeof def.derived.evaluate !== "function") {
        throw new Error(`Stats: ${key} needs a derived evaluate function`);
      }
      if (def.base !== undefined && def.derived !== undefined) {
        throw new Error(`Stats: ${key} cannot have both base and derived`);
      }
      if (def.min !== undefined) finite(def.min, `Stats(${key}).min`);
      if (def.max !== undefined) finite(def.max, `Stats(${key}).max`);
      if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
        throw new Error(`Stats: ${key} min exceeds max`);
      }
      if (
        def.round !== undefined &&
        !["floor", "ceil", "round"].includes(def.round)
      ) {
        throw new Error(`Stats: invalid rounding for ${key}`);
      }
      this.definitions.set(key, def);
      if (!def.derived)
        this.bases.set(key, finite(def.base ?? 0, `Stats(${key}).base`));
      const baseNode = statNode(key, "base");
      formulas[baseNode] = {
        dependencies:
          def.derived?.dependencies.map((dependency) =>
            typeof dependency === "string"
              ? statNode(dependency)
              : statNode(dependency.stat, dependency.value),
          ) ?? [],
        evaluate: (get, ctx) => {
          const base = def.derived
            ? def.derived.evaluate((stat, value) => get(statNode(stat, value)))
            : this.bases.get(key)!;
          finite(base, `Stats.derived(${key})`);
          const inputs = this.aggregate(key, base, ctx.modifiers);
          ctx.breakdowns.set(key, inputs);
          return inputs.base;
        },
      };
      formulas[statNode(key)] = {
        dependencies: [baseNode],
        evaluate: (get, ctx) => {
          get(baseNode);
          return this.calculate(ctx.breakdowns.get(key)!);
        },
      };
    }

    for (const [key, rule] of Object.entries(options.groups ?? {})) {
      if (!key) throw new Error("Stats: stacking group must not be empty");
      if (!["stack", "latest", "highest"].includes(rule.mode)) {
        throw new Error(`Stats: invalid stacking mode for ${key}`);
      }
      if (rule.mode === "stack") {
        if (
          rule.limit !== undefined &&
          (!Number.isSafeInteger(rule.limit) || rule.limit < 1)
        ) {
          throw new Error(
            `Stats: ${key} limit must be a positive safe integer, got ${rule.limit}`,
          );
        }
        if (
          rule.overflow !== undefined &&
          !["reject", "oldest"].includes(rule.overflow)
        ) {
          throw new Error(`Stats: invalid overflow for ${key}`);
        }
      }
      this.groups.set(key, { ...rule });
    }
    this.graph = new FormulaGraph<StatNode<K>, Evaluation<K>>(
      formulas,
      options.errorBoundary ?? new ErrorBoundary(new Logger()),
    );
  }

  get errorBoundary(): ErrorBoundary {
    return this.graph.errorBoundary;
  }
  set errorBoundary(value: ErrorBoundary) {
    this.graph.errorBoundary = value;
  }

  get(stat: K): number {
    this.definition(stat);
    return this.evaluate((ctx) => this.graph.evaluate(statNode(stat), ctx));
  }

  /** Stored base or derived formula result, plus contributing baseAdd modifiers. */
  getBase(stat: K): number {
    this.definition(stat);
    return this.evaluate((ctx) =>
      this.graph.evaluate(statNode(stat, "base"), ctx),
    );
  }

  values(): Record<K, number> {
    return this.evaluate((ctx) => {
      const values = this.graph.values(ctx);
      return Object.fromEntries(
        this.keys.map((key) => [key, values[statNode(key)]]),
      ) as Record<K, number>;
    });
  }

  explain(stat: K): StatBreakdown<K> {
    this.definition(stat);
    return this.evaluate((ctx) => {
      const value = this.graph.evaluate(statNode(stat), ctx);
      return { ...ctx.breakdowns.get(stat)!, value };
    });
  }

  setBase(stat: K, value: number): void {
    this.setBases({ [stat]: value } as Partial<Record<K, number>>);
  }

  /** Validate all writes before replacing any base. Derived stats are read-only. */
  setBases(values: Partial<Record<K, number>>): void {
    this.writable();
    const entries = Object.entries(values) as [K, number][];
    for (const [key, value] of entries) {
      if (this.definition(key).derived)
        throw new Error(`Stats.setBases: ${key} is derived`);
      finite(value, `Stats.setBases(${key})`);
    }
    for (const [key, value] of entries) this.bases.set(key, value);
    if (entries.length) this.changed();
  }

  /** Replace all modifiers owned by a source. Call again when equipment/config changes. */
  setSource(source: string, modifiers: readonly StatModifier<K>[]): void {
    this.writable();
    name(source, "Stats.setSource");
    const copied = this.copyModifiers(modifiers);
    const entry = copied.length
      ? this.entry({ source, modifiers: copied })
      : undefined;
    for (const [id, current] of this.sources) {
      if (current.source === source) this.sources.delete(id);
    }
    if (entry) this.sources.set(entry.id, entry);
    this.changed();
  }

  removeSource(source: string): number {
    this.writable();
    name(source, "Stats.removeSource");
    let count = 0;
    for (const [id, entry] of this.sources) {
      if (entry.source === source) {
        this.sources.delete(id);
        count++;
      }
    }
    if (count) this.changed();
    return count;
  }

  /** Returns null when a full stack group rejects the incoming effect. */
  addEffect(effect: StatEffect<K>): StatEffectHandle | null {
    this.writable();
    const entry = this.entry(effect);
    const group =
      entry.group === null ? undefined : this.groups.get(entry.group);
    if (group?.mode === "stack" && group.limit !== undefined) {
      const siblings = [...this.sources.values()].filter(
        (item) => item.group === entry.group,
      );
      if (siblings.length >= group.limit) {
        if (group.overflow !== "oldest") return null;
        this.sources.delete(siblings[0]!.id);
      }
    }
    this.sources.set(entry.id, entry);
    const handle = this.handle(entry);
    this.changed();
    return handle;
  }

  /** Advance by seconds supplied by the owner. A zero delta preserves every timer. */
  advance(dt: number): void {
    this.writable();
    finite(dt, "Stats.advance");
    if (dt < 0)
      throw new Error(
        `Stats.advance: expected non-negative seconds, got ${dt}`,
      );
    if (dt === 0) return;
    let expired = false;
    for (const [id, entry] of this.sources) {
      if (entry.remaining === null) continue;
      entry.remaining = Math.max(0, entry.remaining - dt);
      if (entry.remaining === 0) {
        this.sources.delete(id);
        expired = true;
      }
    }
    if (expired) this.changed();
  }

  /** Fires after a mutation or expiry, not for timer countdown alone. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): StatsSnapshot<K> {
    return {
      version: 1,
      nextId: this.nextId,
      bases: Object.fromEntries(this.bases) as Partial<Record<K, number>>,
      sources: [...this.sources.values()].map((entry) => ({
        ...entry,
        modifiers: entry.modifiers.map((modifier) => ({ ...modifier })),
      })),
    };
  }

  /** Validates the complete save before mutation. Definitions and groups come from code. */
  restore(snapshot: unknown): void {
    this.writable();
    const data = object(snapshot, "Stats.restore");
    if (data.version !== 1)
      throw new Error(
        `Stats.restore: unsupported version ${String(data.version)}`,
      );
    const rawBases = object(data.bases, "Stats.restore.bases");
    const bases = new Map<K, number>();
    for (const key of Object.keys(rawBases) as K[]) {
      if (this.definition(key).derived)
        throw new Error(`Stats.restore: ${key} is derived`);
      bases.set(key, number(rawBases[key], `Stats.restore.bases(${key})`));
    }
    for (const [key, def] of this.definitions) {
      if (!def.derived && !bases.has(key))
        throw new Error(`Stats.restore: missing base ${key}`);
    }
    if (!Array.isArray(data.sources))
      throw new Error("Stats.restore: sources must be an array");
    const sources = new Map<number, Source<K>>();
    let maxId = 0;
    for (const raw of data.sources) {
      const item = object(raw, "Stats.restore.source");
      const id = number(item.id, "Stats.restore.id");
      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        id >= Number.MAX_SAFE_INTEGER ||
        sources.has(id)
      ) {
        throw new Error(`Stats.restore: invalid or duplicate id ${id}`);
      }
      if (item.source !== null) name(item.source, "Stats.restore.source");
      if (item.group !== null) {
        name(item.group, "Stats.restore.group");
        this.group(item.group);
      }
      const remaining =
        item.remaining === null
          ? null
          : duration(number(item.remaining, "Stats.restore.remaining"));
      const modifiers = this.copyModifiers(item.modifiers);
      sources.set(id, {
        id,
        source: item.source,
        group: item.group,
        rank: number(item.rank, "Stats.restore.rank"),
        remaining,
        modifiers,
      });
      maxId = Math.max(maxId, id);
    }
    const nextId = number(data.nextId, "Stats.restore.nextId");
    if (!Number.isSafeInteger(nextId) || nextId <= maxId) {
      throw new Error(
        `Stats.restore: nextId must be a safe integer above ${maxId}, got ${nextId}`,
      );
    }
    // IDs define application order, including override and strongest-effect ties.
    const ordered = new Map([...sources].sort(([a], [b]) => a - b));
    for (const [key, rule] of this.groups) {
      if (
        rule.mode === "stack" &&
        rule.limit !== undefined &&
        [...ordered.values()].filter((entry) => entry.group === key).length >
          rule.limit
      ) {
        throw new Error(`Stats.restore: group ${key} exceeds its limit`);
      }
    }
    this.bases = bases;
    this.sources = ordered;
    this.nextId = Math.max(this.nextId, nextId);
    this.changed();
  }

  private definition(stat: K): StatDefinition<K> {
    const def = this.definitions.get(stat);
    if (!def) throw new Error(`Stats: unknown stat ${stat}`);
    return def;
  }

  private group(key: string): StatStacking {
    const group = this.groups.get(key);
    if (!group) throw new Error(`Stats: unknown stacking group ${key}`);
    return group;
  }

  private writable(): void {
    if (this.evaluating)
      throw new Error(
        "Stats: formulas must not mutate or recursively read their stat store",
      );
  }

  private evaluate<T>(read: (context: Evaluation<K>) => T): T {
    this.writable();
    this.evaluating = true;
    try {
      return read({
        modifiers: this.contributors().flatMap((entry) => entry.modifiers),
        breakdowns: new Map(),
      });
    } finally {
      this.evaluating = false;
    }
  }

  private contributors(): Source<K>[] {
    const chosen = new Map<string, Source<K>>();
    for (const entry of this.sources.values()) {
      if (entry.group === null) continue;
      const rule = this.group(entry.group);
      if (rule.mode === "stack") continue;
      const previous = chosen.get(entry.group);
      if (!previous || rule.mode === "latest" || entry.rank >= previous.rank)
        chosen.set(entry.group, entry);
    }
    return [...this.sources.values()].filter(
      (entry) =>
        entry.group === null ||
        this.group(entry.group).mode === "stack" ||
        chosen.get(entry.group) === entry,
    );
  }

  private aggregate(
    stat: K,
    unmodifiedBase: number,
    all: readonly StatModifier<K>[],
  ): StatInputs<K> {
    const modifiers = all.filter((modifier) => modifier.stat === stat);
    let baseAdd = 0,
      flat = 0,
      basePercent = 0,
      percent = 0,
      multiplier = 1;
    let override: number | undefined;
    let priority = -Infinity;
    for (const modifier of modifiers) {
      switch (modifier.operation) {
        case "baseAdd":
          baseAdd += modifier.value;
          break;
        case "flat":
          flat += modifier.value;
          break;
        case "basePercent":
          basePercent += modifier.value;
          break;
        case "percent":
          percent += modifier.value;
          break;
        case "multiply":
          multiplier *= modifier.value;
          break;
        case "override":
          if ((modifier.priority ?? 0) >= priority) {
            override = modifier.value;
            priority = modifier.priority ?? 0;
          }
      }
    }
    const base = finite(unmodifiedBase + baseAdd, `Stats.getBase(${stat})`);
    return {
      stat,
      unmodifiedBase,
      baseAdd,
      base,
      flat,
      basePercent,
      percent,
      multiplier,
      override,
      modifiers: modifiers.map((modifier) => ({ ...modifier })),
    };
  }

  private calculate(inputs: StatInputs<K>): number {
    const { stat, base, basePercent, flat, percent, multiplier, override } =
      inputs;
    const def = this.definition(stat);
    let value =
      override ??
      (base + base * basePercent + flat) * (1 + percent) * multiplier;
    finite(value, `Stats.get(${stat})`);
    if (def.round) value = Math[def.round](value);
    if (def.min !== undefined) value = Math.max(def.min, value);
    if (def.max !== undefined) value = Math.min(def.max, value);
    return value;
  }

  private copyModifiers(raw: unknown): StatModifier<K>[] {
    if (!Array.isArray(raw))
      throw new Error("Stats: modifiers must be an array");
    return raw.map((value: unknown) => {
      const item = object(value, "Stats.modifier");
      name(item.stat, "Stats.modifier.stat");
      const stat = item.stat as K;
      this.definition(stat);
      const operation = item.operation;
      if (
        operation !== "baseAdd" &&
        operation !== "flat" &&
        operation !== "basePercent" &&
        operation !== "percent" &&
        operation !== "multiply" &&
        operation !== "override"
      ) {
        throw new Error(
          `Stats: invalid operation ${String(operation)} for ${stat}`,
        );
      }
      return {
        stat,
        operation,
        value: number(item.value, `Stats.modifier(${stat})`),
        ...(item.priority !== undefined
          ? { priority: number(item.priority, "Stats.modifier.priority") }
          : {}),
      };
    });
  }

  private entry(effect: StatEffect<K>): Source<K> {
    if (effect.source !== undefined)
      name(effect.source, "Stats.addEffect.source");
    if (effect.group !== undefined) this.group(effect.group);
    const modifiers = this.copyModifiers(effect.modifiers);
    const remaining =
      effect.duration === undefined ? null : duration(effect.duration);
    const rank = finite(effect.rank ?? 0, "Stats.addEffect.rank");
    if (this.nextId >= Number.MAX_SAFE_INTEGER)
      throw new Error("Stats: effect id limit reached");
    return {
      id: this.nextId++,
      source: effect.source ?? null,
      group: effect.group ?? null,
      rank,
      remaining,
      modifiers,
    };
  }

  private handle(entry: Source<K>): StatEffectHandle {
    const active = () => this.sources.get(entry.id) === entry;
    const contributing = () => active() && this.contributors().includes(entry);
    return {
      id: entry.id,
      get active() {
        return active();
      },
      get contributing() {
        return contributing();
      },
      get remaining() {
        return active() ? entry.remaining : 0;
      },
      cancel: () => {
        this.writable();
        if (!active()) return false;
        this.sources.delete(entry.id);
        this.changed();
        return true;
      },
      refresh: (seconds) => {
        this.writable();
        duration(seconds);
        if (!active())
          throw new Error(`Stats.refresh: inactive effect ${entry.id}`);
        entry.remaining = seconds;
        this.changed();
      },
    };
  }

  /** Read or cancel a saved effect by its snapshot id. */
  effect(id: number): StatEffectHandle | undefined {
    const entry = this.sources.get(id);
    return entry ? this.handle(entry) : undefined;
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      this.errorBoundary.wrapCallback(listener, {
        kind: "Stats change listener",
      });
    }
  }
}

function name(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${context}: expected a non-empty string`);
}
function number(value: unknown, context: string): number {
  if (typeof value !== "number")
    throw new Error(`${context}: expected a number, got ${String(value)}`);
  return finite(value, context);
}
function duration(value: number): number {
  finite(value, "Stats.duration");
  if (value <= 0)
    throw new Error(`Stats.duration: expected positive seconds, got ${value}`);
  return value;
}
function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${context}: expected an object`);
  return value as Record<string, unknown>;
}

function statNode<K extends string>(
  stat: K,
  value: StatValue = "effective",
): StatNode<K> {
  if (value !== "base" && value !== "effective") {
    throw new Error(`Stats: unknown value ${String(value)} for ${stat}`);
  }
  return `${value}:${stat}`;
}

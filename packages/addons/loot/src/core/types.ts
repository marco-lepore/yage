import type {
  CallbackErrorInfo,
  ErrorBoundary,
  RandomService,
} from "@yagejs/core";

/** Inclusive integer range. Zero is legal for rolls and quantities. */
export type LootCount = number | { readonly min: number; readonly max: number };
/** True accepts; false or a nonempty reason string excludes the pool or entry. */
export type LootCondition<C> = (context: C) => boolean | string;
/** The only random capability required; core's RandomService implements it. */
export type LootRandom = Pick<RandomService, "float">;

interface LootEntryBase<C> {
  /** Unique within its pool. Used in explanations and unique draws. */
  readonly id: string;
  /** Default 1. Zero disables the entry. Must be finite and nonnegative. */
  readonly weight?: number | ((context: C) => number);
  readonly when?: LootCondition<C>;
}

export type LootEntry<T, C = void, K extends string = string> =
  | (LootEntryBase<C> & {
      readonly kind: "item";
      readonly item: T;
      /** Default 1. Zero produces no reward and still consumes the draw. */
      readonly quantity?: LootCount;
    })
  | (LootEntryBase<C> & { readonly kind: "table"; readonly table: K })
  | (LootEntryBase<C> & { readonly kind: "empty" });

export interface LootPool<T, C = void, K extends string = string> {
  readonly id: string;
  readonly entries: readonly LootEntry<T, C, K>[];
  /** Default 1. Every pool runs independently, in definition order. */
  readonly rolls?: LootCount;
  /** Default false. Removes selected entry ids for this pool invocation only. */
  readonly unique?: boolean;
  readonly when?: LootCondition<C>;
}

export interface LootTable<T, C = void, K extends string = string> {
  readonly pools: readonly LootPool<T, C, K>[];
}

export interface LootTablesOptions {
  /** Default 100000. Conservative bound on candidate visits and nested rolls. */
  readonly maxWork?: number;
  /** Used headlessly when a roll does not supply its host's boundary. */
  readonly errorBoundary?: ErrorBoundary;
}

export type LootRollOptions<C = void> = {
  readonly random: LootRandom;
  readonly errorBoundary?: ErrorBoundary;
  /** Host names attached to callback failures; supplied by LootComponent. */
  readonly errorContext?: Readonly<Pick<CallbackErrorInfo, "entity" | "scene">>;
} & (undefined extends C ? { readonly context?: C } : { readonly context: C });

export interface LootSource {
  readonly table: string;
  readonly pool: string;
  /** Table invocation within this roll, starting at zero. */
  readonly invocation: number;
  /** Zero-based draw index. */
  readonly roll: number;
  readonly entry: string;
}

export interface LootReward<T> {
  /** Opaque game-owned value; never cloned, frozen or modified by the addon. */
  readonly item: T;
  readonly quantity: number;
  readonly source: LootSource;
}

export interface LootCandidate {
  readonly entry: string;
  readonly weight: number;
  /** Conditional probability for this draw, after filtering. */
  readonly probability: number;
  readonly status:
    | "eligible"
    | "condition"
    | "zero-weight"
    | "already-selected";
  readonly reason?: string;
}

export interface LootTrace {
  readonly table: string;
  readonly pool: string;
  readonly invocation: number;
  /** Null for a skipped pool; otherwise a zero-based draw index. */
  readonly roll: number | null;
  readonly status: "selected" | "no-eligible" | "condition" | "zero-rolls";
  readonly candidates: readonly LootCandidate[];
  readonly entry?: string;
  readonly kind?: "item" | "table" | "empty";
  readonly quantity?: number;
  readonly reason?: string;
  /** Parent table selection, for a nested invocation. */
  readonly parent?: LootSource;
}

export interface LootResult<T> {
  readonly table: string;
  readonly rewards: readonly LootReward<T>[];
  readonly trace: readonly LootTrace[];
  readonly randomDraws: number;
}

/** Selection details without opaque item values, for Inspector and logging. */
export interface LootDiagnostics {
  readonly table: string;
  readonly rewards: readonly Omit<LootReward<never>, "item">[];
  readonly trace: readonly LootTrace[];
  readonly randomDraws: number;
}

/** Replaceable headless contract consumed by LootComponent. */
export interface LootModel<T, C = void, K extends string = string> {
  readonly tableIds: readonly K[];
  roll(table: K, options: LootRollOptions<C>): LootResult<T>;
}

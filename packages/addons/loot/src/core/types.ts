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

export type LootRollOptions<C = void> = {
  readonly random: LootRandom;
  /** Records callback failures. Default: logs them in development builds only. */
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

interface LootCandidateBase {
  readonly entry: string;
  /** Effective weight; zero for an entry its condition refused. */
  readonly weight: number;
  /** Conditional probability for this draw, after filtering. */
  readonly probability: number;
}

/** One entry's standing in one draw. Only `eligible` entries can be selected. */
export type LootCandidate =
  | (LootCandidateBase & {
      readonly status: "eligible" | "zero-weight" | "already-selected";
    })
  | (LootCandidateBase & {
      readonly status: "condition";
      /** `condition-failed`, or the string the condition returned. */
      readonly reason: string;
    });

interface LootTraceBase {
  readonly table: string;
  readonly pool: string;
  /** Table invocation within this roll, starting at zero. */
  readonly invocation: number;
  /** Empty for a skipped pool. */
  readonly candidates: readonly LootCandidate[];
  /** Parent table selection, for a nested invocation. */
  readonly parent?: LootSource;
}

/** One pool decision: a draw, or the reason the pool did not draw. */
export type LootTrace =
  | (LootTraceBase & {
      readonly status: "selected";
      /** Zero-based draw index. */
      readonly roll: number;
      readonly entry: string;
      readonly kind: "item";
      readonly quantity: number;
    })
  | (LootTraceBase & {
      readonly status: "selected";
      readonly roll: number;
      readonly entry: string;
      readonly kind: "table" | "empty";
    })
  | (LootTraceBase & {
      /** Every candidate is excluded; the pool's remaining draws stop. */
      readonly status: "no-eligible";
      readonly roll: number;
    })
  | (LootTraceBase & {
      /** The pool's condition refused it. */
      readonly status: "condition";
      readonly roll: null;
      readonly reason: string;
    })
  | (LootTraceBase & {
      readonly status: "zero-rolls";
      readonly roll: null;
    });

export interface LootResult<T> {
  readonly table: string;
  readonly rewards: readonly LootReward<T>[];
  readonly trace: readonly LootTrace[];
  /** Values read from the random source during this roll. */
  readonly randomDraws: number;
}

/** Replaceable headless contract consumed by LootComponent. */
export interface LootModel<T, C = void, K extends string = string> {
  roll(table: K, options: LootRollOptions<C>): LootResult<T>;
}

import type { ErrorBoundary } from "@yagejs/core";

export type HotbarActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** A running cooldown, read from the timer that owns it. */
export interface HotbarCooldown {
  /** Seconds until the action is ready. */
  readonly remaining: number;
  /** Elapsed fraction from 0 to 1, where 1 means ready. Same scale as `ProcessSlot.ratio`. */
  readonly ratio: number;
}

/** Live values owned by the action's source. */
export interface HotbarBindingState {
  readonly available?: boolean;
  readonly reason?: string;
  readonly count?: number;
  readonly cooldown?: HotbarCooldown;
}

export interface HotbarBinding {
  readonly label: string;
  /** Registered renderer texture key; ignored by a text-only presenter. */
  readonly icon?: string;
  /** Pure, synchronous query. Omit for an always-available action. */
  readonly read?: () => HotbarBindingState;
  /** Request activation from the authoritative owner. Must be synchronous. */
  readonly activate: () => HotbarActionResult;
  /** Ends a held action when the input that activated it is released. Omit for press-only actions. */
  readonly release?: () => void;
}

export interface HotbarOptions<TId extends string> {
  readonly bindings: Readonly<Record<TId, HotbarBinding>>;
  /** Default: 8. Must be a positive integer. */
  readonly slotCount?: number;
  /** Initial assignments, padded with empty slots. Default: all empty. */
  readonly slots?: readonly (NoInfer<TId> | null)[];
  readonly selected?: number;
  /** Standalone callback reporting. A mounted controller uses the scene boundary. */
  readonly errorBoundary?: ErrorBoundary;
}

export interface HotbarSlot<TId extends string = string> {
  readonly index: number;
  readonly bindingId: TId | null;
  readonly label: string;
  readonly icon?: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly count: number | null;
  readonly cooldown: HotbarCooldown | null;
}

export interface HotbarActivation<TId extends string = string> {
  readonly slot: number;
  readonly bindingId: TId | null;
  readonly result: HotbarActionResult;
}

export interface HotbarSnapshot<TId extends string = string> {
  readonly version: 1;
  readonly slots: readonly (TId | null)[];
  readonly selected: number;
}

/** Snapshot entries `restore()` could not apply to the current bar. */
export interface HotbarRestoreResult {
  readonly dropped: readonly {
    readonly slot: number;
    readonly bindingId: string;
  }[];
}

export type HotbarEvent<TId extends string = string> =
  | { readonly type: "changed"; readonly snapshot: HotbarSnapshot<TId> }
  | { readonly type: "activation"; readonly activation: HotbarActivation<TId> };

export interface HotbarState<TId extends string = string> {
  readonly slots: readonly HotbarSlot<TId>[];
  readonly selected: number;
  readonly lastActivation: HotbarActivation<TId> | null;
}

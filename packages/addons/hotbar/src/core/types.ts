import type { ErrorBoundary } from "@yagejs/core";

export type HotbarActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Live values owned by the action's source. Durations are in seconds. */
export interface HotbarBindingState {
  readonly available?: boolean;
  readonly reason?: string;
  readonly count?: number;
  readonly cooldown?: {
    readonly remaining: number;
    readonly total: number;
  };
}

export interface HotbarBinding {
  readonly label: string;
  /** Registered renderer texture key; ignored by a text-only presenter. */
  readonly icon?: string;
  /** Pure, synchronous query. Omit for an always-available action. */
  readonly read?: () => HotbarBindingState;
  /** Request activation from the authoritative owner. Must be synchronous. */
  readonly activate: () => HotbarActionResult;
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
  readonly cooldown: {
    readonly remaining: number;
    readonly total: number;
  } | null;
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

export type HotbarEvent<TId extends string = string> =
  | { readonly type: "changed"; readonly snapshot: HotbarSnapshot<TId> }
  | { readonly type: "activation"; readonly activation: HotbarActivation<TId> };

export interface HotbarState<TId extends string = string> {
  readonly slots: readonly HotbarSlot<TId>[];
  readonly selected: number;
  readonly lastActivation: HotbarActivation<TId> | null;
}

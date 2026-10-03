export type StatValue = "base" | "effective";

/** A string reads effective value; an object selects the value explicitly. */
export type StatDependency<K extends string> =
  | K
  | {
      readonly stat: K;
      readonly value: StatValue;
    };

/** Reads a declared dependency. The default value is effective. */
export type StatReader<K extends string> = (
  stat: K,
  value?: StatValue,
) => number;

export interface DerivedStatFormula<K extends string> {
  readonly dependencies: readonly StatDependency<K>[];
  readonly evaluate: (get: StatReader<K>) => number;
}

export type StatOperation =
  | "baseAdd"
  | "flat"
  | "basePercent"
  | "percent"
  | "multiply"
  | "override";

export interface StatModifier<K extends string> {
  readonly stat: K;
  readonly operation: StatOperation;
  /** Percentages are fractions; multiply uses a factor (1.2 = ×1.2). */
  readonly value: number;
  /** Highest priority override wins; newest source wins ties. Default: 0. */
  readonly priority?: number;
}

export interface StatBreakdown<K extends string> {
  readonly stat: K;
  /** Stored base or derived formula result, before source contributions. */
  readonly unmodifiedBase: number;
  /** Sum of contributing baseAdd modifiers. */
  readonly baseAdd: number;
  /** unmodifiedBase + baseAdd; the value used by basePercent. */
  readonly base: number;
  readonly flat: number;
  readonly basePercent: number;
  readonly percent: number;
  readonly multiplier: number;
  readonly override: number | undefined;
  readonly value: number;
  readonly modifiers: readonly StatModifier<K>[];
}

export interface StatDefinition<K extends string> {
  readonly base?: number;
  /** Mutually exclusive with base. Dependencies select base or effective values. */
  readonly derived?: DerivedStatFormula<K>;
  readonly min?: number;
  readonly max?: number;
  /** Applied before min/max bounds. */
  readonly round?: "floor" | "ceil" | "round";
}

export type StatStacking =
  | {
      readonly mode: "stack";
      readonly limit?: number;
      readonly overflow?: "reject" | "oldest";
    }
  | { readonly mode: "latest" | "highest" };

export interface StatEffect<K extends string> {
  readonly modifiers: readonly StatModifier<K>[];
  /** Ownership for removeSource(). */
  readonly source?: string;
  /** Omit for an indefinite effect; otherwise positive finite seconds. */
  readonly duration?: number;
  /** Must name a configured stacking group. Ungrouped effects all stack. */
  readonly group?: string;
  /** Highest wins in a highest group; newest wins ties. Default: 0. */
  readonly rank?: number;
}

export interface StatEffectHandle {
  readonly id: number;
  /** Present, including while suppressed by another effect. */
  readonly active: boolean;
  /** Whether this effect currently contributes modifiers. */
  readonly contributing: boolean;
  /** null means indefinite; 0 means removed or expired. */
  readonly remaining: number | null;
  cancel(): boolean;
  /** Reset remaining duration. Throws on an inactive handle. */
  refresh(duration: number): void;
}

export interface StatSourceSnapshot<K extends string> {
  readonly id: number;
  readonly source: string | null;
  readonly group: string | null;
  readonly rank: number;
  readonly remaining: number | null;
  readonly modifiers: readonly StatModifier<K>[];
}

export interface StatsSnapshot<K extends string> {
  readonly version: 1;
  readonly nextId: number;
  readonly bases: Partial<Record<K, number>>;
  readonly sources: readonly StatSourceSnapshot<K>[];
}

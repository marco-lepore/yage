/**
 * Tunable inputs a scenario exposes in the lab panel. A control is plain data,
 * so a scenario file declares one without pulling in any runtime engine code.
 */

export interface NumberControl {
  readonly kind: "number" | "int";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly label?: string | undefined;
}

export interface BooleanControl {
  readonly kind: "boolean";
  readonly value: boolean;
  readonly label?: string | undefined;
}

export interface SelectControl<O extends string = string> {
  readonly kind: "select";
  readonly value: O;
  readonly options: readonly O[];
  readonly label?: string | undefined;
}

export type ControlDef = NumberControl | BooleanControl | SelectControl;

/** The `controls` object of a scenario. */
export type ControlSchema = Record<string, ControlDef>;

/** What a control is worth at runtime, once the panel has a value for it. */
export type ControlValue = number | boolean | string;

/** The second argument of `setup`, `scene` and `onMounted`. */
export type ControlValues<C extends ControlSchema> = {
  [P in keyof C]: C[P] extends SelectControl<infer O>
    ? O
    : C[P] extends BooleanControl
      ? boolean
      : number;
};

export interface NumberControlOptions {
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export interface IntControlOptions {
  min?: number;
  max?: number;
  label?: string;
}

export interface LabelOnlyOptions {
  label?: string;
}

/**
 * Ranges default to one that contains `value`, so a control with no explicit
 * bounds is still draggable to and from its starting point.
 */
function resolveRange(
  kind: "number" | "int",
  value: number,
  min: number | undefined,
  max: number | undefined,
): { min: number; max: number } {
  const lo = min ?? Math.min(0, value);
  const hi = max ?? Math.max(1, value * 2, value);
  requireFinite(kind, "min", lo);
  requireFinite(kind, "max", hi);
  if (lo > hi) {
    throw new Error(
      `control.${kind}(): min (${lo}) is greater than max (${hi}).`,
    );
  }
  if (value < lo || value > hi) {
    throw new Error(
      `control.${kind}(): value ${value} is outside the range ${lo}..${hi}.`,
    );
  }
  return { min: lo, max: hi };
}

function requireFinite(kind: string, name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `control.${kind}(): ${name} must be a finite number, got ${value}.`,
    );
  }
}

export const control = {
  /** A slider over a continuous range. `step` defaults to 0.01. */
  number(value: number, opts: NumberControlOptions = {}): NumberControl {
    requireFinite("number", "value", value);
    const step = opts.step ?? 0.01;
    requireFinite("number", "step", step);
    if (!(step > 0)) {
      throw new Error(
        `control.number(): step must be greater than 0, got ${step}.`,
      );
    }
    return {
      kind: "number",
      value,
      ...resolveRange("number", value, opts.min, opts.max),
      step,
      label: opts.label,
    };
  },

  /** A slider constrained to whole numbers. */
  int(value: number, opts: IntControlOptions = {}): NumberControl {
    if (!Number.isInteger(value)) {
      throw new Error(`control.int(): value ${value} is not an integer.`);
    }
    return {
      kind: "int",
      value,
      ...resolveRange("int", value, opts.min, opts.max),
      step: 1,
      label: opts.label,
    };
  },

  /** A checkbox. */
  boolean(value: boolean, opts: LabelOnlyOptions = {}): BooleanControl {
    return { kind: "boolean", value, label: opts.label };
  },

  /**
   * A dropdown over a fixed set of strings. `options` is inferred as literal
   * types, so `setup` sees the union rather than `string` and no `as const` is
   * needed at the call site.
   */
  select<const O extends string>(
    value: O,
    options: readonly O[],
    opts: LabelOnlyOptions = {},
  ): SelectControl<O> {
    if (options.length === 0) {
      throw new Error(`control.select(): options must not be empty.`);
    }
    if (!options.includes(value)) {
      throw new Error(
        `control.select(): value "${value}" is not one of ${options.join(", ")}.`,
      );
    }
    return { kind: "select", value, options, label: opts.label };
  },
};

/** The starting value of every control in a schema. */
export function controlDefaults(
  controls: ControlSchema | undefined,
): Record<string, ControlValue> {
  const values: Record<string, ControlValue> = {};
  for (const [name, def] of Object.entries(controls ?? {})) {
    values[name] = def.value;
  }
  return values;
}

/**
 * Brings an incoming value into what the control accepts, clamping a number to
 * the range and rounding an int. A value of the wrong kind throws instead: the
 * panel's widgets cannot produce one, so it only ever comes from a caller of
 * `LabApi.setControl` that got it wrong, and silently substituting the default
 * would rebuild a scene that looks nothing like what was asked for.
 */
export function coerceControlValue(
  def: ControlDef,
  value: ControlValue,
): ControlValue {
  if (def.kind === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`Expected a boolean, got ${JSON.stringify(value)}.`);
    }
    return value;
  }
  if (def.kind === "select") {
    if (typeof value !== "string" || !def.options.includes(value)) {
      throw new Error(
        `Expected one of ${def.options.join(", ")}, got ${JSON.stringify(value)}.`,
      );
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected a finite number, got ${JSON.stringify(value)}.`);
  }
  const clamped = Math.min(def.max, Math.max(def.min, value));
  return def.kind === "int" ? Math.round(clamped) : clamped;
}

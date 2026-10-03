import { ErrorBoundary, Logger } from "@yagejs/core";

/** A synchronous, pure numeric formula. Every read must name a dependency. */
export interface StatFormula<K extends string, C = void> {
  readonly dependencies: readonly K[];
  readonly evaluate: (get: (key: K) => number, context: C) => number;
}

/** Named numeric formulas, evaluated once per node per evaluation. */
export class FormulaGraph<K extends string, C = void> {
  readonly keys: readonly K[];
  errorBoundary: ErrorBoundary;
  private readonly nodes = new Map<K, StatFormula<K, C>>();

  constructor(
    formulas: Readonly<Record<K, StatFormula<NoInfer<K>, C>>>,
    errorBoundary = new ErrorBoundary(new Logger()),
  ) {
    this.errorBoundary = errorBoundary;
    this.keys = Object.freeze(Object.keys(formulas) as K[]);
    for (const key of this.keys) {
      const formula = formulas[key];
      if (typeof formula.evaluate !== "function") {
        throw new Error(`FormulaGraph: ${key} needs an evaluate function`);
      }
      this.nodes.set(key, {
        dependencies: [...formula.dependencies],
        evaluate: formula.evaluate,
      });
    }
    const visited = new Set<K>();
    const path: K[] = [];
    const visit = (key: K): void => {
      if (path.includes(key)) {
        throw new Error(`FormulaGraph: cycle ${[...path, key].join(" -> ")}`);
      }
      if (visited.has(key)) return;
      const node = this.node(key);
      path.push(key);
      for (const dependency of node.dependencies) visit(dependency);
      path.pop();
      visited.add(key);
    };
    for (const key of this.keys) visit(key);
  }

  evaluate(key: K, context: C): number {
    return this.reader(context)(key);
  }

  /** A detached record suitable for a hit-time snapshot or a formula breakdown. */
  values(context: C): Record<K, number> {
    const read = this.reader(context);
    return Object.fromEntries(
      this.keys.map((key) => [key, read(key)]),
    ) as Record<K, number>;
  }

  private node(key: K): StatFormula<K, C> {
    const node = this.nodes.get(key);
    if (!node) throw new Error(`FormulaGraph: unknown formula ${key}`);
    return node;
  }

  private reader(context: C): (key: K) => number {
    const values = new Map<K, number>();
    const read = (key: K): number => {
      const cached = values.get(key);
      if (cached !== undefined) return cached;
      const node = this.node(key);
      // Evaluate declared dependencies even when a conditional branch skips a read.
      for (const dependency of node.dependencies) read(dependency);
      let value = 0;
      this.errorBoundary.wrapCallback(
        () => {
          value = node.evaluate((dependency) => {
            if (!node.dependencies.includes(dependency)) {
              throw new Error(
                `FormulaGraph: ${key} read undeclared dependency ${dependency}`,
              );
            }
            return read(dependency);
          }, context);
          finite(value, `FormulaGraph.evaluate(${key})`);
        },
        { kind: "Stats formula", event: key },
      );
      values.set(key, value);
      return value;
    };
    return read;
  }
}

/** @internal */
export function finite(value: number, context: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${context}: expected a finite number, got ${value}`);
  }
  return value;
}

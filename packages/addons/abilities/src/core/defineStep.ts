import type {
  PointStep,
  PointStepHooks,
  WindowStep,
  WindowStepHooks,
} from "./types.js";

/**
 * Define a point-in-time step factory: the returned function takes the
 * step's params plus `at` and produces a `PointStep`.
 */
export function defineStep<P extends object>(
  kind: string,
  hooks: PointStepHooks<P>,
): (args: P & { at: number }) => PointStep<P>;
/**
 * Define a timed-window step factory: the returned function takes the
 * step's params plus `from`/`to`/`every` and produces a `WindowStep`.
 */
export function defineStep<P extends object>(
  kind: string,
  hooks: WindowStepHooks<P>,
): (
  args: P & { from: number; to: number | "end"; every?: number },
) => WindowStep<P>;
export function defineStep<P extends object>(
  kind: string,
  hooks: PointStepHooks<P> | WindowStepHooks<P>,
): (args: P & Record<string, unknown>) => PointStep<P> | WindowStep<P> {
  if (isPointHooks(hooks)) {
    return (args) => {
      const { at, ...rest } = args as P & { at: number };
      return { kind, at, params: rest as P, hooks };
    };
  }
  return (args) => {
    const { from, to, every, ...rest } = args as P & {
      from: number;
      to: number | "end";
      every?: number;
    };
    const step: WindowStep<P> = { kind, from, to, params: rest as P, hooks };
    if (every !== undefined) step.every = every;
    return step;
  };
}

function isPointHooks<P>(
  hooks: PointStepHooks<P> | WindowStepHooks<P>,
): hooks is PointStepHooks<P> {
  return "fire" in hooks;
}

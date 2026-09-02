import { ErrorBoundaryKey } from "@yagejs/core";
import type {
  CallbackErrorInfo,
  Component,
  Entity,
  ErrorBoundary,
} from "@yagejs/core";

/**
 * The boundary a component's throws should be attributed to, or `undefined`
 * before the component is wired to a scene (tests, a component built but not
 * yet added).
 * @internal
 */
export function boundaryFor(component: Component): ErrorBoundary | undefined {
  return (component.entity as Entity | undefined)?.tryScene?.context.tryResolve(
    ErrorBoundaryKey,
  );
}

/**
 * Run a game-supplied callback that returns a value, attributing a throw to
 * the callback rather than to the engine code that called it. The error is
 * recorded, logged, and rethrown — nothing is swallowed.
 * @internal
 */
export function attributed<T>(
  boundary: ErrorBoundary | undefined,
  info: CallbackErrorInfo,
  fn: () => T,
): T {
  if (!boundary) return fn();
  let value!: T;
  boundary.wrapCallback(() => {
    value = fn();
  }, info);
  return value;
}

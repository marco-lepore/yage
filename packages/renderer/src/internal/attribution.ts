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

/**
 * Run a game-supplied callback that returns nothing, naming the component's
 * entity and scene in the report. The callback reaches `wrapCallback`
 * directly, so an async callback's rejection is attributed too.
 *
 * The boundary is resolved per call rather than cached: a component can be
 * constructed before its entity joins a scene, and the entity's scene can
 * change afterwards. An entity with no scene has no boundary to report
 * through, so the callback runs directly and its throw propagates unchanged.
 * @internal
 */
export function runAttributed(
  component: Component,
  kind: string,
  fn: () => void,
): void {
  const boundary = boundaryFor(component);
  if (!boundary) {
    fn();
    return;
  }
  const entity = component.entity as Entity | undefined;
  const scene = entity?.tryScene;
  boundary.wrapCallback(fn, {
    kind,
    ...(entity?.name !== undefined ? { entity: entity.name } : {}),
    ...(scene?.name !== undefined ? { scene: scene.name } : {}),
  });
}

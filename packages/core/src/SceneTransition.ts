import type { Scene } from "./Scene.js";
import type { EngineContext } from "./EngineContext.js";

/** Which scene op triggered this transition. */
export type SceneTransitionKind = "push" | "pop" | "replace";

/** Context passed to a transition each frame. */
export interface SceneTransitionContext {
  /** Wall-clock ms elapsed since begin(). */
  readonly elapsed: number;
  readonly kind: SceneTransitionKind;
  readonly engineContext: EngineContext;
  /** The scene being left or removed (undefined on first push). */
  readonly fromScene: Scene | undefined;
  /** The scene being entered or revealed (undefined on last pop). */
  readonly toScene: Scene | undefined;
}

/**
 * A scene transition animates the handoff between scene stack states.
 *
 * `SceneManager` keeps both the outgoing and incoming scenes on the stack
 * for the transition's duration, then removes the outgoing scene afterward.
 * Transitions use raw wall-clock dt and ignore engine + scene `timeScale`.
 */
export interface SceneTransition {
  /** Total duration in wall-clock ms. */
  readonly duration: number;
  /** Called once when the transition starts. Set up resources here. */
  begin?(ctx: SceneTransitionContext): void;
  /** Called each frame with frame dt in ms. `ctx.elapsed` is clamped to `duration`. */
  tick(dt: number, ctx: SceneTransitionContext): void;
  /** Called when the transition ends. Tear down resources here. */
  end?(ctx: SceneTransitionContext): void;
}

/** Options accepted by `SceneManager.push/pop/replace`. */
export interface SceneTransitionOptions {
  transition?: SceneTransition;
}

/**
 * Resolve the effective transition for a scene op.
 * Precedence: call-site option → destination's `defaultTransition` → undefined.
 */
export function resolveTransition(
  callSite: SceneTransition | undefined,
  destination: Scene | undefined,
): SceneTransition | undefined {
  if (callSite) return callSite;
  return destination?.defaultTransition;
}

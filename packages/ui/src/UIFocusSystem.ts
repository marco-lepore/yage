import {
  devWarn,
  Phase,
  SceneManagerKey,
  ServiceKey,
  System,
} from "@yagejs/core";
import type { EngineContext, SceneManager } from "@yagejs/core";
import { clearPointerRequest } from "./focus/pointer-request.js";
import type { UIFocusInputSource } from "./focus/UIFocusScope.js";
import { UIFocusStack, UIFocusStackKey } from "./focus/UIFocusStack.js";

/**
 * The well-known service id owned by `@yagejs/input`, re-declared here so
 * `@yagejs/ui` has no runtime dependency on that optional peer. Typed by the
 * structural `UIFocusInputSource` to keep its types out of this package too.
 */
const INPUT_SOURCE_KEY = new ServiceKey<UIFocusInputSource>("inputManager");

/**
 * Drives keyboard and gamepad focus: one scope, once a frame.
 *
 * Runs in `LateUpdate` at priority `202`, after `UILayoutSystem` and the React
 * root layout (both `200`) and the floating overlay (`201`), so every
 * rectangle it searches was computed this frame.
 *
 * It walks the whole scene stack, paused scenes included, so a pause menu
 * shown over a paused scene takes the keyboard. Layout and hit testing are
 * not filtered by pause either.
 */
export class UIFocusSystem extends System {
  readonly phase = Phase.LateUpdate;
  readonly priority = 202;

  private sceneManager!: SceneManager;
  private input: UIFocusInputSource | null = null;
  private _missingInputWarned = false;
  // Reused, so a frame with no focus work allocates nothing.
  private readonly _stacks: UIFocusStack[] = [];

  onRegister(context: EngineContext): void {
    this.sceneManager = context.resolve(SceneManagerKey);
    this.input = context.tryResolve(INPUT_SOURCE_KEY) ?? null;
  }

  update(): void {
    this._stacks.length = 0;
    let driven: UIFocusStack | null = null;
    // Bottom to top, so the last stack reporting a shown scope is the topmost
    // scene's.
    for (const scene of this.sceneManager.all) {
      const stack = scene.tryResolveScoped(UIFocusStackKey);
      if (stack === undefined) continue;
      this._stacks.push(stack);
      if (stack._observe()) driven = stack;
    }
    for (const stack of this._stacks) {
      if (stack === driven) stack._drive(this.input);
      else stack._suspend();
    }
    // On a frame with no driven scope nothing took the pointer request, and
    // leaving it would keep its element reachable.
    clearPointerRequest();
    if (
      driven === null ||
      this.input !== null ||
      this._missingInputWarned ||
      !driven._hasDeviceScope()
    ) {
      return;
    }
    this._missingInputWarned = true;
    devWarn(
      "UIFocusSystem: no input manager is registered, so focus scopes read " +
        "no keyboard or gamepad. Install @yagejs/input, or drive a scope " +
        "with move(), activate() and cancel().",
    );
  }
}

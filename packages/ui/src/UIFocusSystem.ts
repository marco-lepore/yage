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
 * `@yagejs/input` is an optional peer — this package must work with it absent
 * from the consumer's install. Re-declaring the well-known service id here,
 * instead of importing `InputManagerKey`, keeps `@yagejs/ui` free of a runtime
 * dependency on it, and typing the key by the structural `UIFocusInputSource`
 * keeps the input package's types out of this package's declarations.
 */
const INPUT_SOURCE_KEY = new ServiceKey<UIFocusInputSource>("inputManager");

/**
 * Drives keyboard and gamepad focus: one scope, once a frame.
 *
 * Runs in `LateUpdate` at priority `202` — after `UILayoutSystem` and the
 * React root layout (both `200`) and after the floating overlay (`201`), so
 * every rectangle it searches was computed this frame, and the repaint and
 * the scroll it causes reach the renderer in that same frame.
 *
 * It walks the whole scene stack rather than the unpaused scenes, so the
 * commonest pause menu works: a game that pauses its scene and shows an
 * overlay keeps a menu the keyboard reaches, the same menu the mouse already
 * reaches, because layout and hit testing are not filtered by pause either.
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
    // The driven scope already took the pointer's focus request. On a frame
    // with no scope to drive nothing did, and a request left in the shared
    // cell would keep its element reachable until the next pointer move.
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

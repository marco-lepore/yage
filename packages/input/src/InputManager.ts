import { Vec2 } from "@yage/core";
import type { ActionMapDefinition, CameraLike } from "./types.js";

/** Central input state manager. Resolved via DI with InputManagerKey. */
export class InputManager {
  private pressedKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private justReleasedKeys = new Set<string>();
  private holdStart = new Map<string, number>();
  private actionMap = new Map<string, string[]>();
  private pointerScreenPos = Vec2.ZERO;
  private pointerDownState = false;
  private camera: CameraLike | null = null;
  private elapsedMs = 0;

  // -- Action-based queries --

  /** Whether any key mapped to this action is currently held. */
  isPressed(action: string): boolean {
    return this.anyKeyInSet(action, this.pressedKeys);
  }

  /** Whether any key mapped to this action was pressed this frame. */
  isJustPressed(action: string): boolean {
    return this.anyKeyInSet(action, this.justPressedKeys);
  }

  /** Whether any key mapped to this action was released this frame. */
  isJustReleased(action: string): boolean {
    return this.anyKeyInSet(action, this.justReleasedKeys);
  }

  /** Returns true if any key bound to the action exists in the given set. */
  private anyKeyInSet(action: string, set: Set<string>): boolean {
    const keys = this.actionMap.get(action);
    if (!keys) return false;
    for (const key of keys) {
      if (set.has(key)) return true;
    }
    return false;
  }

  /** Milliseconds the action has been held. Returns 0 if not held. */
  getHoldDuration(action: string): number {
    const keys = this.actionMap.get(action);
    if (!keys) return 0;
    let maxDuration = 0;
    for (const key of keys) {
      const start = this.holdStart.get(key);
      if (start !== undefined) {
        maxDuration = Math.max(maxDuration, this.elapsedMs - start);
      }
    }
    return maxDuration;
  }

  /** Whether the action has been held for at least `minTime` ms. */
  isHeldFor(action: string, minTime: number): boolean {
    return this.getHoldDuration(action) >= minTime;
  }

  // -- Axis helpers --

  /** Returns -1, 0, or 1 based on negative/positive action states. */
  getAxis(negative: string, positive: string): number {
    const neg = this.isPressed(negative) ? 1 : 0;
    const pos = this.isPressed(positive) ? 1 : 0;
    return pos - neg;
  }

  /** Returns a Vec2 from four directional actions. Not normalized. */
  getVector(
    left: string,
    right: string,
    up: string,
    down: string,
  ): Vec2 {
    const x = this.getAxis(left, right);
    const y = this.getAxis(up, down);
    return new Vec2(x, y);
  }

  // -- Pointer --

  /** Pointer position in world coordinates (via Camera), or screen coords if no camera. */
  getPointerPosition(): Vec2 {
    if (this.camera) {
      const w = this.camera.screenToWorld(
        this.pointerScreenPos.x,
        this.pointerScreenPos.y,
      );
      return new Vec2(w.x, w.y);
    }
    return this.pointerScreenPos;
  }

  /** Raw pointer position in screen coordinates. */
  getPointerScreenPosition(): Vec2 {
    return this.pointerScreenPos;
  }

  /** Whether any pointer button is currently held. */
  isPointerDown(): boolean {
    return this.pointerDownState;
  }

  // -- Runtime action map management --

  /** Replace the entire action map. */
  setActionMap(actions: ActionMapDefinition): void {
    this.actionMap.clear();
    for (const [action, keys] of Object.entries(actions)) {
      this.actionMap.set(action, [...keys]);
    }
  }

  /** Add a key binding to an action. Creates the action if it doesn't exist. */
  bindKey(action: string, key: string): void {
    let keys = this.actionMap.get(action);
    if (!keys) {
      keys = [];
      this.actionMap.set(action, keys);
    }
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  /** Remove a key binding from an action. */
  unbindKey(action: string, key: string): void {
    const keys = this.actionMap.get(action);
    if (!keys) return;
    const idx = keys.indexOf(key);
    if (idx !== -1) keys.splice(idx, 1);
  }

  // -- Internal methods (called by InputPlugin / Systems) --

  /** @internal */
  _onKeyDown(code: string): void {
    if (!this.pressedKeys.has(code)) {
      this.pressedKeys.add(code);
      this.justPressedKeys.add(code);
      this.holdStart.set(code, this.elapsedMs);
    }
  }

  /** @internal */
  _onKeyUp(code: string): void {
    if (this.pressedKeys.has(code)) {
      this.pressedKeys.delete(code);
      this.justReleasedKeys.add(code);
      this.holdStart.delete(code);
    }
  }

  /** @internal */
  _onPointerMove(screenX: number, screenY: number): void {
    this.pointerScreenPos = new Vec2(screenX, screenY);
  }

  /** @internal */
  _onPointerDown(): void {
    this.pointerDownState = true;
  }

  /** @internal */
  _onPointerUp(): void {
    this.pointerDownState = false;
  }

  /** @internal Clear per-frame justPressed/justReleased flags. */
  _clearFrameState(): void {
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
  }

  /** @internal Set camera for pointer world-coord conversion. */
  _setCamera(camera: CameraLike): void {
    this.camera = camera;
  }

  /** @internal Advance the elapsed game-time clock. Called by InputPollSystem. */
  _advanceTime(dtMs: number): void {
    this.elapsedMs += dtMs;
  }
}

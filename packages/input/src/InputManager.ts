import { Vec2 } from "@yagejs/core";
import type {
  ActionMapDefinition,
  CameraLike,
  RebindOptions,
  RebindResult,
} from "./types.js";

/** Central input state manager. Resolved via DI with InputManagerKey. */
export class InputManager {
  private pressedKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private justReleasedKeys = new Set<string>();
  private holdStart = new Map<string, number>();
  private syntheticPressedActions = new Set<string>();
  private syntheticActionStarts = new Map<string, number>();
  private actionMap = new Map<string, string[]>();
  private defaultBindings = new Map<string, string[]>();
  private groups = new Map<string, Set<string>>();
  private actionGroups = new Map<string, Set<string>>();
  private disabledGroups = new Set<string>();
  private pointerScreenPos = Vec2.ZERO;
  private pointerDownState = false;
  private pressedMouseButtons = new Set<number>();
  private gamepadButtons = new Map<number, boolean>();
  private gamepadAxes = new Map<number, number>();
  private camera: CameraLike | null = null;
  private elapsedMs = 0;
  private listenResolve: ((key: string | null) => void) | null = null;

  // -- Action-based queries --

  /** Whether any key mapped to this action is currently held. */
  isPressed(action: string): boolean {
    if (!this.isActionEnabled(action)) return false;
    return this.syntheticPressedActions.has(action) ||
      this.anyKeyInSet(action, this.pressedKeys);
  }

  /** Whether any key mapped to this action was pressed this frame. */
  isJustPressed(action: string): boolean {
    if (!this.isActionEnabled(action)) return false;
    return this.syntheticPressedActions.has(action) ||
      this.anyKeyInSet(action, this.justPressedKeys);
  }

  /** Whether any key mapped to this action was released this frame. */
  isJustReleased(action: string): boolean {
    if (!this.isActionEnabled(action)) return false;
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
    if (!this.isActionEnabled(action)) return 0;
    const keys = this.actionMap.get(action);
    if (!keys && !this.syntheticPressedActions.has(action)) return 0;
    let maxDuration = 0;
    for (const key of keys ?? []) {
      const start = this.holdStart.get(key);
      if (start !== undefined) {
        maxDuration = Math.max(maxDuration, this.elapsedMs - start);
      }
    }
    const syntheticStart = this.syntheticActionStarts.get(action);
    if (syntheticStart !== undefined) {
      maxDuration = Math.max(maxDuration, this.elapsedMs - syntheticStart);
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

  /** Replace the entire action map and store it as the default for {@link resetBindings}. */
  setActionMap(actions: ActionMapDefinition): void {
    this.actionMap.clear();
    this.defaultBindings.clear();
    for (const [action, keys] of Object.entries(actions)) {
      this.actionMap.set(action, [...keys]);
      this.defaultBindings.set(action, [...keys]);
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

  // -- Binding queries --

  /** Returns the current key bindings for an action, or an empty array if unmapped. */
  getBindings(action: string): readonly string[] {
    return this.actionMap.get(action) ?? [];
  }

  /** Returns all action names that have the given key bound. */
  getActionsForKey(key: string): string[] {
    const result: string[] = [];
    for (const [action, keys] of this.actionMap) {
      if (keys.includes(key)) result.push(action);
    }
    return result;
  }

  // -- Rebinding --

  /**
   * Rebind a key to an action with optional conflict detection.
   * Conflicts are only detected between actions sharing at least one group.
   */
  rebind(action: string, key: string, opts?: RebindOptions): RebindResult {
    const conflict = opts?.conflict ?? "reject";
    const slot = opts?.slot;

    const conflictAction = this.findConflictInGroups(action, key);

    if (conflictAction && conflict === "reject") {
      return { ok: false, conflict: { action: conflictAction, key } };
    }

    if (conflictAction && conflict === "replace") {
      this.unbindKey(conflictAction, key);
    }

    let keys = this.actionMap.get(action);
    if (!keys) {
      keys = [];
      this.actionMap.set(action, keys);
    }

    // Remove existing occurrence to avoid duplicates, adjusting slot for the shift
    const existingIdx = keys.indexOf(key);
    let targetSlot = slot;
    if (targetSlot !== undefined && existingIdx !== -1 && existingIdx !== targetSlot) {
      keys.splice(existingIdx, 1);
      if (targetSlot > existingIdx) targetSlot--;
    }

    if (targetSlot !== undefined && targetSlot < keys.length) {
      keys[targetSlot] = key;
    } else if (!keys.includes(key)) {
      keys.push(key);
    }

    return { ok: true };
  }

  /**
   * Finds the first action that uses the given key AND shares at least one
   * group with the target action. Ungrouped actions never conflict.
   */
  private findConflictInGroups(action: string, key: string): string | null {
    const myGroups = this.actionGroups.get(action);
    if (!myGroups || myGroups.size === 0) return null;

    for (const [otherAction, otherKeys] of this.actionMap) {
      if (otherAction === action) continue;
      if (!otherKeys.includes(key)) continue;

      const otherGroups = this.actionGroups.get(otherAction);
      if (!otherGroups) continue;

      for (const g of myGroups) {
        if (otherGroups.has(g)) return otherAction;
      }
    }
    return null;
  }

  // -- Binding persistence --

  /** Reset bindings to defaults. If an action name is provided, only reset that action. */
  resetBindings(action?: string): void {
    if (action !== undefined) {
      const defaults = this.defaultBindings.get(action);
      if (defaults) {
        this.actionMap.set(action, [...defaults]);
      }
    } else {
      this.actionMap.clear();
      for (const [a, keys] of this.defaultBindings) {
        this.actionMap.set(a, [...keys]);
      }
    }
  }

  /** Export the current bindings as a plain object for serialization. */
  exportBindings(): ActionMapDefinition {
    const result: ActionMapDefinition = {};
    for (const [action, keys] of this.actionMap) {
      result[action] = [...keys];
    }
    return result;
  }

  /** Load bindings from a plain object. Resets to defaults first, then overlays the provided map. */
  loadBindings(map: ActionMapDefinition): void {
    this.resetBindings();
    for (const [action, keys] of Object.entries(map)) {
      this.actionMap.set(action, [...keys]);
    }
  }

  // -- Group management --

  /** Configure input groups. Group name -> array of action names. */
  setGroups(groups: Record<string, string[]>): void {
    this.groups.clear();
    this.actionGroups.clear();
    for (const [name, actions] of Object.entries(groups)) {
      this.groups.set(name, new Set(actions));
      for (const action of actions) {
        let set = this.actionGroups.get(action);
        if (!set) {
          set = new Set();
          this.actionGroups.set(action, set);
        }
        set.add(name);
      }
    }
  }

  /** Enable a group by name. */
  enableGroup(name: string): void {
    this.disabledGroups.delete(name);
  }

  /** Disable a group by name. Actions only in disabled groups become inactive. */
  disableGroup(name: string): void {
    this.disabledGroups.add(name);
  }

  /** Set exactly these groups as active; all others are disabled. */
  setActiveGroups(names: string[]): void {
    this.disabledGroups.clear();
    for (const group of this.groups.keys()) {
      if (!names.includes(group)) {
        this.disabledGroups.add(group);
      }
    }
  }

  /** Whether a group is currently enabled. Returns true for unknown group names. */
  isGroupEnabled(name: string): boolean {
    return !this.disabledGroups.has(name);
  }

  /** Get all configured group names. */
  getGroups(): string[] {
    return Array.from(this.groups.keys());
  }

  /** Get the action names belonging to a group. Returns empty array for unknown groups. */
  getGroupActions(name: string): readonly string[] {
    const set = this.groups.get(name);
    return set ? Array.from(set) : [];
  }

  /** Returns true if the action is ungrouped or any of its groups is enabled. */
  private isActionEnabled(action: string): boolean {
    const groupSet = this.actionGroups.get(action);
    if (!groupSet || groupSet.size === 0) return true;
    for (const group of groupSet) {
      if (!this.disabledGroups.has(group)) return true;
    }
    return false;
  }

  // -- Key listening --

  /** Returns a promise that resolves with the next key code pressed. Intercepts the key. */
  listenForNextKey(): Promise<string | null> {
    this.cancelListen();
    return new Promise<string | null>((resolve) => {
      this.listenResolve = resolve;
    });
  }

  /** Cancel an active {@link listenForNextKey}. Resolves the pending promise with `null`. */
  cancelListen(): void {
    if (this.listenResolve) {
      const resolve = this.listenResolve;
      this.listenResolve = null;
      resolve(null);
    }
  }

  /** Public wrapper for synthetic key-down injection. */
  fireKeyDown(code: string): void {
    this._onKeyDown(code);
  }

  /** Public wrapper for synthetic key-up injection. */
  fireKeyUp(code: string): void {
    this._onKeyUp(code);
  }

  /** Public wrapper for synthetic pointer movement. */
  firePointerMove(screenX: number, screenY: number): void {
    this._onPointerMove(screenX, screenY);
  }

  /** Public wrapper for synthetic pointer-button presses. */
  firePointerDown(button: 0 | 1 | 2 = 0): void {
    this._onPointerDown();
    this.pressedMouseButtons.add(button);

    if (button === 0) this._onKeyDown("MouseLeft");
    if (button === 1) this._onKeyDown("MouseMiddle");
    if (button === 2) this._onKeyDown("MouseRight");
  }

  /** Public wrapper for synthetic pointer-button releases. */
  firePointerUp(button: 0 | 1 | 2 = 0): void {
    this.pressedMouseButtons.delete(button);
    this.pointerDownState = this.pressedMouseButtons.size > 0;
    if (!this.pointerDownState) {
      this._onPointerUp();
    }

    if (button === 0) this._onKeyUp("MouseLeft");
    if (button === 1) this._onKeyUp("MouseMiddle");
    if (button === 2) this._onKeyUp("MouseRight");
  }

  /** Store synthetic gamepad button state. */
  fireGamepadButton(idx: number, pressed: boolean): void {
    this.gamepadButtons.set(idx, pressed);
  }

  /** Store synthetic gamepad axis state. */
  fireGamepadAxis(idx: number, value: number): void {
    this.gamepadAxes.set(idx, value);
  }

  /** Inject a one-frame synthetic action pulse. */
  fireAction(name: string): void {
    if (!this.actionMap.has(name)) {
      throw new Error(`InputManager.fireAction(): unknown action "${name}".`);
    }
    this.syntheticPressedActions.add(name);
    this.syntheticActionStarts.set(name, this.elapsedMs);
  }

  /** Release all synthetic and physical input state. */
  clearAll(): void {
    for (const code of [...this.pressedKeys]) {
      this._onKeyUp(code);
    }
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
    this.holdStart.clear();
    this.syntheticPressedActions.clear();
    this.syntheticActionStarts.clear();
    this.pressedMouseButtons.clear();
    this.pointerDownState = false;
    this.gamepadButtons.clear();
    this.gamepadAxes.clear();
  }

  /** Release any pressed pointer buttons without touching keyboard state. */
  clearPointerButtons(): void {
    for (const button of [...this.pressedMouseButtons]) {
      if (button === 0) this._onKeyUp("MouseLeft");
      if (button === 1) this._onKeyUp("MouseMiddle");
      if (button === 2) this._onKeyUp("MouseRight");
    }
    this.pressedMouseButtons.clear();
    this.pointerDownState = false;
  }

  /** Snapshot of current held input state for inspector tooling. */
  snapshotState(): {
    keys: string[];
    actions: string[];
    mouse: { x: number; y: number; buttons: number[]; down: boolean };
    gamepad: {
      buttons: number[];
      axes: Array<{ index: number; value: number }>;
    };
  } {
    const keys = [...this.pressedKeys].sort((a, b) => a.localeCompare(b));
    const actions = this.getActionNames()
      .filter((action) => this.isPressed(action))
      .sort((a, b) => a.localeCompare(b));
    const buttons = [...this.pressedMouseButtons].sort((a, b) => a - b);
    const pressedButtons = [...this.gamepadButtons.entries()]
      .filter(([, pressed]) => pressed)
      .map(([idx]) => idx)
      .sort((a, b) => a - b);
    const axes = [...this.gamepadAxes.entries()]
      .filter(([, value]) => value !== 0)
      .sort(([a], [b]) => a - b)
      .map(([index, value]) => ({ index, value }));

    return {
      keys,
      actions,
      mouse: {
        x: this.pointerScreenPos.x,
        y: this.pointerScreenPos.y,
        buttons,
        down: this.pointerDownState,
      },
      gamepad: {
        buttons: pressedButtons,
        axes,
      },
    };
  }

  // -- Internal methods (called by InputPlugin / Systems) --

  /** @internal */
  _onKeyDown(code: string): void {
    if (this.listenResolve) {
      const resolve = this.listenResolve;
      this.listenResolve = null;
      resolve(code);
      return;
    }
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
    this.syntheticPressedActions.clear();
    this.syntheticActionStarts.clear();
  }

  /** Set camera for pointer world-coord conversion. */
  setCamera(camera: CameraLike): void {
    this.camera = camera;
  }

  /** Clear the camera reference (e.g. on scene exit). */
  clearCamera(): void {
    this.camera = null;
  }

  /** Get all configured action names. */
  getActionNames(): string[] {
    return Array.from(this.actionMap.keys());
  }

  /** @internal Advance the elapsed game-time clock. Called by InputPollSystem. */
  _advanceTime(dtMs: number): void {
    this.elapsedMs += dtMs;
  }
}

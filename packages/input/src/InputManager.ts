import { Vec2 } from "@yagejs/core";
import type {
  ActionMapDefinition,
  CameraLike,
  GamepadAxisKey,
  GamepadInfo,
  RebindOptions,
  RebindResult,
} from "./types.js";

/** Standard-mapping button codes, indexed by W3C button position. */
const STANDARD_BUTTON_CODES = [
  "GamepadA",
  "GamepadB",
  "GamepadX",
  "GamepadY",
  "GamepadLB",
  "GamepadRB",
  "GamepadLT",
  "GamepadRT",
  "GamepadSelect",
  "GamepadStart",
  "GamepadLeftStick",
  "GamepadRightStick",
  "GamepadDPadUp",
  "GamepadDPadDown",
  "GamepadDPadLeft",
  "GamepadDPadRight",
  "GamepadHome",
] as const;

const TRIGGER_LEFT_INDEX = 6;
const TRIGGER_RIGHT_INDEX = 7;

/** Synthetic pad index used by `fireGamepadAxis` injection. */
const SYNTHETIC_PAD_INDEX = -1;

const STICK_AXIS_KEYS: Record<
  "left" | "right",
  { x: GamepadAxisKey; y: GamepadAxisKey }
> = {
  left: { x: "leftX", y: "leftY" },
  right: { x: "rightX", y: "rightY" },
};

const TRIGGER_AXIS_KEYS: Record<"left" | "right", GamepadAxisKey> = {
  left: "leftTrigger",
  right: "rightTrigger",
};

/** Standard-mapping axis indices map to semantic axis keys. */
const STANDARD_AXIS_KEYS: readonly GamepadAxisKey[] = [
  "leftX",
  "leftY",
  "rightX",
  "rightY",
];

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
  /** Per-pad axis values keyed by `${padIndex}:${axisKey}`. */
  private gamepadAxisState = new Map<string, number>();
  /** "Any pad" aggregate of currently-pressed gamepad codes. */
  private lastButtonState = new Map<string, boolean>();
  /** Pads we've seen via gamepadconnected events. */
  private connectedPads = new Map<number, GamepadInfo>();
  private gamepadConnectListeners: Array<(info: GamepadInfo) => void> = [];
  private gamepadDisconnectListeners: Array<(info: GamepadInfo) => void> = [];
  private stickDeadzone = 0.15;
  private triggerDeadzone = 0.05;
  private triggerThreshold = 0.5;
  private pollingEnabled = true;
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

  /**
   * Inject a synthetic gamepad button edge. Routes through the same internal
   * path as real polling, so action queries (`isPressed`, `isJustPressed`),
   * `listenForNextKey`, and rebinding all see the synthetic input.
   *
   * `code` should be a gamepad code string (e.g. `"GamepadA"`, `"GamepadLT"`).
   * Used by inspector probes / deterministic tests in lieu of real polling.
   */
  fireGamepadButton(code: string, pressed: boolean): void {
    const wasPressed = this.lastButtonState.get(code) ?? false;
    if (pressed && !wasPressed) {
      this._onKeyDown(code);
      this.lastButtonState.set(code, true);
    } else if (!pressed && wasPressed) {
      this._onKeyUp(code);
      this.lastButtonState.delete(code);
    }
  }

  /**
   * Inject a synthetic gamepad axis value. Stored under a synthetic pad index
   * and aggregated by `getStick` / `getTrigger` alongside real pads.
   *
   * Trigger axes additionally emit `GamepadLT`/`GamepadRT` button edges when
   * crossing `triggerThreshold`, mirroring real-pad polling so synthetic
   * inspector probes drive `isPressed` the same way as physical hardware.
   */
  fireGamepadAxis(side: GamepadAxisKey, value: number): void {
    this.gamepadAxisState.set(`${SYNTHETIC_PAD_INDEX}:${side}`, value);
    if (side === "leftTrigger") {
      this.fireGamepadButton("GamepadLT", value >= this.triggerThreshold);
    } else if (side === "rightTrigger") {
      this.fireGamepadButton("GamepadRT", value >= this.triggerThreshold);
    }
  }

  // -- Gamepad analog API --

  /**
   * Returns the deadzoned, magnitude-clamped stick vector for the given side.
   * Across multiple connected pads, the largest-magnitude vector wins.
   */
  getStick(side: "left" | "right"): Vec2 {
    const { x: xKey, y: yKey } = STICK_AXIS_KEYS[side];
    let bestX = 0;
    let bestY = 0;
    let bestMag = 0;
    for (const padIdx of this.collectPadIndices()) {
      const x = this.gamepadAxisState.get(`${padIdx}:${xKey}`) ?? 0;
      const y = this.gamepadAxisState.get(`${padIdx}:${yKey}`) ?? 0;
      const mag = Math.hypot(x, y);
      if (mag > bestMag) {
        bestMag = mag;
        bestX = x;
        bestY = y;
      }
    }
    if (bestMag < this.stickDeadzone) return Vec2.ZERO;
    // Guards the deadzone:0 case — `bestMag === 0` slips past the previous
    // check when the deadzone is disabled, and dividing by zero would yield NaN.
    if (bestMag === 0) return Vec2.ZERO;
    const adjustedMag = Math.min(
      1,
      (bestMag - this.stickDeadzone) / (1 - this.stickDeadzone),
    );
    return new Vec2((bestX / bestMag) * adjustedMag, (bestY / bestMag) * adjustedMag);
  }

  /**
   * Returns the deadzoned trigger value (0..1) for the given side.
   * Across multiple connected pads, the maximum value wins.
   */
  getTrigger(side: "left" | "right"): number {
    const key = TRIGGER_AXIS_KEYS[side];
    let best = 0;
    for (const padIdx of this.collectPadIndices()) {
      const v = this.gamepadAxisState.get(`${padIdx}:${key}`) ?? 0;
      if (v > best) best = v;
    }
    if (best < this.triggerDeadzone) return 0;
    return Math.min(1, (best - this.triggerDeadzone) / (1 - this.triggerDeadzone));
  }

  private collectPadIndices(): Set<number> {
    const indices = new Set<number>();
    for (const key of this.gamepadAxisState.keys()) {
      const colon = key.indexOf(":");
      if (colon === -1) continue;
      indices.add(Number.parseInt(key.slice(0, colon), 10));
    }
    return indices;
  }

  // -- Gamepad enumeration / events --

  /**
   * Synchronously poll `navigator.getGamepads()` for currently-connected pads.
   * Use this rather than the cached event-driven list when you need ground
   * truth — `gamepadconnected` doesn't fire until the user presses a button.
   */
  gamepads(): readonly GamepadInfo[] {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.getGamepads !== "function"
    ) {
      return [];
    }
    const result: GamepadInfo[] = [];
    for (const pad of navigator.getGamepads()) {
      if (pad) result.push({ index: pad.index, id: pad.id });
    }
    return result;
  }

  /**
   * Subscribe to gamepad-connected events. Replays currently-known pads
   * synchronously so callers don't need a separate `gamepads()` call.
   * Returns a disposer.
   */
  onGamepadConnected(fn: (info: GamepadInfo) => void): () => void {
    this.gamepadConnectListeners.push(fn);
    for (const info of this.connectedPads.values()) fn(info);
    return () => {
      const idx = this.gamepadConnectListeners.indexOf(fn);
      if (idx !== -1) this.gamepadConnectListeners.splice(idx, 1);
    };
  }

  /** Subscribe to gamepad-disconnected events. Returns a disposer. */
  onGamepadDisconnected(fn: (info: GamepadInfo) => void): () => void {
    this.gamepadDisconnectListeners.push(fn);
    return () => {
      const idx = this.gamepadDisconnectListeners.indexOf(fn);
      if (idx !== -1) this.gamepadDisconnectListeners.splice(idx, 1);
    };
  }

  // -- Gamepad runtime config --

  /** Enable or disable real gamepad polling. Synthetic injection still works when disabled. */
  setPollingEnabled(enabled: boolean): void {
    this.pollingEnabled = enabled;
  }

  /** Whether real gamepad polling is currently enabled. */
  isPollingEnabled(): boolean {
    return this.pollingEnabled;
  }

  /** Update analog deadzones at runtime. Either field may be omitted. */
  setDeadzones(opts: { stick?: number; trigger?: number }): void {
    if (opts.stick !== undefined) this.stickDeadzone = opts.stick;
    if (opts.trigger !== undefined) this.triggerDeadzone = opts.trigger;
  }

  /** Set the trigger button-edge threshold (default 0.5). */
  setTriggerThreshold(value: number): void {
    this.triggerThreshold = value;
  }

  // -- Internal: polling and connect/disconnect plumbing --

  /** @internal Force-release any held gamepad codes. Used on tab-hide. */
  _releaseAllGamepadButtons(): void {
    for (const code of [...this.lastButtonState.keys()]) {
      this._onKeyUp(code);
    }
    this.lastButtonState.clear();
  }

  /** @internal Called by InputPlugin from `gamepadconnected` event. */
  _onGamepadConnected(info: GamepadInfo): void {
    this.connectedPads.set(info.index, info);
    for (const fn of this.gamepadConnectListeners) fn(info);
  }

  /** @internal Called by InputPlugin from `gamepaddisconnected` event. */
  _onGamepadDisconnected(info: GamepadInfo): void {
    this.connectedPads.delete(info.index);
    // Drop axis state for the departed pad
    for (const key of [...this.gamepadAxisState.keys()]) {
      if (key.startsWith(`${info.index}:`)) this.gamepadAxisState.delete(key);
    }
    // Re-aggregate held buttons against remaining pads. If polling is
    // disabled (test mode), conservatively release all gamepad buttons —
    // synthetic injection callers can re-press anything they still want held.
    if (this.pollingEnabled) {
      this._pollGamepads();
    } else {
      this._releaseAllGamepadButtons();
    }
    for (const fn of this.gamepadDisconnectListeners) fn(info);
  }

  /**
   * @internal Poll real gamepads via `navigator.getGamepads()` and emit
   * key-down/key-up edges for any aggregate state changes. Called by
   * `InputPollSystem` once per frame.
   */
  _pollGamepads(): void {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.getGamepads !== "function"
    ) {
      return;
    }
    const pads = navigator.getGamepads();

    // Collect "any pad pressed" per code, plus refresh axis state.
    const codePressed = new Map<string, boolean>();
    for (const pad of pads) {
      if (!pad) continue;
      const standard = pad.mapping === "standard";
      const buttons = pad.buttons;
      for (let btnIdx = 0; btnIdx < buttons.length; btnIdx++) {
        const btn = buttons[btnIdx];
        if (!btn) continue;
        const standardCode =
          standard && btnIdx < STANDARD_BUTTON_CODES.length
            ? STANDARD_BUTTON_CODES[btnIdx]
            : undefined;
        const code = standardCode ?? `GamepadButton${btnIdx}`;
        const isTrigger =
          standard && (btnIdx === TRIGGER_LEFT_INDEX || btnIdx === TRIGGER_RIGHT_INDEX);
        const isDown = isTrigger ? btn.value >= this.triggerThreshold : btn.pressed;
        if (isDown) codePressed.set(code, true);
      }

      // Stick axes
      if (standard) {
        for (let axIdx = 0; axIdx < STANDARD_AXIS_KEYS.length; axIdx++) {
          const axisKey = STANDARD_AXIS_KEYS[axIdx];
          if (!axisKey) continue;
          this.gamepadAxisState.set(
            `${pad.index}:${axisKey}`,
            pad.axes[axIdx] ?? 0,
          );
        }
        // Trigger analog values from buttons 6/7
        const lt = pad.buttons[TRIGGER_LEFT_INDEX];
        const rt = pad.buttons[TRIGGER_RIGHT_INDEX];
        this.gamepadAxisState.set(`${pad.index}:leftTrigger`, lt?.value ?? 0);
        this.gamepadAxisState.set(`${pad.index}:rightTrigger`, rt?.value ?? 0);
      }
    }

    // Edge detection: union of last-frame and this-frame codes
    const allCodes = new Set<string>([
      ...this.lastButtonState.keys(),
      ...codePressed.keys(),
    ]);
    for (const code of allCodes) {
      const wasPressed = this.lastButtonState.get(code) ?? false;
      const isPressed = codePressed.get(code) ?? false;
      if (isPressed && !wasPressed) {
        this._onKeyDown(code);
      } else if (!isPressed && wasPressed) {
        this._onKeyUp(code);
      }
      // Update lastButtonState unconditionally — fixes listen-mode held-button:
      // when _onKeyDown intercepts (listen resolves and short-circuits), the
      // diff next frame is `true → true` (no edge), preventing infinite re-fire.
      if (isPressed) {
        this.lastButtonState.set(code, true);
      } else {
        this.lastButtonState.delete(code);
      }
    }
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
    // Hard reset: synthetic releases generated above are intentionally
    // discarded. Callers want a clean slate, not a flurry of justReleased
    // pulses for downstream listeners.
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
    this.holdStart.clear();
    this.syntheticPressedActions.clear();
    this.syntheticActionStarts.clear();
    this.pressedMouseButtons.clear();
    this.pointerDownState = false;
    this.lastButtonState.clear();
    this.gamepadAxisState.clear();
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
      buttons: string[];
      axes: Array<{ key: string; value: number }>;
    };
  } {
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const keys = [...this.pressedKeys].sort(cmp);
    const nonGamepadKeys = keys.filter((k) => !k.startsWith("Gamepad"));
    const gamepadButtons = keys.filter((k) => k.startsWith("Gamepad"));
    const actions = this.getActionNames()
      .filter((action) => this.isPressed(action))
      .sort(cmp);
    const buttons = [...this.pressedMouseButtons].sort((a, b) => a - b);
    const axes = [...this.gamepadAxisState.entries()]
      .filter(([, value]) => Math.abs(value) > 0.001)
      .sort(([a], [b]) => cmp(a, b))
      .map(([key, value]) => ({ key, value }));

    return {
      keys: nonGamepadKeys,
      actions,
      mouse: {
        x: this.pointerScreenPos.x,
        y: this.pointerScreenPos.y,
        buttons,
        down: this.pointerDownState,
      },
      gamepad: {
        buttons: gamepadButtons,
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

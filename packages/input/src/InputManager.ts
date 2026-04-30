import { Vec2 } from "@yagejs/core";
import type { RendererAdapter } from "@yagejs/core";
import type {
  ActionMapDefinition,
  CameraLike,
  GamepadAxisKey,
  GamepadInfo,
  PointerEventInfo,
  PointerInfo,
  PointerType,
  RebindOptions,
  RebindResult,
} from "./types.js";

/** Action-map codes for the three primary mouse buttons, indexed by button. */
const MOUSE_BUTTON_CODES = ["MouseLeft", "MouseMiddle", "MouseRight"] as const;

/** Mutable internal pointer record. Exposed externally as the read-only {@link PointerInfo}. */
interface MutablePointerInfo {
  id: number;
  screenPos: Vec2;
  type: PointerType;
  isPrimary: boolean;
  buttons: Set<number>;
  isDown: boolean;
}

/**
 * DOM-originated input events buffered between the browser dispatch tick and
 * the next `InputPollSystem` drain at `Phase.EarlyUpdate`. Synthetic injection
 * (`fireKeyDown`, `firePointerDown`, etc.) bypasses the queue and applies state
 * synchronously through `_apply*` to keep test ergonomics intact.
 */
type BufferedInputEvent =
  | { kind: "keyDown"; code: string }
  | { kind: "keyUp"; code: string }
  | { kind: "pointerDown"; info: PointerEventInfo }
  | { kind: "pointerUp"; info: PointerEventInfo }
  | { kind: "pointerCancel"; id: number }
  | { kind: "wheel"; dx: number; dy: number };

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
  /** Tracked pointers keyed by `pointerId`. Mouse persists; touch/pen removed on up/cancel. */
  private pointers = new Map<number, MutablePointerInfo>();
  /** Id of the pointer the browser last marked `isPrimary`, or `null` when none are tracked. */
  private primaryPointerId: number | null = null;
  /**
   * Aggregate "any pointer has this button held" cache. The action-map codes
   * `MouseLeft`/`MouseMiddle`/`MouseRight` are driven from edges into/out of this
   * set so two simultaneous taps holding button 0 do not double-fire.
   * Consumed pointers are excluded from the aggregate so UI-claimed presses
   * never propagate to gameplay actions.
   */
  private mouseButtonAggregate = new Set<number>();
  /**
   * Pointers marked as "claimed" via {@link consumePointer} (or auto-claimed by
   * the renderer's UI hit-test fallback). Lifetime is per-pointer-event-cycle:
   * cleared when the pointer's last button releases (drained `pointerUp`) or on
   * `pointercancel`.
   */
  private consumedPointers = new Set<number>();
  /** Wheel-edge gate flipped by {@link consumeWheel}. Cleared at end of frame. */
  private consumedWheelThisFrame = false;
  /** Buffered DOM-originated events awaiting drain at `Phase.EarlyUpdate`. */
  private inputQueue: BufferedInputEvent[] = [];
  /**
   * Renderer reference for the optional `hitTestUI(x, y)` lookup. Stashed by
   * {@link _setRenderer} during `InputPlugin.install` so the drain step can
   * read it cheaply each frame.
   */
  private renderer: RendererAdapter | null = null;
  private pointerDownListeners: Array<(info: PointerInfo) => void> = [];
  private pointerUpListeners: Array<(info: PointerInfo) => void> = [];
  private pointerMoveListeners: Array<(info: PointerInfo) => void> = [];
  private keyDownListenersAny: Array<(code: string) => void> = [];
  private keyUpListenersAny: Array<(code: string) => void> = [];
  private keyDownListeners = new Map<string, Array<(code: string) => void>>();
  private keyUpListeners = new Map<string, Array<(code: string) => void>>();
  private actionListeners = new Map<string, Array<(name: string) => void>>();
  private actionReleasedListeners = new Map<
    string,
    Array<(name: string) => void>
  >();
  private wheelListeners: Array<(dx: number, dy: number) => void> = [];
  /** Real-pad axis values keyed by `${padIndex}:${axisKey}`. */
  private gamepadAxisState = new Map<string, number>();
  /** Synthetic axis values for fireGamepadAxis injection (test path). */
  private syntheticAxisState = new Map<GamepadAxisKey, number>();
  /** "Any pad" aggregate of currently-pressed gamepad codes. */
  private lastButtonState = new Map<string, boolean>();
  /** Per-pad "anything happening" flag, used to detect rising-edge activity for active-pad promotion. */
  private lastPadActivity = new Map<number, boolean>();
  /** Pads currently known to the engine (populated via events or polling). */
  private connectedPads = new Map<number, GamepadInfo>();
  /** Index of the pad whose analog input is read by default. `null` when no pad is connected. */
  private activePadIndex: number | null = null;
  private gamepadConnectListeners: Array<(info: GamepadInfo) => void> = [];
  private gamepadDisconnectListeners: Array<(info: GamepadInfo) => void> = [];
  private activePadListeners: Array<(info: GamepadInfo | null) => void> = [];
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

  /**
   * Primary pointer's position in world coordinates (via Camera), or screen
   * coords if no camera. Returns `Vec2.ZERO` when no pointer is tracked.
   *
   * For multi-pointer access (touch UIs etc.) iterate {@link getPointers} and
   * convert each `screenPos` via the camera as needed.
   */
  getPointerPosition(): Vec2 {
    const primary = this.getPrimaryPointer();
    if (!primary) return Vec2.ZERO;
    if (this.camera) {
      const w = this.camera.screenToWorld(primary.screenPos.x, primary.screenPos.y);
      return new Vec2(w.x, w.y);
    }
    return primary.screenPos;
  }

  /** Primary pointer's raw position in screen coordinates, or `Vec2.ZERO` when no pointer is tracked. */
  getPointerScreenPosition(): Vec2 {
    const primary = this.getPrimaryPointer();
    return primary ? primary.screenPos : Vec2.ZERO;
  }

  /** Whether the primary pointer has any button held. */
  isPointerDown(): boolean {
    const primary = this.getPrimaryPointer();
    return primary ? primary.isDown : false;
  }

  /** All currently-tracked pointers (one per active mouse, pen, or finger). */
  getPointers(): readonly PointerInfo[] {
    const out: PointerInfo[] = [];
    for (const p of this.pointers.values()) {
      out.push(this.toPointerInfo(p));
    }
    return out;
  }

  /** Direct lookup by `pointerId`, or `undefined` if no pointer with that id is tracked. */
  getPointer(id: number): PointerInfo | undefined {
    const p = this.pointers.get(id);
    return p ? this.toPointerInfo(p) : undefined;
  }

  /**
   * Defensive snapshot of a tracked pointer. The runtime `MutablePointerInfo`
   * holds a real `Set` for `buttons` — even though the `PointerInfo` type
   * declares `ReadonlySet`, JS doesn't enforce that at runtime, so we copy the
   * set on every public read. `Vec2` is convention-immutable across YAGE, so
   * we share the same instance.
   */
  private toPointerInfo(pointer: MutablePointerInfo): PointerInfo {
    return {
      id: pointer.id,
      screenPos: pointer.screenPos,
      type: pointer.type,
      isPrimary: pointer.isPrimary,
      buttons: new Set(pointer.buttons),
      isDown: pointer.isDown,
    };
  }

  /**
   * Subscribe to pointer-down events (button transitions from up → down on a
   * tracked pointer). Returns a disposer that detaches the listener.
   */
  onPointerDown(fn: (info: PointerInfo) => void): () => void {
    this.pointerDownListeners.push(fn);
    return () => {
      const idx = this.pointerDownListeners.indexOf(fn);
      if (idx !== -1) this.pointerDownListeners.splice(idx, 1);
    };
  }

  /**
   * Subscribe to pointer-up events (button transitions from down → up, plus
   * touch / pen lifecycle ends and `pointercancel`). Returns a disposer.
   */
  onPointerUp(fn: (info: PointerInfo) => void): () => void {
    this.pointerUpListeners.push(fn);
    return () => {
      const idx = this.pointerUpListeners.indexOf(fn);
      if (idx !== -1) this.pointerUpListeners.splice(idx, 1);
    };
  }

  /** Subscribe to pointer-move events. Returns a disposer. */
  onPointerMove(fn: (info: PointerInfo) => void): () => void {
    this.pointerMoveListeners.push(fn);
    return () => {
      const idx = this.pointerMoveListeners.indexOf(fn);
      if (idx !== -1) this.pointerMoveListeners.splice(idx, 1);
    };
  }

  // -- Consume primitives --

  /**
   * Mark a pointer as claimed for the rest of its event cycle (down → up).
   * Subsequent action-map edges for this pointer (e.g. the `MouseLeft` edge a
   * `pointerdown` would normally fire) are suppressed; `onPointerDown/Up/Move`
   * listeners still fire because they are explicit user opt-ins.
   *
   * The mark clears automatically when the pointer's last button releases or
   * on `pointercancel`. Call from a Pixi `pointerdown` handler that wants to
   * own the event: `manager.consumePointer(e.pointerId)`.
   */
  consumePointer(id: number): void {
    this.consumedPointers.add(id);
  }

  /** Whether the pointer is currently marked consumed. */
  isPointerConsumed(id: number): boolean {
    return this.consumedPointers.has(id);
  }

  /**
   * Suppress wheel action-map edges (`WheelUp/Down/Left/Right`) for the rest
   * of the current frame. `onWheel` listeners still fire.
   */
  consumeWheel(): void {
    this.consumedWheelThisFrame = true;
  }

  // -- Listener parity (keys, actions, wheel) --

  /**
   * Subscribe to key-down events. Pass a code (e.g. `"Space"`, `"GamepadA"`)
   * to filter, or `"*"` for all keys. The listener fires on the same edge
   * `isJustPressed` reports — for DOM-originated events that's the next
   * `Phase.EarlyUpdate` after the browser dispatches; for synthetic injection
   * (`fireKeyDown`) it's synchronous. Returns a disposer.
   */
  onKeyDown(code: string, fn: (code: string) => void): () => void {
    if (code === "*") {
      this.keyDownListenersAny.push(fn);
      return () => {
        const idx = this.keyDownListenersAny.indexOf(fn);
        if (idx !== -1) this.keyDownListenersAny.splice(idx, 1);
      };
    }
    let arr = this.keyDownListeners.get(code);
    if (!arr) {
      arr = [];
      this.keyDownListeners.set(code, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.keyDownListeners.get(code);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** Subscribe to key-up events. See {@link onKeyDown}. */
  onKeyUp(code: string, fn: (code: string) => void): () => void {
    if (code === "*") {
      this.keyUpListenersAny.push(fn);
      return () => {
        const idx = this.keyUpListenersAny.indexOf(fn);
        if (idx !== -1) this.keyUpListenersAny.splice(idx, 1);
      };
    }
    let arr = this.keyUpListeners.get(code);
    if (!arr) {
      arr = [];
      this.keyUpListeners.set(code, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.keyUpListeners.get(code);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * Subscribe to action press edges (rising edge of any key bound to the
   * action). Fires once per press. Returns a disposer.
   */
  onAction(name: string, fn: (name: string) => void): () => void {
    let arr = this.actionListeners.get(name);
    if (!arr) {
      arr = [];
      this.actionListeners.set(name, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.actionListeners.get(name);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /** Subscribe to action release edges. Returns a disposer. */
  onActionReleased(name: string, fn: (name: string) => void): () => void {
    let arr = this.actionReleasedListeners.get(name);
    if (!arr) {
      arr = [];
      this.actionReleasedListeners.set(name, arr);
    }
    arr.push(fn);
    return () => {
      const list = this.actionReleasedListeners.get(name);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * Subscribe to scroll-wheel events. Receives raw `deltaX`/`deltaY` (already
   * sign-flipped by `InputConfig.wheelInvertY` if set). Fires regardless of
   * {@link consumeWheel} — it only gates action edges. Returns a disposer.
   */
  onWheel(fn: (dx: number, dy: number) => void): () => void {
    this.wheelListeners.push(fn);
    return () => {
      const idx = this.wheelListeners.indexOf(fn);
      if (idx !== -1) this.wheelListeners.splice(idx, 1);
    };
  }

  private getPrimaryPointer(): MutablePointerInfo | null {
    if (this.primaryPointerId === null) return null;
    return this.pointers.get(this.primaryPointerId) ?? null;
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

  /** Public wrapper for synthetic key-down injection. Applies sync. */
  fireKeyDown(code: string): void {
    this._applyKeyDown(code);
  }

  /** Public wrapper for synthetic key-up injection. Applies sync. */
  fireKeyUp(code: string): void {
    this._applyKeyUp(code);
  }

  /**
   * Public wrapper for synthetic pointer movement. Defaults to the primary
   * mouse pointer (`id: 1`, `type: "mouse"`); pass `opts` to drive a specific
   * touch / pen pointer.
   */
  firePointerMove(
    screenX: number,
    screenY: number,
    opts?: { id?: number; type?: PointerType; isPrimary?: boolean },
  ): void {
    this._applyPointerMove(this.makeSyntheticInfo(screenX, screenY, -1, opts));
  }

  /**
   * Public wrapper for synthetic pointer-button presses. Defaults to button 0
   * on the primary mouse pointer. Pass `opts` for touch / pen / non-primary
   * pointers (e.g. `{ id: 5, type: "touch", isPrimary: false }`).
   */
  firePointerDown(
    button: 0 | 1 | 2 = 0,
    opts?: { id?: number; type?: PointerType; isPrimary?: boolean },
  ): void {
    const id = opts?.id ?? 1;
    const existing = this.pointers.get(id);
    this._applyPointerDown(
      this.makeSyntheticInfo(
        existing?.screenPos.x ?? 0,
        existing?.screenPos.y ?? 0,
        button,
        opts,
      ),
    );
  }

  /** Public wrapper for synthetic pointer-button releases. */
  firePointerUp(
    button: 0 | 1 | 2 = 0,
    opts?: { id?: number },
  ): void {
    const id = opts?.id ?? 1;
    const existing = this.pointers.get(id);
    const info: PointerEventInfo = {
      id,
      screenX: existing?.screenPos.x ?? 0,
      screenY: existing?.screenPos.y ?? 0,
      type: existing?.type ?? "mouse",
      isPrimary: existing?.isPrimary ?? id === 1,
      button,
    };
    this._applyPointerUp(info);
  }

  /** Public wrapper for synthetic wheel input. Applies sync, including
   * action edges and `onWheel` listener notification — matching the DOM path
   * so tests and inspector probes drive the full surface. */
  fireWheel(dx: number, dy: number): void {
    for (const fn of [...this.wheelListeners]) fn(dx, dy);
    this.applyWheelEdges(dx, dy);
  }

  private makeSyntheticInfo(
    screenX: number,
    screenY: number,
    button: number,
    opts?: { id?: number; type?: PointerType; isPrimary?: boolean },
  ): PointerEventInfo {
    const id = opts?.id ?? 1;
    return {
      id,
      screenX,
      screenY,
      type: opts?.type ?? "mouse",
      isPrimary: opts?.isPrimary ?? id === 1,
      button,
    };
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
      this._applyKeyDown(code);
      this.lastButtonState.set(code, true);
    } else if (!pressed && wasPressed) {
      this._applyKeyUp(code);
      this.lastButtonState.delete(code);
    }
  }

  /**
   * Inject a synthetic gamepad axis value. Stored separately from real-pad
   * axis state and consulted by `getStick` / `getTrigger` only when no real
   * pad is active — matching how a test fixture would use the API.
   *
   * Trigger axes additionally emit `GamepadLT`/`GamepadRT` button edges when
   * crossing `triggerThreshold`, mirroring real-pad polling so synthetic
   * inspector probes drive `isPressed` the same way as physical hardware.
   */
  fireGamepadAxis(side: GamepadAxisKey, value: number): void {
    const safe = Number.isFinite(value) ? value : 0;
    this.syntheticAxisState.set(side, safe);
    if (side === "leftTrigger") {
      this.fireGamepadButton("GamepadLT", safe >= this.triggerThreshold);
    } else if (side === "rightTrigger") {
      this.fireGamepadButton("GamepadRT", safe >= this.triggerThreshold);
    }
  }

  // -- Gamepad analog API --

  /**
   * Returns the deadzoned, magnitude-clamped stick vector for the given side.
   *
   * By default reads from the active pad (the most recently used controller,
   * or the first connected one if nothing has been used yet). Pass
   * `{ pad: index }` to read from a specific pad — useful for couch-co-op
   * where each player's controller is addressed explicitly.
   *
   * Falls back to synthetic injection (`fireGamepadAxis`) when no pad is
   * active — that's the test/probe path.
   */
  getStick(side: "left" | "right", opts?: { pad?: number }): Vec2 {
    const { x: xKey, y: yKey } = STICK_AXIS_KEYS[side];
    const padIdx = opts?.pad !== undefined ? opts.pad : this.activePadIndex;
    let x: number;
    let y: number;
    if (padIdx !== null) {
      x = this.gamepadAxisState.get(`${padIdx}:${xKey}`) ?? 0;
      y = this.gamepadAxisState.get(`${padIdx}:${yKey}`) ?? 0;
    } else {
      x = this.syntheticAxisState.get(xKey) ?? 0;
      y = this.syntheticAxisState.get(yKey) ?? 0;
    }
    const mag = Math.hypot(x, y);
    if (mag < this.stickDeadzone) return Vec2.ZERO;
    // Guards the deadzone:0 case — `mag === 0` slips past the deadzone check
    // when the deadzone is disabled, and dividing by zero would yield NaN.
    if (mag === 0) return Vec2.ZERO;
    const adjustedMag = Math.min(
      1,
      (mag - this.stickDeadzone) / (1 - this.stickDeadzone),
    );
    return new Vec2((x / mag) * adjustedMag, (y / mag) * adjustedMag);
  }

  /**
   * Returns the deadzoned trigger value (0..1) for the given side.
   * Reads from the active pad by default; use `{ pad: index }` for explicit
   * per-pad reads. Falls back to synthetic state when no pad is active.
   */
  getTrigger(side: "left" | "right", opts?: { pad?: number }): number {
    const key = TRIGGER_AXIS_KEYS[side];
    const padIdx = opts?.pad !== undefined ? opts.pad : this.activePadIndex;
    const v =
      padIdx !== null
        ? (this.gamepadAxisState.get(`${padIdx}:${key}`) ?? 0)
        : (this.syntheticAxisState.get(key) ?? 0);
    if (v < this.triggerDeadzone) return 0;
    return Math.min(1, (v - this.triggerDeadzone) / (1 - this.triggerDeadzone));
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

  // -- Active pad --

  /**
   * The pad whose analog input is read by default. Auto-promotes on input
   * activity (button press or stick/trigger above deadzone) and on first
   * connect. Returns `null` when no pad is connected.
   */
  getActivePad(): GamepadInfo | null {
    if (this.activePadIndex === null) return null;
    return this.connectedPads.get(this.activePadIndex) ?? null;
  }

  /**
   * Manually set the active pad. Index must match a currently connected pad
   * — pass an unknown index and the call is a no-op. Pass `null` to clear
   * (analog reads will fall back to synthetic state if any).
   */
  setActivePad(index: number | null): void {
    if (index !== null && !this.connectedPads.has(index)) return;
    this.setActivePadInternal(index);
  }

  /**
   * Subscribe to active-pad changes. Replays the current active pad
   * synchronously on subscribe so callers get the present state without a
   * separate `getActivePad()` call. Returns a disposer.
   */
  onActivePadChanged(
    fn: (info: GamepadInfo | null) => void,
  ): () => void {
    this.activePadListeners.push(fn);
    fn(this.getActivePad());
    return () => {
      const idx = this.activePadListeners.indexOf(fn);
      if (idx !== -1) this.activePadListeners.splice(idx, 1);
    };
  }

  private setActivePadInternal(index: number | null): void {
    if (this.activePadIndex === index) return;
    this.activePadIndex = index;
    const info = this.getActivePad();
    for (const fn of this.activePadListeners) fn(info);
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

  /**
   * Update analog deadzones at runtime. Either field may be omitted.
   * Values are clamped to `[0, 0.999]` — capping below 1 keeps the rescaling
   * denominator non-zero. Non-finite values are ignored.
   */
  setDeadzones(opts: { stick?: number; trigger?: number }): void {
    if (opts.stick !== undefined && Number.isFinite(opts.stick)) {
      this.stickDeadzone = Math.max(0, Math.min(0.999, opts.stick));
    }
    if (opts.trigger !== undefined && Number.isFinite(opts.trigger)) {
      this.triggerDeadzone = Math.max(0, Math.min(0.999, opts.trigger));
    }
  }

  /**
   * Set the trigger button-edge threshold (default 0.5). Clamped to `[0, 1]`;
   * non-finite values are ignored.
   */
  setTriggerThreshold(value: number): void {
    if (!Number.isFinite(value)) return;
    this.triggerThreshold = Math.max(0, Math.min(1, value));
  }

  // -- Internal: polling and connect/disconnect plumbing --

  /**
   * @internal Force-release held gamepad buttons and clear real-pad analog
   * snapshots. Used on tab-hide (where `navigator.getGamepads()` returns
   * stale data) and on disconnect when polling is paused. Synthetic axes
   * live in their own field, so they're untouched.
   */
  _releaseAllGamepadState(): void {
    for (const code of [...this.lastButtonState.keys()]) {
      this._applyKeyUp(code);
    }
    this.lastButtonState.clear();
    this.gamepadAxisState.clear();
    this.lastPadActivity.clear();
  }

  /** @internal Called by InputPlugin from `gamepadconnected` event or by
   * polling when discovering a previously-unknown pad. Idempotent. */
  _onGamepadConnected(info: GamepadInfo): void {
    if (this.connectedPads.has(info.index)) return;
    this.connectedPads.set(info.index, info);
    // First pad to connect auto-promotes — single-player "just works" with
    // no setActivePad call required.
    if (this.activePadIndex === null) {
      this.setActivePadInternal(info.index);
    }
    for (const fn of this.gamepadConnectListeners) fn(info);
  }

  /** @internal Called by InputPlugin from `gamepaddisconnected` event or by
   * polling when a pad vanishes silently. Idempotent. */
  _onGamepadDisconnected(info: GamepadInfo): void {
    if (!this.connectedPads.has(info.index)) return;
    this.connectedPads.delete(info.index);
    // Drop per-pad state for the departed pad.
    for (const key of [...this.gamepadAxisState.keys()]) {
      if (key.startsWith(`${info.index}:`)) this.gamepadAxisState.delete(key);
    }
    this.lastPadActivity.delete(info.index);
    // If the departed pad was active, demote and pick the first remaining
    // connected pad (or null) so analog reads keep working without API calls.
    if (this.activePadIndex === info.index) {
      const next = this.connectedPads.keys().next();
      this.setActivePadInternal(next.done ? null : next.value);
    }
    // Re-aggregate held buttons against remaining pads. We can't recursively
    // call `_pollGamepads` because the disconnect detection there is what got
    // us here — instead reconcile button state inline against the current
    // navigator snapshot.
    if (
      this.pollingEnabled &&
      typeof navigator !== "undefined" &&
      typeof navigator.getGamepads === "function"
    ) {
      this.reconcileButtonStateAcrossPads(navigator.getGamepads());
    } else {
      this._releaseAllGamepadState();
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

    // 1. Reconcile pad presence. The browser's `gamepadconnected` event is
    // gated behind first user input, so polling discovers already-plugged
    // pads. The matching `gamepaddisconnected` is also unreliable when the
    // tab backgrounds — polling reconciles vanished pads too.
    const liveIndices = new Set<number>();
    for (const pad of pads) {
      if (!pad) continue;
      liveIndices.add(pad.index);
      if (!this.connectedPads.has(pad.index)) {
        this._onGamepadConnected({ index: pad.index, id: pad.id });
      }
    }
    for (const [, info] of [...this.connectedPads]) {
      if (!liveIndices.has(info.index)) {
        this._onGamepadDisconnected(info);
      }
    }

    // 2. Defensive axis-state cleanup for any stale entries the disconnect
    // path missed (e.g. partial state during prior frames).
    for (const key of [...this.gamepadAxisState.keys()]) {
      const colon = key.indexOf(":");
      if (colon === -1) continue;
      const idx = Number.parseInt(key.slice(0, colon), 10);
      if (!liveIndices.has(idx)) this.gamepadAxisState.delete(key);
    }

    // 3. Refresh per-pad axis state and compute current activity. Activity
    // is captured into a map first so the promotion decision can consider
    // all pads together (not in iteration order).
    const currentActivity = new Map<number, boolean>();
    for (const pad of pads) {
      if (!pad) continue;
      const standard = pad.mapping === "standard";
      if (standard) {
        for (let axIdx = 0; axIdx < STANDARD_AXIS_KEYS.length; axIdx++) {
          const axisKey = STANDARD_AXIS_KEYS[axIdx];
          if (!axisKey) continue;
          const raw = pad.axes[axIdx] ?? 0;
          this.gamepadAxisState.set(
            `${pad.index}:${axisKey}`,
            Number.isFinite(raw) ? raw : 0,
          );
        }
        const lt = pad.buttons[TRIGGER_LEFT_INDEX]?.value ?? 0;
        const rt = pad.buttons[TRIGGER_RIGHT_INDEX]?.value ?? 0;
        this.gamepadAxisState.set(
          `${pad.index}:leftTrigger`,
          Number.isFinite(lt) ? lt : 0,
        );
        this.gamepadAxisState.set(
          `${pad.index}:rightTrigger`,
          Number.isFinite(rt) ? rt : 0,
        );
      }
      currentActivity.set(pad.index, this.padHasActivity(pad));
    }

    // 4. Auto-promotion. The active pad's own activity protects it — we
    // only promote when active is idle, so couch-co-op players don't steal
    // each other's slot mid-press. Among rising-edge candidates we pick the
    // first one in iteration order (deterministic; arbitrary in practice).
    const activeStillActive =
      this.activePadIndex !== null &&
      (currentActivity.get(this.activePadIndex) ?? false);
    if (!activeStillActive) {
      for (const [padIdx, isActive] of currentActivity) {
        const wasActive = this.lastPadActivity.get(padIdx) ?? false;
        if (isActive && !wasActive && padIdx !== this.activePadIndex) {
          this.setActivePadInternal(padIdx);
          break;
        }
      }
    }
    for (const [padIdx, isActive] of currentActivity) {
      this.lastPadActivity.set(padIdx, isActive);
    }

    // 5. Reconcile button state across all pads (any-pad action map).
    this.reconcileButtonStateAcrossPads(pads);
  }

  /** Whether a pad has any input that should claim active-pad ownership. */
  private padHasActivity(pad: Gamepad): boolean {
    for (const btn of pad.buttons) {
      if (btn?.pressed) return true;
    }
    if (pad.mapping === "standard") {
      const lx = pad.axes[0] ?? 0;
      const ly = pad.axes[1] ?? 0;
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.hypot(lx, ly) > this.stickDeadzone) return true;
      if (Math.hypot(rx, ry) > this.stickDeadzone) return true;
      const lt = pad.buttons[TRIGGER_LEFT_INDEX]?.value ?? 0;
      const rt = pad.buttons[TRIGGER_RIGHT_INDEX]?.value ?? 0;
      if (lt > this.triggerDeadzone) return true;
      if (rt > this.triggerDeadzone) return true;
    }
    return false;
  }

  /**
   * Aggregate "any pad pressed" per code across the supplied pad list and
   * emit `_applyKeyDown`/`_applyKeyUp` edges. `lastButtonState` is updated
   * unconditionally so listen-mode interception doesn't cause held-button
   * re-fires on subsequent frames.
   */
  private reconcileButtonStateAcrossPads(
    pads: ReadonlyArray<Gamepad | null>,
  ): void {
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
          standard &&
          (btnIdx === TRIGGER_LEFT_INDEX || btnIdx === TRIGGER_RIGHT_INDEX);
        const isDown = isTrigger ? btn.value >= this.triggerThreshold : btn.pressed;
        if (isDown) codePressed.set(code, true);
      }
    }

    const allCodes = new Set<string>([
      ...this.lastButtonState.keys(),
      ...codePressed.keys(),
    ]);
    for (const code of allCodes) {
      const wasPressed = this.lastButtonState.get(code) ?? false;
      const isPressed = codePressed.get(code) ?? false;
      if (isPressed && !wasPressed) {
        this._applyKeyDown(code);
      } else if (!isPressed && wasPressed) {
        this._applyKeyUp(code);
      }
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
    this.notifyActionListeners(this.actionListeners, name);
  }

  /** Release all synthetic and physical input state. */
  clearAll(): void {
    for (const code of [...this.pressedKeys]) {
      this._applyKeyUp(code);
    }
    // Hard reset: synthetic releases generated above are intentionally
    // discarded. Callers want a clean slate, not a flurry of justReleased
    // pulses for downstream listeners.
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
    this.holdStart.clear();
    this.syntheticPressedActions.clear();
    this.syntheticActionStarts.clear();
    this.pointers.clear();
    this.primaryPointerId = null;
    this.mouseButtonAggregate.clear();
    this.consumedPointers.clear();
    this.consumedWheelThisFrame = false;
    this.inputQueue.length = 0;
    this.lastButtonState.clear();
    this.gamepadAxisState.clear();
    this.syntheticAxisState.clear();
    this.lastPadActivity.clear();
  }

  /**
   * Drop all tracked pointers and release the aggregate `MouseLeft/Middle/Right`
   * codes without touching keyboard or gamepad state. Useful for window-blur
   * / page-hide handling.
   */
  clearPointerButtons(): void {
    for (const button of [...this.mouseButtonAggregate]) {
      const code = MOUSE_BUTTON_CODES[button];
      if (code) this._applyKeyUp(code);
    }
    this.mouseButtonAggregate.clear();
    this.pointers.clear();
    this.primaryPointerId = null;
    this.consumedPointers.clear();
    // Discard any pointer events that arrived before tab-hide drained.
    this.inputQueue = this.inputQueue.filter(
      (e) =>
        e.kind !== "pointerDown" &&
        e.kind !== "pointerUp" &&
        e.kind !== "pointerCancel",
    );
  }

  /** Snapshot of current held input state for inspector tooling. */
  snapshotState(): {
    keys: string[];
    actions: string[];
    mouse: { x: number; y: number; buttons: number[]; down: boolean };
    pointers: Array<{
      id: number;
      x: number;
      y: number;
      type: PointerType;
      isPrimary: boolean;
      buttons: number[];
      down: boolean;
    }>;
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
    const aggregateButtons = [...this.mouseButtonAggregate].sort((a, b) => a - b);
    const pointers = [...this.pointers.values()]
      .sort((a, b) => a.id - b.id)
      .map((p) => ({
        id: p.id,
        x: p.screenPos.x,
        y: p.screenPos.y,
        type: p.type,
        isPrimary: p.isPrimary,
        buttons: [...p.buttons].sort((a, b) => a - b),
        down: p.isDown,
      }));
    const primary = this.getPrimaryPointer();
    const realAxes = [...this.gamepadAxisState.entries()]
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([key, value]) => ({ key, value }));
    const syntheticAxes = [...this.syntheticAxisState.entries()]
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([key, value]) => ({ key: `synthetic:${key}`, value }));
    const axes = [...realAxes, ...syntheticAxes].sort((a, b) => cmp(a.key, b.key));

    return {
      keys: nonGamepadKeys,
      actions,
      mouse: {
        x: primary?.screenPos.x ?? 0,
        y: primary?.screenPos.y ?? 0,
        buttons: aggregateButtons,
        down: this.mouseButtonAggregate.size > 0,
      },
      pointers,
      gamepad: {
        buttons: gamepadButtons,
        axes,
      },
    };
  }

  // -- Internal: DOM-handler enqueue path --

  /**
   * @internal Stash the renderer adapter so the drain step can call its
   * optional `hitTestUI(x, y)` for the auto-consume fallback. Called by
   * `InputPlugin.install`.
   */
  _setRenderer(renderer: RendererAdapter | null): void {
    this.renderer = renderer;
  }

  /** @internal */
  _enqueueKeyDown(code: string): void {
    this.inputQueue.push({ kind: "keyDown", code });
  }

  /** @internal */
  _enqueueKeyUp(code: string): void {
    this.inputQueue.push({ kind: "keyUp", code });
  }

  /**
   * @internal Sync portion: upsert the pointer entry (existence, screenPos,
   * type, isPrimary, primaryPointerId) and notify pointerMoveListeners so
   * pointer-tracking UIs see live cursor positions. Move events do not carry
   * action-map edges, so they are not queued.
   */
  _enqueuePointerMove(info: PointerEventInfo): void {
    const pointer = this.upsertPointer(info);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    this.notifyPointerListeners(this.pointerMoveListeners, pointer);
  }

  /**
   * @internal Sync portion: upsert pointer (existence, screenPos, type,
   * isPrimary, primaryPointerId) and notify pointerDownListeners. Button
   * mutation, action-map edges, and mouse-aggregate emit are deferred to the
   * next drain at `Phase.EarlyUpdate` so {@link consumePointer} (or the
   * renderer's UI hit-test) can suppress them, AND so a same-frame
   * down+up that arrives before drain still produces the correct
   * `MouseLeft` press/release edges (recomputing aggregate from live state
   * after sync mutation would silently drop the transient transition).
   *
   * Listeners therefore observe `pointer.buttons` BEFORE this event's edge is
   * applied. That's a documented tradeoff: the canonical event-button info
   * is in the `FederatedPointerEvent` / `PointerEvent` the user's Pixi
   * handler already receives, so the lossy `info.buttons` view rarely
   * matters in practice.
   */
  _enqueuePointerDown(info: PointerEventInfo): void {
    const pointer = this.upsertPointer(info);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    this.notifyPointerListeners(this.pointerDownListeners, pointer);
    this.inputQueue.push({ kind: "pointerDown", info });
  }

  /** @internal */
  _enqueuePointerUp(info: PointerEventInfo): void {
    const pointer = this.upsertPointer(info);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    this.notifyPointerListeners(this.pointerUpListeners, pointer);
    this.inputQueue.push({ kind: "pointerUp", info });
  }

  /** @internal */
  _enqueuePointerCancel(id: number): void {
    const pointer = this.pointers.get(id);
    if (pointer) {
      this.notifyPointerListeners(this.pointerUpListeners, pointer);
    }
    this.inputQueue.push({ kind: "pointerCancel", id });
  }

  /** @internal */
  _enqueueWheel(dx: number, dy: number): void {
    // Notify wheel listeners synchronously — they're explicit user opt-ins.
    for (const fn of [...this.wheelListeners]) fn(dx, dy);
    this.inputQueue.push({ kind: "wheel", dx, dy });
  }

  /**
   * @internal Drain queued DOM events at `Phase.EarlyUpdate`. Each event
   * applies its deferred state (button mutations, action-map edges,
   * mouse-aggregate transitions). Consumed pointers are excluded from the
   * mouse aggregate so UI-claimed presses do not propagate to gameplay
   * actions. The renderer's optional `hitTestUI(x, y)` auto-claims a pointer
   * whose `pointerdown` lands on a UI-marked container.
   */
  _drainInputQueue(): void {
    if (this.inputQueue.length === 0) return;
    const queue = this.inputQueue;
    this.inputQueue = [];
    for (const event of queue) {
      switch (event.kind) {
        case "keyDown":
          this._applyKeyDown(event.code);
          break;
        case "keyUp":
          this._applyKeyUp(event.code);
          break;
        case "pointerDown":
          this.drainPointerDown(event.info);
          break;
        case "pointerUp":
          this.drainPointerUp(event.info);
          break;
        case "pointerCancel":
          this.drainPointerCancel(event.id);
          break;
        case "wheel":
          this.applyWheelEdges(event.dx, event.dy);
          break;
      }
    }
  }

  private drainPointerDown(info: PointerEventInfo): void {
    // Auto-consume on UI hit. Skipped if explicitly already consumed (the
    // primitive `consumePointer` won — no need to re-check) so handler code
    // stays authoritative.
    if (
      !this.consumedPointers.has(info.id) &&
      this.renderer?.hitTestUI?.(info.screenX, info.screenY)
    ) {
      this.consumedPointers.add(info.id);
    }
    const pointer = this.pointers.get(info.id);
    if (!pointer) return;
    if (info.button >= 0 && info.button <= 2) {
      pointer.buttons.add(info.button);
      pointer.isDown = true;
      this.recomputeMouseAggregate(info.button);
    } else {
      pointer.isDown = pointer.buttons.size > 0;
    }
  }

  private drainPointerUp(info: PointerEventInfo): void {
    const pointer = this.pointers.get(info.id);
    if (!pointer) return;
    if (info.button >= 0 && info.button <= 2) {
      pointer.buttons.delete(info.button);
      this.recomputeMouseAggregate(info.button);
    }
    pointer.isDown = pointer.buttons.size > 0;
    if (!pointer.isDown) {
      // End of event cycle — clear the consume mark so the next press starts
      // unmarked. Touch / pen pointers also vanish here (mouse persists for
      // hover queries; the browser does not emit a separate "leave").
      this.consumedPointers.delete(info.id);
      if (pointer.type !== "mouse") {
        this.removePointer(pointer.id);
      }
    }
  }

  private drainPointerCancel(id: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    const heldButtons = [...pointer.buttons];
    pointer.buttons.clear();
    pointer.isDown = false;
    for (const button of heldButtons) {
      this.recomputeMouseAggregate(button);
    }
    this.consumedPointers.delete(id);
    if (pointer.type !== "mouse") {
      this.removePointer(id);
    }
  }

  private applyWheelEdges(dx: number, dy: number): void {
    if (this.consumedWheelThisFrame) return;
    // Wheel codes appear as one-frame `justPressed` edges that never enter
    // `pressedKeys` — scrolling is not a held state, just discrete ticks.
    if (Math.abs(dy) > 0.001) {
      const code = dy < 0 ? "WheelUp" : "WheelDown";
      this.fireOneFrameEdge(code);
    }
    if (Math.abs(dx) > 0.001) {
      const code = dx < 0 ? "WheelLeft" : "WheelRight";
      this.fireOneFrameEdge(code);
    }
  }

  /**
   * Add a code to `justPressedKeys` without entering `pressedKeys`. Used for
   * discrete edges (wheel ticks) that are never "held". Listeners and
   * `listenForNextKey` still fire as usual.
   */
  private fireOneFrameEdge(code: string): void {
    if (this.listenResolve) {
      const resolve = this.listenResolve;
      this.listenResolve = null;
      resolve(code);
      return;
    }
    this.justPressedKeys.add(code);
    this.notifyKeyListeners(this.keyDownListeners, this.keyDownListenersAny, code);
    for (const action of this.actionsForCode(code)) {
      this.notifyActionListeners(this.actionListeners, action);
    }
  }

  // -- Internal: synthetic / sync apply path --

  /**
   * @internal Synthetic key-down. DOM-originated events must use
   * {@link _enqueueKeyDown} so `consumePointer` and the UI hit-test fallback
   * have a chance to run before action edges fire.
   */
  _applyKeyDown(code: string): void {
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
      this.notifyKeyListeners(this.keyDownListeners, this.keyDownListenersAny, code);
      for (const action of this.actionsForCode(code)) {
        this.notifyActionListeners(this.actionListeners, action);
      }
    }
  }

  /**
   * @internal Synthetic key-up. DOM-originated events must use
   * {@link _enqueueKeyUp}.
   */
  _applyKeyUp(code: string): void {
    if (this.pressedKeys.has(code)) {
      this.pressedKeys.delete(code);
      this.justReleasedKeys.add(code);
      this.holdStart.delete(code);
      this.notifyKeyListeners(this.keyUpListeners, this.keyUpListenersAny, code);
      for (const action of this.actionsForCode(code)) {
        this.notifyActionListeners(this.actionReleasedListeners, action);
      }
    }
  }

  /**
   * @internal Synthetic pointer move. DOM-originated events must use
   * {@link _enqueuePointerMove}.
   */
  _applyPointerMove(info: PointerEventInfo): void {
    const pointer = this.upsertPointer(info);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    this.notifyPointerListeners(this.pointerMoveListeners, pointer);
  }

  /**
   * @internal Synthetic pointer down. DOM-originated events must use
   * {@link _enqueuePointerDown}. This applies all state (button mutation,
   * mouse-aggregate emit, listener notify) synchronously.
   */
  _applyPointerDown(info: PointerEventInfo): void {
    const pointer = this.upsertPointer(info);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    if (info.button >= 0 && info.button <= 2) {
      pointer.buttons.add(info.button);
      pointer.isDown = true;
      this.recomputeMouseAggregate(info.button);
    } else {
      pointer.isDown = pointer.buttons.size > 0;
    }
    this.notifyPointerListeners(this.pointerDownListeners, pointer);
  }

  /**
   * @internal Synthetic pointer up. DOM-originated events must use
   * {@link _enqueuePointerUp}.
   */
  _applyPointerUp(info: PointerEventInfo): void {
    const pointer = this.upsertPointer(info);
    pointer.screenPos = new Vec2(info.screenX, info.screenY);
    if (info.button >= 0 && info.button <= 2) {
      pointer.buttons.delete(info.button);
      this.recomputeMouseAggregate(info.button);
    }
    pointer.isDown = pointer.buttons.size > 0;
    this.notifyPointerListeners(this.pointerUpListeners, pointer);
    if (!pointer.isDown) {
      this.consumedPointers.delete(info.id);
      if (pointer.type !== "mouse") {
        this.removePointer(pointer.id);
      }
    }
  }

  /**
   * @internal Synthetic pointer cancel. Clears all buttons on the pointer,
   * fires up-listeners, and drops the entry (unless it's a mouse). Mirrors
   * the drain-time {@link drainPointerCancel} logic.
   */
  _applyPointerCancel(id: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    const heldButtons = [...pointer.buttons];
    pointer.buttons.clear();
    pointer.isDown = false;
    for (const button of heldButtons) {
      this.recomputeMouseAggregate(button);
    }
    this.notifyPointerListeners(this.pointerUpListeners, pointer);
    this.consumedPointers.delete(id);
    if (pointer.type !== "mouse") {
      this.removePointer(id);
    }
  }

  private upsertPointer(info: PointerEventInfo): MutablePointerInfo {
    let pointer = this.pointers.get(info.id);
    if (!pointer) {
      pointer = {
        id: info.id,
        screenPos: new Vec2(info.screenX, info.screenY),
        type: info.type,
        isPrimary: info.isPrimary,
        buttons: new Set<number>(),
        isDown: false,
      };
      this.pointers.set(info.id, pointer);
    } else {
      pointer.type = info.type;
      pointer.isPrimary = info.isPrimary;
    }
    if (info.isPrimary) {
      this.primaryPointerId = info.id;
    } else if (this.primaryPointerId === null) {
      this.primaryPointerId = info.id;
    }
    return pointer;
  }

  private removePointer(id: number): void {
    this.pointers.delete(id);
    if (this.primaryPointerId === id) {
      // Promote any remaining tracked pointer to primary so singular getters
      // keep returning sensible state. Prefer one the browser already flagged
      // primary, otherwise the first one we find.
      let next: number | null = null;
      for (const p of this.pointers.values()) {
        if (p.isPrimary) {
          next = p.id;
          break;
        }
        if (next === null) next = p.id;
      }
      this.primaryPointerId = next;
    }
  }

  /**
   * Recompute the `MouseLeft/Middle/Right` aggregate edge for `button`.
   * Consumed pointers are excluded so a UI-claimed press never propagates to
   * gameplay actions, even if a second non-UI pointer simultaneously holds
   * the same button.
   */
  private recomputeMouseAggregate(button: number): void {
    const code = MOUSE_BUTTON_CODES[button];
    if (!code) return;
    let nowAny = false;
    for (const p of this.pointers.values()) {
      if (this.consumedPointers.has(p.id)) continue;
      if (p.buttons.has(button)) {
        nowAny = true;
        break;
      }
    }
    const wasAny = this.mouseButtonAggregate.has(button);
    if (nowAny && !wasAny) {
      this.mouseButtonAggregate.add(button);
      this._applyKeyDown(code);
    } else if (!nowAny && wasAny) {
      this.mouseButtonAggregate.delete(button);
      this._applyKeyUp(code);
    }
  }

  private notifyPointerListeners(
    listeners: Array<(info: PointerInfo) => void>,
    pointer: MutablePointerInfo,
  ): void {
    if (listeners.length === 0) return;
    // Snapshot once per emission so all listeners see the same view and a
    // misbehaving consumer can't mutate manager state. Iterate a copy of
    // `listeners` so a callback that calls its own disposer doesn't skip the
    // next one.
    const info = this.toPointerInfo(pointer);
    for (const fn of [...listeners]) {
      fn(info);
    }
  }

  private notifyKeyListeners(
    perCode: Map<string, Array<(code: string) => void>>,
    anyList: Array<(code: string) => void>,
    code: string,
  ): void {
    const list = perCode.get(code);
    if (list) {
      for (const fn of [...list]) fn(code);
    }
    if (anyList.length > 0) {
      for (const fn of [...anyList]) fn(code);
    }
  }

  private notifyActionListeners(
    perAction: Map<string, Array<(name: string) => void>>,
    name: string,
  ): void {
    const list = perAction.get(name);
    if (!list) return;
    for (const fn of [...list]) fn(name);
  }

  /**
   * Action names that include `code` in their bindings AND whose group is
   * currently enabled. Used for `onAction` / `onActionReleased` listener
   * fan-out so disabled-group suppression matches `isPressed` behavior.
   */
  private actionsForCode(code: string): string[] {
    const result: string[] = [];
    for (const [action, keys] of this.actionMap) {
      if (keys.includes(code) && this.isActionEnabled(action)) {
        result.push(action);
      }
    }
    return result;
  }

  /** @internal Clear per-frame justPressed/justReleased flags. */
  _clearFrameState(): void {
    this.justPressedKeys.clear();
    this.justReleasedKeys.clear();
    this.syntheticPressedActions.clear();
    this.syntheticActionStarts.clear();
    this.consumedWheelThisFrame = false;
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

  // -- Internal: sync-path aliases (back-compat with pre-0.5.x test callers) --

  /** @internal Sync alias — see {@link _applyKeyDown}. */
  _onKeyDown(code: string): void {
    this._applyKeyDown(code);
  }
  /** @internal Sync alias — see {@link _applyKeyUp}. */
  _onKeyUp(code: string): void {
    this._applyKeyUp(code);
  }
  /** @internal Sync alias — see {@link _applyPointerMove}. */
  _onPointerMove(info: PointerEventInfo): void {
    this._applyPointerMove(info);
  }
  /** @internal Sync alias — see {@link _applyPointerDown}. */
  _onPointerDown(info: PointerEventInfo): void {
    this._applyPointerDown(info);
  }
  /** @internal Sync alias — see {@link _applyPointerUp}. */
  _onPointerUp(info: PointerEventInfo): void {
    this._applyPointerUp(info);
  }
  /** @internal Sync alias — see {@link _applyPointerCancel}. */
  _onPointerCancel(id: number): void {
    this._applyPointerCancel(id);
  }
}

import { LEAVE_SLOP, VirtualButton } from "./button.js";
import {
  normalizeControlsConfig,
  resolveButtonLayouts,
  resolveStickLayout,
} from "./layout.js";
import { VirtualStick } from "./stick.js";
import type {
  ClusterCorner,
  ControlPlacement,
  Point,
  ViewportRect,
  VirtualControlsConfig,
} from "./types.js";

/**
 * Observation hooks the host wires up (the component mirrors these onto the
 * `InputManager` and re-emits them as entity events). `onStickMove` fires on
 * every pointer move while engaged — and once per engaged stick on a
 * viewport change — so mirror work must be cheap per call.
 */
export interface VirtualControlsModelCallbacks {
  onStickEngage?(stick: VirtualStick): void;
  onStickMove?(stick: VirtualStick): void;
  onStickRelease?(stick: VirtualStick): void;
  onButtonPress?(button: VirtualButton): void;
  onButtonRelease?(button: VirtualButton): void;
  /**
   * Gate for claims that do NOT go through the host's pointer-down path —
   * today that's a `pressOnEnter` slide-in. The host applies the same
   * policy it applies to fresh presses (visible/enabled/unpaused/not
   * consumed). Absent → slide-ins are always allowed. Releases are never
   * gated.
   */
  canClaim?(pointerId: number): boolean;
}

/**
 * Headless aggregate of every control plus the multi-touch routing between
 * them: each pointer owns at most one control, buttons claim before sticks
 * (they're smaller and may sit inside a stick zone), and unclaimed down
 * pointers are tracked so `pressOnEnter` buttons can catch a thumb roll.
 *
 * The host feeds it pointer events in virtual px and a viewport rect;
 * `pointerDown` / `pointerMove` return `true` when that event claimed the
 * pointer, so the host can mark it consumed exactly once.
 */
export class VirtualControlsModel {
  readonly sticks: readonly VirtualStick[];
  readonly buttons: readonly VirtualButton[];

  private readonly cluster: ControlPlacement | ClusterCorner | undefined;
  private readonly cb: VirtualControlsModelCallbacks;
  private readonly owners = new Map<number, VirtualStick | VirtualButton>();
  private readonly strays = new Set<number>();
  /** Last position per OWNING pointer — replayed on viewport changes so an
   *  engaged control re-evaluates against its new geometry. */
  private readonly ownerPos = new Map<number, Point>();
  private readonly wantsEnterTracking: boolean;
  private _viewport: ViewportRect = { x: 0, y: 0, width: 800, height: 600 };

  constructor(
    config: VirtualControlsConfig,
    callbacks: VirtualControlsModelCallbacks = {},
  ) {
    const norm = normalizeControlsConfig(config);
    this.sticks = norm.sticks.map((c) => new VirtualStick(c));
    this.buttons = norm.buttons.map((c) => new VirtualButton(c));
    this.cluster = norm.cluster;
    this.cb = callbacks;
    this.wantsEnterTracking = this.buttons.some((b) => b.config.pressOnEnter);
    this.applyLayout();
  }

  get viewport(): ViewportRect {
    return this._viewport;
  }

  /** Re-resolve all control geometry against a new viewport rect. */
  setViewport(rect: ViewportRect): void {
    const v = this._viewport;
    if (
      v.x === rect.x &&
      v.y === rect.y &&
      v.width === rect.width &&
      v.height === rect.height
    ) {
      return;
    }
    this._viewport = rect;
    this.applyLayout();
  }

  /** First stick, or the one with the given id. */
  stick(id?: string): VirtualStick | undefined {
    if (id === undefined) return this.sticks[0];
    return this.sticks.find((s) => s.id === id);
  }

  button(id: string): VirtualButton | undefined {
    return this.buttons.find((b) => b.id === id);
  }

  /**
   * Route a pointer press. Returns `true` when a control claimed the pointer
   * (the host should consume it so the press stays out of gameplay actions).
   */
  pointerDown(id: number, x: number, y: number): boolean {
    if (this.owners.has(id)) return false;
    for (const b of this.buttons) {
      if (!b.pressed && b.hitTest(x, y)) {
        this.claim(id, b, x, y);
        b.press(id);
        this.cb.onButtonPress?.(b);
        return true;
      }
    }
    for (const s of this.sticks) {
      if (!s.active && s.hitTest(x, y)) {
        this.claim(id, s, x, y);
        s.engage(id, x, y);
        this.cb.onStickEngage?.(s);
        return true;
      }
    }
    if (this.wantsEnterTracking) this.strays.add(id);
    return false;
  }

  /**
   * Route a pointer move. Returns `true` when the move claimed the pointer —
   * only possible via a `pressOnEnter` button catching a slide-in.
   */
  pointerMove(id: number, x: number, y: number): boolean {
    const owner = this.owners.get(id);
    if (owner instanceof VirtualStick) {
      this.ownerPos.set(id, { x, y });
      owner.move(x, y);
      this.cb.onStickMove?.(owner);
      return false;
    }
    if (owner instanceof VirtualButton) {
      this.ownerPos.set(id, { x, y });
      if (owner.config.releaseOnLeave && !owner.hitTest(x, y, LEAVE_SLOP)) {
        this.releaseButton(id, owner);
        // The finger is still down — let it roll onto a pressOnEnter button.
        if (this.wantsEnterTracking) this.strays.add(id);
      }
      return false;
    }
    if (this.strays.has(id)) {
      for (const b of this.buttons) {
        if (b.config.pressOnEnter && !b.pressed && b.hitTest(x, y)) {
          if (this.cb.canClaim && !this.cb.canClaim(id)) return false;
          this.strays.delete(id);
          this.claim(id, b, x, y);
          b.press(id);
          this.cb.onButtonPress?.(b);
          return true;
        }
      }
    }
    return false;
  }

  /** Route a pointer release or cancel. */
  pointerUp(id: number): void {
    this.strays.delete(id);
    const owner = this.owners.get(id);
    if (!owner) return;
    this.owners.delete(id);
    this.ownerPos.delete(id);
    if (owner instanceof VirtualStick) {
      owner.release();
      this.cb.onStickRelease?.(owner);
    } else {
      owner.release();
      this.cb.onButtonRelease?.(owner);
    }
  }

  /**
   * Release every engaged control (fires the release callbacks, so mirrored
   * actions and axes reset). Used when the overlay hides or is destroyed.
   */
  releaseAll(): void {
    for (const id of [...this.owners.keys()]) {
      this.pointerUp(id);
    }
    this.strays.clear();
  }

  private applyLayout(): void {
    for (const s of this.sticks) {
      s.setLayout(resolveStickLayout(s.config, this._viewport));
    }
    const layouts = resolveButtonLayouts(
      this.buttons.map((b) => b.config),
      this.cluster,
      this._viewport,
    );
    this.buttons.forEach((b, i) => {
      const layout = layouts[i];
      if (layout) b.setLayout(layout);
    });
    // Mid-gesture relayout (rotation, resize, fit change): a stationary
    // finger emits no pointermove, so replay each owner's last position
    // against the new geometry — sticks recompute deflection (and the host
    // re-mirrors via onStickMove), buttons re-run the leave test.
    for (const [id, pos] of this.ownerPos) {
      const owner = this.owners.get(id);
      if (owner instanceof VirtualStick) {
        owner.move(pos.x, pos.y);
        this.cb.onStickMove?.(owner);
      } else if (owner instanceof VirtualButton) {
        if (
          owner.config.releaseOnLeave &&
          !owner.hitTest(pos.x, pos.y, LEAVE_SLOP)
        ) {
          this.releaseButton(id, owner);
          if (this.wantsEnterTracking) this.strays.add(id);
        }
      }
    }
  }

  /** Take ownership of a pointer and remember where it last was. */
  private claim(
    id: number,
    control: VirtualStick | VirtualButton,
    x: number,
    y: number,
  ): void {
    this.owners.set(id, control);
    this.ownerPos.set(id, { x, y });
  }

  private releaseButton(id: number, button: VirtualButton): void {
    button.release();
    this.owners.delete(id);
    this.ownerPos.delete(id);
    this.cb.onButtonRelease?.(button);
  }
}

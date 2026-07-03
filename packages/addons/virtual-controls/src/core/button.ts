import type { ButtonLayout, ResolvedButtonConfig } from "./types.js";

/**
 * Slop multiplier for the leave test: the owning pointer must travel past
 * 1.15 × radius before `releaseOnLeave` lets go, so a thumb resting on the
 * rim doesn't chatter.
 */
export const LEAVE_SLOP = 1.15;

/**
 * Headless on-screen button: a circle that one pointer at a time may own.
 * Press/release transitions are driven by the model (down/slide/up routing);
 * presenters read `pressed` + `layout` to draw.
 */
export class VirtualButton {
  readonly id: string;
  readonly config: ResolvedButtonConfig;

  private _layout: ButtonLayout = { center: { x: 0, y: 0 }, radius: 1 };
  private _pointerId: number | null = null;
  private _pressed = false;

  constructor(config: ResolvedButtonConfig) {
    this.id = config.id;
    this.config = config;
  }

  /** Presenter label (config `label`, defaulted from the id). */
  get label(): string {
    return this.config.label;
  }

  /** The mirrored action name, if any. */
  get action(): string | undefined {
    return this.config.action;
  }

  /** Resolved geometry (updated by the model on viewport changes). */
  get layout(): ButtonLayout {
    return this._layout;
  }

  get pressed(): boolean {
    return this._pressed;
  }

  /** The owning pointer id, or null while released. */
  get pointerId(): number | null {
    return this._pointerId;
  }

  setLayout(layout: ButtonLayout): void {
    this._layout = layout;
  }

  /** Whether (x, y) falls inside the button circle × `slop`. */
  hitTest(x: number, y: number, slop = 1): boolean {
    const r = this._layout.radius * slop;
    const dx = x - this._layout.center.x;
    const dy = y - this._layout.center.y;
    return dx * dx + dy * dy <= r * r;
  }

  press(pointerId: number): void {
    this._pointerId = pointerId;
    this._pressed = true;
  }

  release(): void {
    this._pointerId = null;
    this._pressed = false;
  }
}

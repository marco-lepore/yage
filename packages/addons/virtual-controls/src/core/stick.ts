import { MathUtils, Vec2 } from "@yagejs/core";
import { applyRadialDeadzone } from "@yagejs/input";
import type {
  Point,
  ResolvedStickConfig,
  StickDigitalState,
  StickLayout,
  ViewportRect,
} from "./types.js";

/** Grab circle for default-hit "fixed" sticks, in radii. */
const FIXED_GRAB_SCALE = 1.5;
/** A digital direction releases at threshold × this (hysteresis). */
const RELEASE_HYSTERESIS = 0.75;

/**
 * Headless joystick state machine. Owns the fiddly parts — engagement
 * hit-testing, base re-centering per mode, deflection clamping, dead-zone
 * rescale, and digital 4-way extraction with hysteresis. Coordinates are
 * virtual px; `value`/`rawValue` use the screen convention (+x right,
 * +y down), matching `InputManager.getVector`.
 *
 * The model routes pointers into it; presenters read `basePos` / `knobPos` /
 * `active` each frame to draw.
 */
export class VirtualStick {
  readonly id: string;
  readonly config: ResolvedStickConfig;

  private _layout: StickLayout = {
    center: { x: 0, y: 0 },
    radius: 1,
    zone: undefined,
  };
  private _base: Point = { x: 0, y: 0 };
  private _pointerId: number | null = null;
  private _raw = Vec2.ZERO;
  private _value = Vec2.ZERO;
  private _digital = { left: false, right: false, up: false, down: false };

  constructor(config: ResolvedStickConfig) {
    this.id = config.id;
    this.config = config;
  }

  /** Resolved geometry (updated by the model on viewport changes). */
  get layout(): StickLayout {
    return this._layout;
  }

  /** Whether a pointer currently drives the stick. */
  get active(): boolean {
    return this._pointerId !== null;
  }

  /** The owning pointer id, or null while idle. */
  get pointerId(): number | null {
    return this._pointerId;
  }

  /** Current base center (recenters under the finger in floating/follow). */
  get basePos(): Point {
    return this._base;
  }

  /** Knob center: base + raw deflection × radius. */
  get knobPos(): Point {
    return {
      x: this._base.x + this._raw.x * this._layout.radius,
      y: this._base.y + this._raw.y * this._layout.radius,
    };
  }

  /**
   * Dead-zoned deflection, each axis -1..1, magnitude ≤ 1. Zero vector while
   * idle or inside the dead zone; rescaled so deflection ramps from 0 at the
   * dead-zone edge to 1 at full travel.
   */
  get value(): Vec2 {
    return this._value;
  }

  /**
   * Deflection without the dead zone (still magnitude-clamped to 1). This is
   * what the `axes` mirror feeds `fireGamepadAxis` — `getStick()` applies its
   * own configured deadzone, exactly as it does for physical pad hardware.
   */
  get rawValue(): Vec2 {
    return this._raw;
  }

  /** Digital 4-way state derived from `value` with hysteresis. */
  get digital(): StickDigitalState {
    return this._digital;
  }

  setLayout(layout: StickLayout): void {
    this._layout = layout;
    if (this._pointerId === null) {
      this._base = layout.center;
    } else if (layout.zone) {
      this._base = clampToRect(this._base, layout.zone);
    } else {
      this._base = layout.center;
    }
  }

  /** Whether a touch at (x, y) may engage the stick. */
  hitTest(x: number, y: number): boolean {
    const zone = this._layout.zone;
    if (zone) {
      return (
        x >= zone.x &&
        x <= zone.x + zone.width &&
        y >= zone.y &&
        y <= zone.y + zone.height
      );
    }
    // Default-hit fixed stick: a grab circle around the base.
    const grab = this._layout.radius * FIXED_GRAB_SCALE;
    const dx = x - this._layout.center.x;
    const dy = y - this._layout.center.y;
    return dx * dx + dy * dy <= grab * grab;
  }

  engage(pointerId: number, x: number, y: number): void {
    this._pointerId = pointerId;
    if (this.config.mode === "fixed") {
      this._base = this._layout.center;
    } else {
      const zone = this._layout.zone;
      this._base = zone ? clampToRect({ x, y }, zone) : { x, y };
    }
    this.applyPointer(x, y);
  }

  move(x: number, y: number): void {
    if (this._pointerId === null) return;
    if (this.config.mode === "follow") {
      const dx = x - this._base.x;
      const dy = y - this._base.y;
      const dist = Math.hypot(dx, dy);
      const radius = this._layout.radius;
      if (dist > radius) {
        // Drag the base along by the excess so deflection holds at full.
        const excess = dist - radius;
        const dragged = {
          x: this._base.x + (dx / dist) * excess,
          y: this._base.y + (dy / dist) * excess,
        };
        const zone = this._layout.zone;
        this._base = zone ? clampToRect(dragged, zone) : dragged;
      }
    }
    this.applyPointer(x, y);
  }

  release(): void {
    this._pointerId = null;
    this._raw = Vec2.ZERO;
    this._value = Vec2.ZERO;
    this._digital = { left: false, right: false, up: false, down: false };
    this._base = this._layout.center;
  }

  private applyPointer(x: number, y: number): void {
    const radius = this._layout.radius;
    let rx = (x - this._base.x) / radius;
    let ry = (y - this._base.y) / radius;
    const mag = Math.hypot(rx, ry);
    if (mag > 1) {
      rx /= mag;
      ry /= mag;
    }
    this._raw = new Vec2(rx, ry);

    // The same response curve getStick applies to pad hardware, so `value`
    // and a pad-driven read feel identical for the same gesture.
    this._value = applyRadialDeadzone(rx, ry, this.config.deadZone);

    const t = this.config.threshold;
    const release = t * RELEASE_HYSTERESIS;
    this._digital = {
      left: next(this._digital.left, -this._value.x, t, release),
      right: next(this._digital.right, this._value.x, t, release),
      up: next(this._digital.up, -this._value.y, t, release),
      down: next(this._digital.down, this._value.y, t, release),
    };
  }
}

/** Hysteresis step: engage at `threshold`, stay until below `release`. */
function next(
  engaged: boolean,
  deflection: number,
  threshold: number,
  release: number,
): boolean {
  return engaged ? deflection >= release : deflection >= threshold;
}

function clampToRect(p: Point, rect: ViewportRect): Point {
  return {
    x: MathUtils.clamp(p.x, rect.x, rect.x + rect.width),
    y: MathUtils.clamp(p.y, rect.y, rect.y + rect.height),
  };
}

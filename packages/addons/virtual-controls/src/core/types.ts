/**
 * Headless configuration + geometry types for the virtual-controls model —
 * no renderer, no DOM (the core layer's only engine imports are pixi-free:
 * `Vec2`/`MathUtils` from core and `applyRadialDeadzone` from input, in
 * stick.ts). All lengths are virtual-space pixels; all pointer coordinates
 * are virtual-space (what `PointerInfo.screenPos` reports).
 */

/** A point in virtual-space pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The rectangle of virtual space the controls lay out against — normally the
 * renderer's on-screen (visible) virtual rect, so controls stay reachable
 * under cover/expand fit modes where parts of virtual space are cropped.
 */
export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where a control's CENTER sits, as distances (virtual px) from viewport
 * edges. Exactly one of `left`/`right` and exactly one of `top`/`bottom`
 * must be set. `{ left: 120, bottom: 140 }` reads "center 120px from the
 * left edge, 140px up from the bottom edge".
 */
export interface ControlPlacement {
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly bottom?: number;
}

/**
 * The region of the viewport where a touch may engage a stick, as viewport
 * FRACTIONS (all 0..1, x/y from the top-left). Fractions — not pixels — so
 * one zone works at every resolution and fit mode.
 */
export interface ControlZone {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Auto-cluster corner, keeping the size-derived inset. */
export type ClusterCorner =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

/**
 * - `"fixed"` — the base never moves; a touch must start near it and deflects
 *   the knob immediately (grab radius = 1.5 × radius unless `zone` is set).
 * - `"floating"` — a touch anywhere in the zone re-centers the base under the
 *   finger; the knob deflects as the finger moves. Base returns to its
 *   placement anchor on release.
 * - `"follow"` — floating, plus the base is dragged along when the finger
 *   travels beyond the knob radius (keeps full deflection while the hand
 *   drifts, common in action games).
 */
export type StickMode = "fixed" | "floating" | "follow";

/**
 * Action names the stick mirrors through its `InputActionSource`
 * when its deflection crosses `threshold` on an axis. Each direction is
 * optional — bind only what the game defines. Games that want the analog
 * value read `stick.value`, or `input.getStick(side)` when `axes` is on.
 */
export interface StickActions {
  readonly left?: string;
  readonly right?: string;
  readonly up?: string;
  readonly down?: string;
}

/**
 * Tuple shorthand for {@link StickActions}, fixed left/right/up/down order:
 * `actions: ["left", "right", "up", "down"]`. Skip a direction with `null`
 * (or omit trailing entries).
 */
export type StickActionsTuple = readonly [
  left?: string | null,
  right?: string | null,
  up?: string | null,
  down?: string | null,
];

export interface VirtualStickConfig {
  /**
   * Identity for events, lookups (`model.stick(id)`) and presenter labels.
   * Defaults to `"left"` for the first stick and `"right"` for the second.
   */
  readonly id?: string;
  /** Default `"floating"`. */
  readonly mode?: StickMode;
  /**
   * Resting base center. Default: bottom-left corner for a left-side stick,
   * bottom-right for a right-side one, inset by 1.6 × radius.
   */
  readonly placement?: ControlPlacement;
  /**
   * Knob travel radius (base circle radius), virtual px.
   * Default: 11% of min(viewport width, height).
   */
  readonly radius?: number;
  /**
   * Fraction of full deflection (0..1) treated as zero. Applies to
   * `stick.value` and the digital `actions` mirror ONLY. It does NOT affect
   * `input.getStick()`: the `axes` mirror feeds the pre-dead-zone
   * `rawValue`, and `getStick` applies the InputManager's own stick
   * deadzone (`InputConfig.deadzones.stick`), exactly as it does for
   * physical pad hardware. Default 0.1.
   */
  readonly deadZone?: number;
  /**
   * Digital 4-way mirroring onto the action map — the object form, or the
   * {@link StickActionsTuple} shorthand (`["left", "right", "up", "down"]`).
   */
  readonly actions?: StickActions | StickActionsTuple;
  /**
   * Which side of the screen the defaults lean on: the resting placement
   * corner, the engagement zone half, the `axes` preference, and the default
   * id. Defaults from `axes` when set, else by position (first stick left,
   * others right). Set it to flip a stick without hand-writing `placement`
   * and `zone`.
   */
  readonly side?: "left" | "right";
  /**
   * Deflection (0..1) at which a digital direction actuates. Releases at
   * 0.75 × threshold (hysteresis, so a held diagonal doesn't chatter).
   * Default 0.5.
   */
  readonly threshold?: number;
  /**
   * Mirror the raw deflection onto the synthetic gamepad axes
   * (`InputManager.fireGamepadAxis`), so `input.getStick(side)` reads the
   * virtual stick. A physical pad deflected past its deadzone wins; an
   * idle plugged-in pad does not mask the virtual stick. Defaults to
   * `"left"` for the first stick, `"right"` for the second, `false` for any
   * further stick. Pass `false` to opt out.
   */
  readonly axes?: "left" | "right" | false;
  /**
   * Engagement region override. Default: for `"floating"`/`"follow"`, the
   * bottom 70% of the stick's half of the screen; for `"fixed"`, a circle of
   * 1.5 × radius around the base (no rect at all).
   */
  readonly zone?: ControlZone;
}

export interface VirtualButtonConfig {
  /** Identity for events, lookups and the default label. */
  readonly id: string;
  /**
   * Action to hold through the control's action source while pressed —
   * `isPressed`, and `getHoldDuration` all behave like a physical key.
   * Omit to only observe the button through entity events.
   */
  readonly action?: string;
  /** Presenter label. Default: `id` upper-cased. */
  readonly label?: string;
  /** Explicit center. Default: an auto-arranged cluster (see `cluster`). */
  readonly placement?: ControlPlacement;
  /** Hit + draw radius, virtual px. Default: 6.5% of min(viewport w, h). */
  readonly radius?: number;
  /**
   * Press when an already-down pointer (not owning another control) slides
   * onto the button — the arcade thumb-roll. Default false.
   */
  readonly pressOnEnter?: boolean;
  /** Release when the owning pointer slides off (1.15 × radius). Default true. */
  readonly releaseOnLeave?: boolean;
}

export interface VirtualControlsConfig {
  /** Single-stick sugar for `sticks: [stick]`. Set one or the other. */
  readonly stick?: VirtualStickConfig;
  readonly sticks?: readonly VirtualStickConfig[];
  readonly buttons?: readonly VirtualButtonConfig[];
  /**
   * Anchor of the auto-placed button cluster (buttons without an explicit
   * `placement`). 1 button sits on the anchor; 2 form a diagonal pair; 3 a
   * corner-hugging arc; 4 an A/B/X/Y diamond (bottom/right/left/top, in
   * config order); other counts fan out in a ring. Default: the
   * bottom-right corner with an inset derived from button size and count.
   * A {@link ClusterCorner} keyword (`cluster: "bottom-left"` for a
   * left-handed layout) keeps that derived inset; a {@link ControlPlacement}
   * pins the anchor exactly. Either way the arrangement mirrors toward the
   * anchoring edges, so the primary button hugs its corner.
   */
  readonly cluster?: ControlPlacement | ClusterCorner;
}

/** Stick config with identity/behavior defaults applied (geometry still lazy). */
export interface ResolvedStickConfig {
  readonly id: string;
  readonly mode: StickMode;
  readonly placement: ControlPlacement | undefined;
  readonly radius: number | undefined;
  readonly deadZone: number;
  readonly actions: StickActions;
  readonly threshold: number;
  readonly axes: "left" | "right" | false;
  readonly zone: ControlZone | undefined;
  /** Which side the defaults lean on when `placement`/`zone` are omitted. */
  readonly side: "left" | "right";
}

/** Button config with identity/behavior defaults applied (geometry still lazy). */
export interface ResolvedButtonConfig {
  readonly id: string;
  readonly action: string | undefined;
  readonly label: string;
  readonly placement: ControlPlacement | undefined;
  readonly radius: number | undefined;
  readonly pressOnEnter: boolean;
  readonly releaseOnLeave: boolean;
}

/** Per-stick geometry resolved against a viewport, virtual px. */
export interface StickLayout {
  /** Resting base center. */
  readonly center: Point;
  /** Knob travel radius. */
  readonly radius: number;
  /**
   * Engagement rect, virtual px — absent for default-hit `"fixed"` sticks,
   * which use a grab circle around `center` instead.
   */
  readonly zone: ViewportRect | undefined;
}

/** Per-button geometry resolved against a viewport, virtual px. */
export interface ButtonLayout {
  readonly center: Point;
  readonly radius: number;
}

export interface StickDigitalState {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
}

import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { CameraEntity } from "./CameraEntity.js";

/**
 * What the follow tracks each frame. An `Entity` reads the entity's current
 * `worldPosition`; a `Vec2Like` is a fixed world coord; a function is
 * called every frame and may compute any world coord (e.g. the midpoint
 * of two entities, a position along an animated path).
 */
export type ScreenFollowTarget =
  | Entity
  | Vec2Like
  | (() => Vec2Like);

/** Options for `ScreenFollow`. */
export interface ScreenFollowOptions {
  /** What world coord to track. */
  target: ScreenFollowTarget;

  /**
   * Camera whose `worldToScreen` projection defines the screen mapping.
   * Required — YAGE doesn't have a global "main" camera, so the projection
   * source must be explicit.
   */
  camera: CameraEntity;

  /**
   * Screen-pixel offset added to the projected position. Default `(0, 0)`.
   *
   * Applied *after* projection (`cam.worldToScreen(target) + offset`), not
   * before — so the visual gap between UI and target stays fixed under any
   * camera zoom or rotation. Adding it in world coords before projection
   * would let the camera transform warp the offset.
   */
  offset?: Vec2Like;

  /**
   * When the target is an `Entity`, copy its `worldRotation` onto this
   * entity's Transform each frame. Useful when the UI should rotate with
   * the target itself (e.g. a vehicle UI that tilts with the vehicle) but
   * stay stable against the camera. Default `false` — this entity's
   * rotation is left alone, so a panel on a screen-space layer renders
   * axis-aligned. Ignored when `target` is a Vec2 or a function.
   */
  trackRotation?: boolean;
}

/**
 * Each frame, projects a world source through a camera and writes the
 * resulting screen coord to this entity's `Transform.worldPosition`.
 *
 * The canonical "billboard" primitive: pair with a `UIPanel` (or `UIRoot`)
 * on a screen-space layer using `positioning: "transform"` to produce UI
 * that tracks a target entity but stays axis-aligned and constant-size
 * regardless of camera zoom or rotation — nameplates, health bars,
 * damage numbers, interaction prompts.
 *
 * ```ts
 * class Nameplate extends Entity {
 *   constructor(private readonly target: Entity, private readonly camera: CameraEntity) {
 *     super();
 *   }
 *   setup() {
 *     this.add(new Transform());
 *     this.add(new ScreenFollow({
 *       target: this.target,
 *       camera: this.camera,
 *       offset: new Vec2(0, -40),      // 40 screen px above the target
 *     }));
 *     const panel = this.add(new UIPanel({
 *       positioning: "transform",      // reads Transform.worldPosition
 *       anchor: Anchor.BottomCenter,   // pivot on the panel
 *     }));
 *     panel.text("Grunt-42", { fontSize: 11 });
 *   }
 * }
 * ```
 */
export class ScreenFollow extends Component {
  private readonly _target: ScreenFollowTarget;
  private readonly _camera: CameraEntity;
  private readonly _offset: Vec2;
  private readonly _trackRotation: boolean;

  constructor(opts: ScreenFollowOptions) {
    super();
    this._target = opts.target;
    this._camera = opts.camera;
    this._offset = opts.offset
      ? new Vec2(opts.offset.x, opts.offset.y)
      : Vec2.ZERO;
    this._trackRotation = opts.trackRotation ?? false;
  }

  override update(): void {
    const world = this.resolveTargetPosition();
    if (!world) return;

    // Project the target alone, then add the offset in screen coords.
    // Adding it in world coords would let camera zoom/rotation warp the
    // offset — a 40px offset would become 80px at zoom 2 and would rotate
    // off-axis as the camera rotates. Screen-space addition keeps the
    // visual gap between UI and target fixed under any camera transform.
    const projected = this._camera.worldToScreen(world.x, world.y);
    const t = this.entity.get(Transform);
    t.worldPosition = new Vec2(
      projected.x + this._offset.x,
      projected.y + this._offset.y,
    );

    if (this._trackRotation && this._target instanceof Entity) {
      const targetTransform = this._target.tryGet(Transform);
      if (targetTransform) t.worldRotation = targetTransform.worldRotation;
    }
  }

  private resolveTargetPosition(): Vec2Like | undefined {
    const target = this._target;
    if (typeof target === "function") return target();
    if (target instanceof Entity) {
      const t = target.tryGet(Transform);
      return t ? t.worldPosition : undefined;
    }
    return target;
  }
}

import {
  Component,
  Entity,
  Transform,
  Vec2,
  serializable,
} from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import type { SnapshotResolver } from "@yagejs/core";
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

export interface ScreenFollowData {
  target:
    | { kind: "entity"; entityId: number }
    | { kind: "point"; position: { x: number; y: number } };
  cameraEntityId: number;
  offset: { x: number; y: number };
  trackRotation: boolean;
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
@serializable
export class ScreenFollow extends Component {
  private _target: ScreenFollowTarget | null;
  private _camera: CameraEntity | null;
  private _offset: Vec2;
  private _trackRotation: boolean;
  private _restoreTargetEntityId: number | null = null;
  private _restoreCameraEntityId: number | null = null;

  constructor(opts?: ScreenFollowOptions) {
    super();
    this._target = opts?.target ?? null;
    this._camera = opts?.camera ?? null;
    this._offset = opts?.offset
      ? new Vec2(opts.offset.x, opts.offset.y)
      : Vec2.ZERO;
    this._trackRotation = opts?.trackRotation ?? false;
  }

  override update(): void {
    if (!this._camera || this._target === null) return;
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
    if (target === null) return undefined;
    if (typeof target === "function") return target();
    if (target instanceof Entity) {
      const t = target.tryGet(Transform);
      return t ? t.worldPosition : undefined;
    }
    return target;
  }

  serialize(): ScreenFollowData | null {
    if (!this._camera) return null;
    if (this._target === null) return null;
    if (typeof this._target === "function") return null;

    const data: ScreenFollowData = {
      target:
        this._target instanceof Entity
          ? { kind: "entity", entityId: this._target.id }
          : {
              kind: "point",
              position: { x: this._target.x, y: this._target.y },
            },
      cameraEntityId: this._camera.id,
      offset: { x: this._offset.x, y: this._offset.y },
      trackRotation: this._trackRotation,
    };
    return data;
  }

  static fromSnapshot(data: ScreenFollowData): ScreenFollow {
    const follow = new ScreenFollow();
    follow._offset = new Vec2(data.offset.x, data.offset.y);
    follow._trackRotation = data.trackRotation;
    if (data.target.kind === "point") {
      follow._target = new Vec2(data.target.position.x, data.target.position.y);
    } else {
      follow._restoreTargetEntityId = data.target.entityId;
    }
    follow._restoreCameraEntityId = data.cameraEntityId;
    return follow;
  }

  afterRestore(_data: unknown, resolve: SnapshotResolver): void {
    if (this._restoreTargetEntityId !== null) {
      const target = resolve.entity(this._restoreTargetEntityId);
      if (target) {
        this._target = target;
      } else {
        // Leave _target null so update() short-circuits — without this, a
        // ScreenFollow whose target failed to resolve would track world
        // origin (the previous Vec2.ZERO default).
        this._target = null;
        console.warn(
          `ScreenFollow.afterRestore: cannot resolve target entity ${this._restoreTargetEntityId}; follow target lost.`,
        );
      }
      this._restoreTargetEntityId = null;
    }

    if (this._restoreCameraEntityId !== null) {
      const camera = resolve.entity(this._restoreCameraEntityId);
      if (camera) {
        this._camera = camera as CameraEntity;
      } else {
        this._camera = null;
        console.warn(
          `ScreenFollow.afterRestore: cannot resolve camera entity ${this._restoreCameraEntityId}; ScreenFollow will be inert.`,
        );
      }
      this._restoreCameraEntityId = null;
    }
  }
}

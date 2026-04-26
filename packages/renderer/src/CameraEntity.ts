import { Entity, Vec2, serializable } from "@yagejs/core";
import type { Vec2Like, EasingFunction } from "@yagejs/core";
import { CameraComponent } from "./CameraComponent.js";
import type {
  CameraBounds,
  CameraBinding,
  CameraComponentOptions,
  CameraFollowOptions,
  CameraShakeOptions,
} from "./CameraComponent.js";
import { CameraFollow } from "./CameraFollow.js";
import { CameraShake } from "./CameraShake.js";
import { CameraBoundsComponent } from "./CameraBoundsComponent.js";
import { CameraZoom } from "./CameraZoom.js";

export type { CameraBinding } from "./CameraComponent.js";

export interface CameraEntityParams {
  /** Initial position. */
  position?: Vec2;
  /** Follow target — any object with a `position: Vec2Like` property (e.g. Transform). */
  follow?: { position: Vec2Like };
  /** Follow smoothing factor 0..1. Default: 1 (instant). */
  smoothing?: number;
  /** Follow offset. */
  offset?: Vec2Like;
  /** Follow deadzone. */
  deadzone?: { halfWidth: number; halfHeight: number };
  /** Camera bounds for position clamping. */
  bounds?: CameraBounds;
  /** Initial zoom level. Default: 1. */
  zoom?: number;
  /** Per-layer bindings. Omit to auto-bind all layers. */
  bindings?: CameraBinding[];
  /** Camera priority (lower = processed first). Default: 0. */
  priority?: number;
  /** Camera name (for multi-camera lookup). */
  name?: string;
}

/**
 * Camera entity. Spawn in a scene to enable camera-based layer transforms.
 *
 * ```ts
 * const cam = this.spawn(CameraEntity, {
 *   follow: player.get(Transform),
 *   smoothing: 0.15,
 *   bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
 * });
 *
 * // All camera operations are available directly on the entity:
 * cam.shake(8, 300);
 * cam.zoomTo(1.5, 1000);
 * cam.follow(otherTarget, { smoothing: 0.1 });
 * ```
 */
@serializable
export class CameraEntity extends Entity {
  private cam!: CameraComponent;

  setup(params: CameraEntityParams = {}): void {
    const camOpts: CameraComponentOptions = {};
    if (params.position !== undefined) camOpts.position = params.position;
    if (params.zoom !== undefined) camOpts.zoom = params.zoom;
    if (params.bindings !== undefined) camOpts.bindings = params.bindings;
    if (params.priority !== undefined) camOpts.priority = params.priority;
    if (params.name !== undefined) camOpts.name = params.name;
    this.cam = this.add(new CameraComponent(camOpts));

    const followComp = this.add(new CameraFollow());
    this.add(new CameraBoundsComponent());
    this.add(new CameraShake());
    this.add(new CameraZoom());

    if (params.follow) {
      const followOpts: CameraFollowOptions = {};
      if (params.smoothing !== undefined) followOpts.smoothing = params.smoothing;
      if (params.offset !== undefined) followOpts.offset = params.offset;
      if (params.deadzone !== undefined) followOpts.deadzone = params.deadzone;
      followComp.start(params.follow, followOpts);
    }

    if (params.bounds) {
      this.cam.bounds = params.bounds;
    }
  }

  // ---------------------------------------------------------------------------
  // Property delegates
  // ---------------------------------------------------------------------------

  get position(): Vec2 {
    return this.cam.position;
  }

  set position(value: Vec2) {
    this.cam.position = value;
  }

  get zoom(): number {
    return this.cam.zoom;
  }

  set zoom(value: number) {
    this.cam.zoom = value;
  }

  get rotation(): number {
    return this.cam.rotation;
  }

  set rotation(value: number) {
    this.cam.rotation = value;
  }

  get bounds(): CameraBounds | undefined {
    return this.cam.bounds;
  }

  set bounds(value: CameraBounds | undefined) {
    this.cam.bounds = value;
  }

  get effectivePosition(): Vec2 {
    return this.cam.effectivePosition;
  }

  // ---------------------------------------------------------------------------
  // Method delegates
  // ---------------------------------------------------------------------------

  follow(target: { position: Vec2Like }, options?: CameraFollowOptions): void {
    this.cam.follow(target, options);
  }

  unfollow(): void {
    this.cam.unfollow();
  }

  shake(
    intensity: number,
    duration: number,
    options?: CameraShakeOptions,
  ): void {
    this.cam.shake(intensity, duration, options);
  }

  zoomTo(target: number, duration: number, easing?: EasingFunction): void {
    this.cam.zoomTo(target, duration, easing);
  }

  screenToWorld(screenX: number, screenY: number): Vec2 {
    return this.cam.screenToWorld(screenX, screenY);
  }

  worldToScreen(worldX: number, worldY: number): Vec2 {
    return this.cam.worldToScreen(worldX, worldY);
  }
}

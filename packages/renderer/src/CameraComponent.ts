import { Component, Vec2, serializable } from "@yagejs/core";
import type { Vec2Like, EasingFunction } from "@yagejs/core";
import { RendererKey } from "./types.js";
import type { SceneRenderTree } from "./SceneRenderTree.js";
import { CameraFollow } from "./CameraFollow.js";
import { CameraShake } from "./CameraShake.js";
import { CameraZoom } from "./CameraZoom.js";
import { CameraBoundsComponent } from "./CameraBoundsComponent.js";

/** Bounding rectangle for camera clamping. */
export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Options for camera follow behavior. */
export interface CameraFollowOptions {
  /** Smoothing factor 0..1. 1 = instant snap, lower = smoother. Default: 1. */
  smoothing?: number;
  /** Offset from the target position. */
  offset?: Vec2Like;
  /** Deadzone rectangle (half-width, half-height). Camera won't move when target is inside. */
  deadzone?: { halfWidth: number; halfHeight: number };
}

/** Options for camera shake. */
export interface CameraShakeOptions {
  /** Decay factor per frame (0..1). 0 = no decay, 1 = instant stop. Default: 0. */
  decay?: number;
}

/**
 * Binding that associates a camera with a named render layer.
 *
 * Each ratio is a linear blend from identity (`0`) to full camera effect
 * (`1`), applied independently per axis. Defaults are all `1`, giving the
 * classic "this layer follows the camera" behavior.
 *
 * Common recipes:
 * - Parallax: `translateRatio: 0.5` (half the camera's translation).
 * - Billboard (upright, constant size, follows position): `rotateRatio: 0`, `scaleRatio: 0`.
 * - Partial-depth billboard (dampened zoom, still upright): `rotateRatio: 0, scaleRatio: 0.3`.
 */
export interface CameraBinding {
  /** Layer name to transform. */
  layer: string;
  /** Translation follow factor. `0` = stay at world origin, `1` = full. Default: `1`. */
  translateRatio?: number;
  /** Rotation follow factor. `0` = stay upright, `1` = full camera rotation. Default: `1`. */
  rotateRatio?: number;
  /** Zoom follow factor. `0` = constant size, `1` = full camera zoom. Default: `1`. */
  scaleRatio?: number;
}

export interface CameraComponentOptions {
  position?: Vec2;
  zoom?: number;
  rotation?: number;
  bindings?: CameraBinding[];
  priority?: number;
  name?: string;
}

export interface CameraComponentData {
  position: { x: number; y: number };
  zoom: number;
  rotation: number;
  bindings: CameraBinding[] | null;
  priority: number;
  name?: string;
}

/** Frame-rate-independent reference timestep (ms). */
export const CAMERA_REFERENCE_DT = 16.67;

/**
 * Core camera state component. Added by `CameraEntity`; holds position,
 * zoom, rotation, and layer bindings. Provides convenience methods that
 * delegate to sibling behavior components (CameraFollow, CameraShake, etc.).
 *
 * Added by `CameraEntity`; access via direct reference from `spawn()`
 * or by querying entities with this component.
 */
@serializable
export class CameraComponent extends Component {
  position: Vec2;
  zoom: number;
  rotation: number;

  readonly bindings: CameraBinding[] | null;
  readonly priority: number;
  readonly cameraName: string | undefined;

  constructor(options?: CameraComponentOptions) {
    super();
    this.position = options?.position ?? Vec2.ZERO;
    this.zoom = options?.zoom ?? 1;
    this.rotation = options?.rotation ?? 0;
    this.bindings = options?.bindings ?? null;
    this.priority = options?.priority ?? 0;
    this.cameraName = options?.name;
  }

  get viewportWidth(): number {
    return this.use(RendererKey).virtualSize.width;
  }

  get viewportHeight(): number {
    return this.use(RendererKey).virtualSize.height;
  }

  /** Effective position including shake offset. */
  get effectivePosition(): Vec2 {
    const shake = this.entity.tryGet(CameraShake);
    return this.position.add(shake?.offset ?? Vec2.ZERO);
  }

  /** Start following a target. */
  follow(target: { position: Vec2Like }, options?: CameraFollowOptions): void {
    this.entity.get(CameraFollow).start(target, options);
  }

  /** Stop following any target. */
  unfollow(): void {
    this.entity.get(CameraFollow).stop();
  }

  /** Start a screen shake effect. */
  shake(
    intensity: number,
    duration: number,
    options?: CameraShakeOptions,
  ): void {
    this.entity.get(CameraShake).start(intensity, duration, options);
  }

  /** Animate zoom to a target value over a duration. */
  zoomTo(target: number, duration: number, easing?: EasingFunction): void {
    this.entity.get(CameraZoom).start(target, duration, easing);
  }

  /** Get or set camera bounds. */
  get bounds(): CameraBounds | undefined {
    return this.entity.get(CameraBoundsComponent).bounds;
  }

  set bounds(value: CameraBounds | undefined) {
    this.entity.get(CameraBoundsComponent).bounds = value;
  }

  /** Convert screen coordinates to world coordinates. */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    const pos = this.effectivePosition;
    const offset = new Vec2(
      screenX - this.viewportWidth / 2,
      screenY - this.viewportHeight / 2,
    )
      .scale(1 / this.zoom)
      .rotate(this.rotation);
    return pos.add(offset);
  }

  /** Convert world coordinates to screen coordinates. */
  worldToScreen(worldX: number, worldY: number): Vec2 {
    const pos = this.effectivePosition;
    const offset = new Vec2(worldX - pos.x, worldY - pos.y)
      .rotate(-this.rotation)
      .scale(this.zoom);
    return new Vec2(
      offset.x + this.viewportWidth / 2,
      offset.y + this.viewportHeight / 2,
    );
  }

  /**
   * Resolve bindings for this camera against the given render tree.
   *
   * If no explicit `bindings` were passed, auto-binds every world-space
   * layer (`LayerDef.space === "world"`, the default). Screen-space layers
   * — declared with `space: "screen"` or auto-provisioned by plugins via
   * `ensureLayer(def, { space: "screen" })`, e.g. the UI layer — are
   * skipped so they stay fixed to the viewport. Cameras can still
   * explicitly bind a screen-space layer by naming it in `bindings`.
   */
  getResolvedBindings(tree: SceneRenderTree): readonly CameraBinding[] {
    if (this.bindings) return this.bindings;
    return tree
      .getAll()
      .filter((layer) => layer.space === "world")
      .map((layer) => ({ layer: layer.name, translateRatio: 1 }));
  }

  serialize(): CameraComponentData {
    const data: CameraComponentData = {
      position: { x: this.position.x, y: this.position.y },
      zoom: this.zoom,
      rotation: this.rotation,
      bindings: this.bindings
        ? this.bindings.map((binding) => ({ ...binding }))
        : null,
      priority: this.priority,
    };
    if (this.cameraName !== undefined) data.name = this.cameraName;
    return data;
  }

  static fromSnapshot(data: CameraComponentData): CameraComponent {
    const options: CameraComponentOptions = {
      position: new Vec2(data.position.x, data.position.y),
      zoom: data.zoom,
      rotation: data.rotation,
      priority: data.priority,
    };
    if (data.bindings) {
      options.bindings = data.bindings.map((binding) => ({ ...binding }));
    }
    if (data.name !== undefined) options.name = data.name;
    return new CameraComponent(options);
  }
}

import { Component, Vec2, Vec2Buffer } from "@yagejs/core";
import type { Vec2Like, EasingFunction } from "@yagejs/core";
import { RendererKey } from "./types.js";
import type { SceneRenderTree } from "./SceneRenderTree.js";
import { CameraFollow } from "./CameraFollow.js";
import type { FollowTarget } from "./FollowTarget.js";
import { CameraShake } from "./CameraShake.js";
import { CameraZoom } from "./CameraZoom.js";
import { CameraBoundsComponent } from "./CameraBoundsComponent.js";
import { CameraModifierHost } from "./CameraModifiers.js";

/** Bounding rectangle for camera clamping. */
export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Options for camera follow behavior. */
export interface CameraFollowOptions {
  /**
   * Smoothing factor 0..1. `1` = instant snap, lower = smoother. `0` never
   * moves the camera at all, so the follow appears frozen. Default: `1`.
   */
  smoothing?: number;
  /** Offset from the target position, in world pixels. */
  offset?: Vec2Like;
  /**
   * Deadzone rectangle in world pixels (half-width, half-height). The camera
   * stays put while the target is inside it.
   */
  deadzone?: { halfWidth: number; halfHeight: number };
  /**
   * Place the camera on the target as following starts, instead of easing in
   * from wherever the camera currently is. Default: false.
   */
  snap?: boolean;
}

/** Options for camera shake. */
export interface CameraShakeOptions {
  /**
   * How much the shake fades across its duration. `0` (the default) holds
   * full intensity until the shake ends. `1` fades linearly to zero over the
   * duration. Values above `1` reach zero earlier — at `2` the camera stops
   * moving halfway through.
   */
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
 * - Dampened zoom, still upright: `rotateRatio: 0, scaleRatio: 0.3`.
 *
 * A ratio below `1` scales the layer by less than the camera does while the
 * layer still translates by the full camera offset, so content drifts away
 * from the world position it should sit on as the zoom leaves `1`. For UI
 * that must track a world point at constant size, use `ScreenFollow`, which
 * projects the point through the camera every frame.
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

/** Frame-rate-independent reference timestep (seconds). */
export const CAMERA_REFERENCE_DT = 1 / 60;

/**
 * Core camera state component. Added by `CameraEntity`; holds position,
 * zoom, rotation, and layer bindings. Provides convenience methods that
 * delegate to sibling behavior components (CameraFollow, CameraShake, etc.).
 *
 * Added by `CameraEntity`; access via direct reference from `spawn()`
 * or by querying entities with this component.
 */
export class CameraComponent extends Component {
  private readonly projectionScratch = new Vec2Buffer();
  position: Vec2;
  zoom: number;
  rotation: number;
  /** Transient position, rotation, and zoom contributions. */
  readonly modifiers = new CameraModifierHost();

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

  /** Effective position including every active camera modifier. */
  get effectivePosition(): Vec2 {
    const position = this.getEffectivePositionInto(this.projectionScratch);
    return new Vec2(position.x, position.y);
  }

  /** Copy the position including active modifiers into caller-owned scratch. */
  getEffectivePositionInto(out: Vec2Buffer): Vec2Buffer {
    return Vec2.addInto(out, this.position, this.modifiers.positionOffset);
  }

  /** Effective rotation including every active camera modifier. */
  get effectiveRotation(): number {
    return this.rotation + this.modifiers.rotationOffset;
  }

  /** Effective zoom including every active camera modifier. */
  get effectiveZoom(): number {
    return this.zoom * this.modifiers.zoomFactor;
  }

  /** Start following a target. */
  follow(target: FollowTarget, options?: CameraFollowOptions): void {
    this.entity.get(CameraFollow).start(target, options);
  }

  /** Stop following any target. */
  unfollow(): void {
    this.entity.get(CameraFollow).stop();
  }

  /** Cut to the current follow target, skipping the smoothing ease. */
  snapToTarget(): void {
    this.entity.get(CameraFollow).snapToTarget();
  }

  /**
   * Start a screen shake effect. `intensity` is the maximum displacement per
   * axis in **world pixels**, so what the player sees scales with zoom — the
   * same intensity moves twice as far on screen at zoom 2.
   */
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

  /**
   * Convert screen coordinates to world coordinates.
   *
   * The conversion uses the camera's own transform, not any layer's. A layer
   * bound with a ratio below `1` (parallax, dampened zoom) renders under a
   * different transform, so this result does not name a point on that layer.
   *
   * The result is undefined for a zoom of `0` or a non-finite camera value.
   */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    const position = this.screenToWorldInto(
      this.projectionScratch,
      screenX,
      screenY,
    );
    return new Vec2(position.x, position.y);
  }

  /** Copy a screen-to-world projection into caller-owned scratch. */
  screenToWorldInto(
    out: Vec2Buffer,
    screenX: number,
    screenY: number,
  ): Vec2Buffer {
    this.getEffectivePositionInto(out);
    const zoom = this.effectiveZoom;
    const rotation = this.effectiveRotation;
    const x = (screenX - this.viewportWidth / 2) * (1 / zoom);
    const y = (screenY - this.viewportHeight / 2) * (1 / zoom);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return out.set(out.x + (x * cos - y * sin), out.y + (x * sin + y * cos));
  }

  /**
   * Convert world coordinates to screen coordinates.
   *
   * The conversion uses the camera's own transform, not any layer's. Content
   * on a layer bound with a ratio below `1` (parallax, dampened zoom) is
   * drawn somewhere else on screen than this result says.
   */
  worldToScreen(worldX: number, worldY: number): Vec2 {
    const position = this.worldToScreenInto(
      this.projectionScratch,
      worldX,
      worldY,
    );
    return new Vec2(position.x, position.y);
  }

  /** Copy a world-to-screen projection into caller-owned scratch. */
  worldToScreenInto(
    out: Vec2Buffer,
    worldX: number,
    worldY: number,
  ): Vec2Buffer {
    this.getEffectivePositionInto(out);
    const zoom = this.effectiveZoom;
    const rotation = this.effectiveRotation;
    const x = worldX - out.x;
    const y = worldY - out.y;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    return out.set(
      (x * cos - y * sin) * zoom + this.viewportWidth / 2,
      (x * sin + y * cos) * zoom + this.viewportHeight / 2,
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
  onDestroy(): void {
    this.modifiers._destroy();
  }
}

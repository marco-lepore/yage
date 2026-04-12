import { Vec2 } from "@yagejs/core";
import type { EasingFunction, Vec2Like } from "@yagejs/core";

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

/** Frame-rate-independent reference timestep (ms). */
const REFERENCE_DT = 16.67;

/**
 * 2D camera with follow, shake, zoom, and coordinate conversion.
 * Pure math — no PixiJS dependency.
 */
export class Camera {
  position: Vec2 = Vec2.ZERO;
  zoom = 1;
  rotation = 0;
  bounds?: CameraBounds;

  readonly viewportWidth: number;
  readonly viewportHeight: number;

  // Follow state
  private followTarget: { position: Vec2Like } | null = null;
  private followSmoothing = 1;
  private followOffset: Vec2 = Vec2.ZERO;
  private followDeadzone: { halfWidth: number; halfHeight: number } | null = null;

  // Shake state
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeElapsed = 0;
  private shakeDecay = 0;
  private shakeOffset: Vec2 = Vec2.ZERO;

  // Zoom-to state
  private zoomFrom = 1;
  private zoomTarget = 1;
  private zoomDuration = 0;
  private zoomElapsed = 0;
  private zoomEasing: EasingFunction = (t) => t;
  private zooming = false;

  constructor(viewportWidth: number, viewportHeight: number) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
  }

  /** Start following a target. */
  follow(
    target: { position: Vec2Like },
    options?: CameraFollowOptions,
  ): void {
    this.followTarget = target;
    this.followSmoothing = options?.smoothing ?? 1;
    this.followOffset = options?.offset
      ? new Vec2(options.offset.x, options.offset.y)
      : Vec2.ZERO;
    this.followDeadzone = options?.deadzone ?? null;
  }

  /** Stop following any target. */
  unfollow(): void {
    this.followTarget = null;
    this.followDeadzone = null;
  }

  /** Start a screen shake effect. */
  shake(
    intensity: number,
    duration: number,
    options?: CameraShakeOptions,
  ): void {
    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeElapsed = 0;
    this.shakeDecay = options?.decay ?? 0;
    this.shakeOffset = Vec2.ZERO;
  }

  /** Animate zoom to a target value over a duration. */
  zoomTo(
    target: number,
    duration: number,
    easing?: EasingFunction,
  ): void {
    this.zoomFrom = this.zoom;
    this.zoomTarget = target;
    this.zoomDuration = duration;
    this.zoomElapsed = 0;
    this.zoomEasing = easing ?? ((t) => t);
    this.zooming = true;
  }

  /** Convert screen coordinates to world coordinates (accounts for shake). */
  screenToWorld(screenX: number, screenY: number): Vec2 {
    const pos = this.effectivePosition;
    const wx = (screenX - this.viewportWidth / 2) / this.zoom + pos.x;
    const wy = (screenY - this.viewportHeight / 2) / this.zoom + pos.y;
    return new Vec2(wx, wy);
  }

  /** Convert world coordinates to screen coordinates (accounts for shake). */
  worldToScreen(worldX: number, worldY: number): Vec2 {
    const pos = this.effectivePosition;
    const sx = (worldX - pos.x) * this.zoom + this.viewportWidth / 2;
    const sy = (worldY - pos.y) * this.zoom + this.viewportHeight / 2;
    return new Vec2(sx, sy);
  }

  /** Effective position including shake offset. */
  get effectivePosition(): Vec2 {
    return this.position.add(this.shakeOffset);
  }

  /** Advance camera state by dt milliseconds. */
  update(dt: number): void {
    this.updateFollow(dt);
    this.updateShake(dt);
    this.updateZoom(dt);
    this.clampToBounds();
  }

  private updateFollow(dt: number): void {
    if (!this.followTarget) return;

    const pos = this.followTarget.position;
    const targetPos = new Vec2(
      pos.x + this.followOffset.x,
      pos.y + this.followOffset.y,
    );

    if (this.followDeadzone) {
      const dx = targetPos.x - this.position.x;
      const dy = targetPos.y - this.position.y;
      const hw = this.followDeadzone.halfWidth;
      const hh = this.followDeadzone.halfHeight;

      let moveX = 0;
      let moveY = 0;

      if (dx > hw) moveX = dx - hw;
      else if (dx < -hw) moveX = dx + hw;

      if (dy > hh) moveY = dy - hh;
      else if (dy < -hh) moveY = dy + hh;

      if (moveX === 0 && moveY === 0) return;

      const destination = new Vec2(
        this.position.x + moveX,
        this.position.y + moveY,
      );
      const t = this.frameLerp(this.followSmoothing, dt);
      this.position = this.position.lerp(destination, t);
    } else {
      const t = this.frameLerp(this.followSmoothing, dt);
      this.position = this.position.lerp(targetPos, t);
    }
  }

  private updateShake(dt: number): void {
    if (this.shakeDuration <= 0) return;

    this.shakeElapsed += dt;
    if (this.shakeElapsed >= this.shakeDuration) {
      this.shakeOffset = Vec2.ZERO;
      this.shakeDuration = 0;
      this.shakeElapsed = 0;
      this.shakeIntensity = 0;
      return;
    }

    // Apply decay
    let currentIntensity = this.shakeIntensity;
    if (this.shakeDecay > 0) {
      const progress = this.shakeElapsed / this.shakeDuration;
      currentIntensity = this.shakeIntensity * (1 - progress * this.shakeDecay);
    }

    // Deterministic-ish shake using sin for reproducible tests
    const phase = this.shakeElapsed * 0.1;
    this.shakeOffset = new Vec2(
      Math.sin(phase * 7.3) * currentIntensity,
      Math.cos(phase * 13.7) * currentIntensity,
    );
  }

  private updateZoom(dt: number): void {
    if (!this.zooming) return;

    this.zoomElapsed += dt;
    if (this.zoomElapsed >= this.zoomDuration) {
      this.zoom = this.zoomTarget;
      this.zooming = false;
      return;
    }

    const rawT = this.zoomElapsed / this.zoomDuration;
    const easedT = this.zoomEasing(rawT);
    this.zoom = this.zoomFrom + (this.zoomTarget - this.zoomFrom) * easedT;
  }

  private clampToBounds(): void {
    if (!this.bounds) return;

    const halfViewW = this.viewportWidth / (2 * this.zoom);
    const halfViewH = this.viewportHeight / (2 * this.zoom);

    const minCamX = this.bounds.minX + halfViewW;
    const maxCamX = this.bounds.maxX - halfViewW;
    const minCamY = this.bounds.minY + halfViewH;
    const maxCamY = this.bounds.maxY - halfViewH;

    const clampedX = Math.max(minCamX, Math.min(maxCamX, this.position.x));
    const clampedY = Math.max(minCamY, Math.min(maxCamY, this.position.y));
    this.position = new Vec2(clampedX, clampedY);
  }

  /** Frame-rate-independent lerp factor. */
  private frameLerp(smoothing: number, dt: number): number {
    if (smoothing >= 1) return 1;
    return 1 - Math.pow(1 - smoothing, dt / REFERENCE_DT);
  }
}

import { ServiceKey } from "@yagejs/core";
import type { Entity, Vec2Like } from "@yagejs/core";

/**
 * Minimal subset of PixiJS Graphics used by debug drawing.
 * Avoids a runtime pixi.js dependency in the ./api subpath.
 */
export interface DebugGraphics {
  position: { x: number; y: number };
  rotation: number;
  visible: boolean;
  clear(): DebugGraphics;
  rect(x: number, y: number, width: number, height: number): DebugGraphics;
  roundRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): DebugGraphics;
  circle(x: number, y: number, radius: number): DebugGraphics;
  moveTo(x: number, y: number): DebugGraphics;
  lineTo(x: number, y: number): DebugGraphics;
  stroke(style: { width: number; color: number; alpha?: number }): DebugGraphics;
  fill(style: { color: number; alpha?: number }): DebugGraphics;
}

/** Camera-space drawing API passed to contributors. */
export interface WorldDebugApi {
  acquireGraphics(): DebugGraphics | undefined;
  isFlagEnabled(flag: string): boolean;
  readonly cameraZoom: number;
}

/** Screen-space HUD API passed to contributors. */
export interface HudDebugApi {
  addLine(text: string): void;
  isFlagEnabled(flag: string): boolean;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

/** Rolling-window statistics collector. */
export interface StatsApi {
  push(key: string, value: number): void;
  average(key: string): number;
  latest(key: string): number;
  min(key: string): number;
  max(key: string): number;
}

/** A debug contributor that registers drawing/sampling callbacks. */
export interface DebugContributor {
  readonly name: string;
  readonly flags: readonly string[];
  drawWorld?(api: WorldDebugApi): void;
  drawHud?(api: HudDebugApi): void;
  sample?(stats: StatsApi, dt: number): void;
  dispose?(): void;
}

/**
 * Supplies the vector to draw this frame, in the entity's world space. Return
 * `null` or `undefined` to draw nothing this frame.
 */
export type DebugVectorProvider = () => Vec2Like | null | undefined;

/** Appearance and cutoff options for {@link DebugRegistry.drawVector}. */
export interface DebugVectorOptions {
  /** Pixels of arrow per unit of the vector. Default 1. */
  scale?: number;
  /** Arrow color. Default `0xffffff`. */
  color?: number;
  /** Arrow opacity, 0-1. Default 0.9. */
  alpha?: number;
  /**
   * World-space pixel offset added to the entity's position, so the arrow can
   * start at a muzzle or a hand instead of the entity's origin. Not rotated by
   * the entity. Default `{ x: 0, y: 0 }`.
   */
  origin?: Vec2Like;
  /**
   * Draw nothing while the vector is shorter than this. Measured on the value
   * the provider returns, before `scale` is applied, so the cutoff is in the
   * vector's own units (px/s for a velocity). Default 0 — a zero-length vector
   * never draws either way, since it has no direction. */
  minLength?: number;
  /** Shaft thickness in screen pixels, held constant across camera zoom. Default 2. */
  width?: number;
  /** Arrowhead length in screen pixels, held constant across camera zoom. Default 8. */
  headSize?: number;
}

/** Service interface for the debug registry. */
export interface DebugRegistry {
  register(contributor: DebugContributor): void;
  isEnabled(): boolean;
  isFlagEnabled(contributorName: string, flag: string): boolean;
  /**
   * Draw an arrow on `entity` for a vector that is read fresh every frame —
   * velocity, aim direction, knockback, steering output.
   *
   * ```ts
   * const debug = this.use(DebugRegistryKey);
   * this.stopArrow = debug.drawVector(this.entity, () => agent.velocity, {
   *   scale: 0.35,
   *   color: 0x4ade80,
   *   minLength: 1,
   * });
   * ```
   *
   * The arrow starts at the entity's world position (plus `options.origin`)
   * and points along the vector. Nothing is retained but the provider itself:
   * it is called once per frame while the overlay is on and the `vectors`
   * contributor's `arrows` flag is enabled, and not at all otherwise — a
   * `drawVector` call in a hot path costs nothing while debug is off.
   *
   * Returns a disposer that stops the drawing. Calling it twice is harmless.
   * The registration is also dropped when `entity` is destroyed, so a provider
   * closure never outlives the entity it draws for.
   */
  drawVector(
    entity: Entity,
    vector: DebugVectorProvider,
    options?: DebugVectorOptions,
  ): () => void;
}

/** Service key for resolving the DebugRegistry via DI. */
export const DebugRegistryKey = new ServiceKey<DebugRegistry>("debugRegistry");

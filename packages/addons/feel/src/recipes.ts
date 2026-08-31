import type { EasingFunction, Vec2Like } from "@yagejs/core";
import { axisBlur, implosion, zoomBlur } from "@yagejs/effects";
import type { AxisBlurOptions } from "@yagejs/effects";
import type { EffectsHost, VisualComponent } from "@yagejs/renderer";
import { feelParallel } from "./core/node.js";
import type { FeelNode } from "./core/types.js";
import { feelEffect, feelGlow, feelHitFlash } from "./adapters/renderer.js";
import type { FeelGlowOptions } from "./adapters/renderer.js";
import {
  feelPositionSpring,
  feelScalePunch,
  feelScaleSpring,
  feelSquash,
  feelTransformShake,
} from "./adapters/visual.js";
import { feelDamageNumber, feelImpactRing } from "./adapters/transient.js";
import type {
  FeelDamageNumberOptions,
  FeelImpactRingOptions,
} from "./adapters/transient.js";
import { feelFlightLines } from "./adapters/trails.js";
import type { FeelFlightLinesOptions } from "./adapters/trails.js";

export interface ImpactOptions {
  /** Visual that flashes, scales, and shakes. */
  target: VisualComponent;
  /** World position for the impact ring. Defaults to the cue entity. */
  position?: FeelImpactRingOptions["position"];
  /** Flash and impact-ring color. Default: `0xffffff`. */
  color?: number;
  /** Total recipe duration in seconds. Default: `0.3`. */
  duration?: number;
  /** Peak scale factor. Default: `1.16`. */
  scale?: number;
  /** Shake amplitude in pixels. Default: `4`. */
  shake?: number;
  /** Initial impact-ring radius in pixels. Default: `20`. */
  ringRadius?: number;
  /** Final impact-ring scale. Default: `2`. */
  ringExpand?: number;
}

/** Flash, punch, shake, and mark one visual impact. */
export function impact(options: ImpactOptions): FeelNode {
  const duration = positiveDuration("impact", options.duration ?? 0.3);
  const color = options.color ?? 0xffffff;
  return feelParallel(
    feelHitFlash(options.target.fx, {
      color,
      duration: Math.min(duration, 0.12),
    }),
    feelScalePunch({
      target: options.target,
      scale: options.scale ?? 1.16,
      duration: Math.min(duration, 0.18),
    }),
    feelTransformShake({
      target: options.target,
      amplitude: options.shake ?? 4,
      duration: Math.min(duration, 0.18),
    }),
    feelImpactRing({
      ...(options.position === undefined ? {} : { position: options.position }),
      color,
      radius: options.ringRadius ?? 20,
      expand: options.ringExpand ?? 2,
      duration,
    }),
  );
}

export interface DamageImpactOptions {
  /** Visual that receives the impact response. */
  target: VisualComponent;
  /** Damage value displayed above the impact. */
  value: FeelDamageNumberOptions["value"];
  /** World position for the impact ring and damage number. */
  position?: FeelDamageNumberOptions["position"];
  /** Whether to use the critical-hit number style. */
  critical?: FeelDamageNumberOptions["critical"];
  /** Options for the impact part of the recipe. */
  impact?: Omit<ImpactOptions, "target" | "position">;
  /** Options for the damage-number part of the recipe. */
  number?: Omit<FeelDamageNumberOptions, "value" | "position" | "critical">;
}

/** Pair the standard impact response with a floating damage number. */
export function damageImpact(options: DamageImpactOptions): FeelNode {
  return feelParallel(
    impact({
      ...options.impact,
      target: options.target,
      ...(options.position === undefined ? {} : { position: options.position }),
    }),
    feelDamageNumber({
      ...options.number,
      value: options.value,
      ...(options.position === undefined ? {} : { position: options.position }),
      ...(options.critical === undefined ? {} : { critical: options.critical }),
    }),
  );
}

export interface DashBurstOptions {
  /** Visual that stretches and blurs along the dash axis. */
  target: VisualComponent;
  /** Dash direction. The dominant component selects the blur axis. */
  direction: Vec2Like;
  /** World position for the flight lines. Defaults to the cue entity. */
  position?: FeelFlightLinesOptions["position"];
  /** Total recipe duration in seconds. Default: `0.3`. */
  duration?: number;
  /** Stretch above the base scale. Default: `0.28`. */
  stretch?: number;
  /** Axis-blur options. The recipe supplies the axis. */
  blur?: Omit<AxisBlurOptions, "axis">;
  /** Flight-line options. The recipe supplies timing, direction, and position. */
  lines?: Omit<FeelFlightLinesOptions, "duration" | "direction" | "position">;
}

/** Stretch, blur, and draw flight lines along a dash direction. */
export function dashBurst(options: DashBurstOptions): FeelNode {
  validateDirection("dashBurst", options.direction);
  const duration = positiveDuration("dashBurst", options.duration ?? 0.3);
  const axis =
    Math.abs(options.direction.x) >= Math.abs(options.direction.y)
      ? "horizontal"
      : "vertical";
  return feelParallel(
    feelSquash({
      target: options.target,
      axis: axis === "horizontal" ? "x" : "y",
      amount: options.stretch ?? 0.28,
      duration,
      peakAt: 0.3,
    }),
    feelEffect(
      options.target.fx,
      axisBlur({
        strength: 14,
        quality: 2,
        ...options.blur,
        axis,
      }),
      { duration, peakAt: 0.3 },
    ),
    feelFlightLines({
      count: 8,
      spread: 52,
      depth: 76,
      ...options.lines,
      direction: options.direction,
      ...(options.position === undefined ? {} : { position: options.position }),
      duration,
    }),
  );
}

export interface SpawnPopOptions {
  /** Existing visual that appears with the pop. */
  target: VisualComponent;
  /** Total settling time in seconds. Default: `0.45`. */
  duration?: number;
  /** Scale at the start of the pop. Default: `0.6`. */
  startScale?: number;
  /** Initial rendered position offset. Default: `{ x: 0, y: 8 }`. */
  offset?: Vec2Like;
  /** Number of spring oscillations. Default: `2`. */
  oscillations?: number;
  /** Spring decay exponent. Default: `2.5`. */
  decay?: number;
  /** Glow options. The recipe supplies the target and duration. */
  glow?: Omit<FeelGlowOptions, "target" | "duration">;
}

/** Settle an existing visual from a smaller, offset, glowing pose. */
export function spawnPop(options: SpawnPopOptions): FeelNode {
  const duration = positiveDuration("spawnPop", options.duration ?? 0.45);
  const spring = {
    duration,
    oscillations: options.oscillations ?? 2,
    decay: options.decay ?? 2.5,
  };
  return feelParallel(
    feelScaleSpring({
      target: options.target,
      scale: options.startScale ?? 0.6,
      ...spring,
    }),
    feelPositionSpring({
      target: options.target,
      offset: options.offset ?? { x: 0, y: 8 },
      ...spring,
    }),
    feelGlow({
      color: 0xffd54a,
      distance: 8,
      outerStrength: 3,
      peakAt: 0.2,
      ...options.glow,
      target: options.target,
      duration: Math.min(duration, 0.35),
    }),
  );
}

export interface VoidCollapseOptions {
  /** Effect host for both renderer passes. */
  host: EffectsHost;
  /** Center in the effect host's local coordinates. Omit for the host center. */
  center?: { x: number; y: number };
  /** Radius in host-local pixels. Default: 180. */
  radius?: number;
  /** Inward displacement strength. Default: 0.8. */
  strength?: number;
  /** Center darkening from 0 to 1. Default: 0.9. */
  darkness?: number;
  /** Rotation applied near the center, in radians. Default: 0.35. */
  swirl?: number;
  /** Inward zoom-blur strength. Default: -0.14. */
  zoomStrength?: number;
  /** Total pulse duration. Default: 0.6. */
  duration?: number;
  /** Normalized time of maximum collapse. Default: 0.65. */
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

/**
 * Ready-made inward distortion and zoom-blur cue. The recipe does not add a
 * burst, particles, camera movement, sound, or gameplay consequences.
 */
export function voidCollapse(options: VoidCollapseOptions): FeelNode {
  const timing = {
    duration: options.duration ?? 0.6,
    peakAt: options.peakAt ?? 0.65,
    ...(options.attackEasing === undefined
      ? {}
      : { attackEasing: options.attackEasing }),
    ...(options.releaseEasing === undefined
      ? {}
      : { releaseEasing: options.releaseEasing }),
  };
  return feelParallel(
    feelEffect(
      options.host,
      implosion({
        ...(options.center === undefined ? {} : { center: options.center }),
        radius: options.radius ?? 180,
        strength: options.strength ?? 0.8,
        darkness: options.darkness ?? 0.9,
        swirl: options.swirl ?? 0.35,
      }),
      timing,
    ),
    feelEffect(
      options.host,
      zoomBlur({
        ...(options.center === undefined ? {} : { center: options.center }),
        radius: options.radius ?? 180,
        strength: options.zoomStrength ?? -0.14,
      }),
      timing,
    ),
  );
}

function positiveDuration(label: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}: duration must be a finite number > 0.`);
  }
  return value;
}

function validateDirection(label: string, direction: Vec2Like): void {
  if (
    !Number.isFinite(direction.x) ||
    !Number.isFinite(direction.y) ||
    (direction.x === 0 && direction.y === 0)
  ) {
    throw new Error(`${label}: direction must be a finite non-zero vector.`);
  }
}

import { easeOutQuad, type EasingFunction, type Vec2Like } from "@yagejs/core";
import { axisBlur, colorize, implosion, zoomBlur } from "@yagejs/effects";
import type { AxisBlurOptions, ColorizeOptions } from "@yagejs/effects";
import type { EffectsHost, VisualComponent } from "@yagejs/renderer";
import { feelDelay, feelParallel, feelSequence } from "./core/node.js";
import type { FeelEffectContext, FeelNode } from "./core/types.js";
import { feelCall } from "./effects/core.js";
import {
  feelDissolve,
  feelEffect,
  feelGlow,
  feelHitFlash,
} from "./adapters/renderer.js";
import type {
  FeelDissolveOptions,
  FeelGlowOptions,
} from "./adapters/renderer.js";
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

export interface EnemyDeathOptions {
  /** Visual that flashes and dissolves. */
  target: VisualComponent;
  /** Called after the temporary visual effects clean up. Destroy or pool the enemy here. */
  onComplete: (context: FeelEffectContext) => void;
  /** World position for the impact ring. Defaults to the cue entity. */
  position?: FeelImpactRingOptions["position"];
  /** Shared edge, glow, and impact-ring color. Default: `0x67e8f9`. */
  color?: number;
  /** Initial impact duration in seconds. Default: `0.22`. */
  impactDuration?: number;
  /** Dissolve duration in seconds. Default: `0.6`. */
  dissolveDuration?: number;
  /** Peak scale during the initial impact. Default: `1.12`. */
  scale?: number;
  /** Initial visual shake amplitude in pixels. Default: `3`. */
  shake?: number;
  /** Dissolve options. The recipe supplies the target and duration. */
  dissolve?: Omit<FeelDissolveOptions, "target" | "duration">;
  /** Glow options. The recipe supplies the target and duration. */
  glow?: Omit<FeelGlowOptions, "target" | "duration">;
  /** Impact-ring options, or `false` to omit the ring. */
  ring?: Omit<FeelImpactRingOptions, "position" | "duration"> | false;
}

/** Flash on impact, burn away through a bright edge, then run cleanup. */
export function enemyDeath(options: EnemyDeathOptions): FeelNode {
  const impactDuration = positiveDuration(
    "enemyDeath",
    options.impactDuration ?? 0.22,
  );
  const dissolveDuration = positiveDuration(
    "enemyDeath",
    options.dissolveDuration ?? 0.6,
  );
  const color = options.color ?? 0x67e8f9;
  const ring =
    options.ring === false
      ? []
      : [
          feelImpactRing({
            color,
            radius: 28,
            expand: 1.8,
            thickness: 3,
            spikes: 10,
            spikeLength: 10,
            ...options.ring,
            ...(options.position === undefined
              ? {}
              : { position: options.position }),
            duration: impactDuration,
          }),
        ];

  return feelSequence(
    feelParallel(
      feelHitFlash(options.target.fx, {
        color: 0xffffff,
        duration: Math.min(impactDuration, 0.14),
      }),
      feelScalePunch({
        target: options.target,
        scale: options.scale ?? 1.12,
        duration: impactDuration,
        peakAt: 0.3,
      }),
      feelTransformShake({
        target: options.target,
        amplitude: options.shake ?? 3,
        duration: impactDuration,
        frequency: 30,
        decay: 1.8,
      }),
      ...ring,
    ),
    feelParallel(
      feelDissolve({
        edgeColor: color,
        edgeWidth: 0.1,
        noiseScale: 10,
        softness: 0.025,
        ...options.dissolve,
        target: options.target,
        duration: dissolveDuration,
      }),
      feelGlow({
        color,
        distance: 12,
        outerStrength: 4,
        innerStrength: 1,
        peakAt: 0.18,
        ...options.glow,
        target: options.target,
        duration: dissolveDuration,
      }),
    ),
    feelCall(options.onComplete, "enemy death completion"),
  );
}

export interface VoidCollapseOptions {
  /** Effect host for the renderer passes. */
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
  /** Grow the implosion radius outward from its center. Default: `true`. */
  expandFromCenter?: boolean;
  /** Inward zoom-blur strength. Default: -0.28. */
  zoomStrength?: number;
  /** Delay before the implosion joins the blur, in seconds. Default: `0.06`. */
  implosionDelay?: number;
  /** Time spent at maximum collapse, included in `duration`. Default: `0.16`. */
  holdDuration?: number;
  /** Color treatment at maximum collapse, or `false` to omit it. Default: `0x6366f1`. */
  color?: ColorizeOptions["color"] | false;
  /** Strength of the color treatment from 0 to 1. Default: `0.65`. */
  colorStrength?: number;
  /** Total cue duration. Default: `0.85`. */
  duration?: number;
  /** Normalized time when the cue first reaches maximum collapse. Default: `0.5`. */
  peakAt?: number;
  attackEasing?: EasingFunction;
  releaseEasing?: EasingFunction;
}

/**
 * Draw the host inward through staged blur, implosion, and optional color.
 * The recipe does not add a burst, particles, camera movement, sound, or
 * gameplay consequences.
 */
export function voidCollapse(options: VoidCollapseOptions): FeelNode {
  const duration = positiveDuration("voidCollapse", options.duration ?? 0.85);
  const peakAt = unitInterval("voidCollapse: peakAt", options.peakAt ?? 0.5);
  const peakTime = duration * peakAt;
  const implosionDelay = nonNegativeDuration(
    "voidCollapse: implosionDelay",
    options.implosionDelay ?? 0.06,
  );
  const holdDuration = nonNegativeDuration(
    "voidCollapse: holdDuration",
    options.holdDuration ?? 0.16,
  );
  if (implosionDelay >= duration || implosionDelay > peakTime) {
    throw new Error(
      "voidCollapse: implosionDelay must be less than duration and no later than the peak.",
    );
  }
  if (peakTime + holdDuration > duration) {
    throw new Error(
      "voidCollapse: holdDuration must fit between the peak and the end of the cue.",
    );
  }

  const sharedTiming = heldPulseTiming({
    duration,
    peakTime,
    holdDuration,
    attackEasing: options.attackEasing,
    releaseEasing: options.releaseEasing,
  });
  const implosionDuration = duration - implosionDelay;
  const implosionTiming = heldPulseTiming({
    duration: implosionDuration,
    peakTime: peakTime - implosionDelay,
    holdDuration,
    attackEasing: options.attackEasing,
    releaseEasing: options.releaseEasing,
  });
  const color = options.color ?? 0x6366f1;

  return feelParallel(
    feelEffect(
      options.host,
      zoomBlur({
        ...(options.center === undefined ? {} : { center: options.center }),
        radius: options.radius ?? 180,
        strength: options.zoomStrength ?? -0.28,
        expandFromCenter: options.expandFromCenter ?? true,
      }),
      sharedTiming,
    ),
    feelDelay(
      implosionDelay,
      feelEffect(
        options.host,
        implosion({
          ...(options.center === undefined ? {} : { center: options.center }),
          radius: options.radius ?? 180,
          strength: options.strength ?? 0.8,
          darkness: options.darkness ?? 0.9,
          swirl: options.swirl ?? 0.35,
          expandFromCenter: options.expandFromCenter ?? true,
        }),
        implosionTiming,
      ),
    ),
    ...(color === false
      ? []
      : [
          feelEffect(
            options.host,
            colorize({ color, strength: options.colorStrength ?? 0.65 }),
            sharedTiming,
          ),
        ]),
  );
}

interface HeldPulseTimingOptions {
  duration: number;
  peakTime: number;
  holdDuration: number;
  attackEasing: EasingFunction | undefined;
  releaseEasing: EasingFunction | undefined;
}

function heldPulseTiming(options: HeldPulseTimingOptions): {
  duration: number;
  peakAt: number;
  attackEasing?: EasingFunction;
  releaseEasing: EasingFunction;
} {
  const releaseWindow = options.duration - options.peakTime;
  const holdShare =
    releaseWindow === 0 ? 1 : options.holdDuration / releaseWindow;
  const release = options.releaseEasing ?? easeOutQuad;
  const releaseEasing: EasingFunction =
    holdShare >= 1
      ? () => 0
      : (progress) => {
          if (progress <= holdShare) return 0;
          return release((progress - holdShare) / (1 - holdShare));
        };

  return {
    duration: options.duration,
    peakAt: options.peakTime / options.duration,
    ...(options.attackEasing === undefined
      ? {}
      : { attackEasing: options.attackEasing }),
    releaseEasing,
  };
}

function nonNegativeDuration(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number >= 0.`);
  }
  return value;
}

function unitInterval(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1.`);
  }
  return value;
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

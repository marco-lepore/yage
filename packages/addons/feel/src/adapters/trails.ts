import {
  Transform,
  Vec2,
  easeOutQuad,
  type Entity,
  type Vec2Like,
} from "@yagejs/core";
import {
  GraphicsComponent,
  type ColorValue,
  type VisualOpacityModifierHandle,
  type VisualTransformModifierHandle,
} from "@yagejs/renderer";
import { defineFeelEffect, defineFeelState } from "../core/node.js";
import type { FeelEffectContext, FeelNode, FeelRange } from "../core/types.js";

type FeelPositionSource = Vec2Like | ((context: FeelEffectContext) => Vec2Like);

const ZERO_DIRECTION_LENGTH_SQ = 1e-12;
const ZERO_DIRECTION_COMPONENT_LIMIT = 1e-6;

export interface FeelFlightLinesOptions {
  /** Center of the line field in world pixels. Defaults to the cue entity. */
  position?: FeelPositionSource;
  /**
   * Direction of travel. A fixed vector must have a magnitude greater than
   * `1e-6`. A function is evaluated once per burst; a finite zero or near-zero
   * result skips that burst. Default: `{ x: 1, y: 0 }`.
   */
  direction?: FeelPositionSource;
  /** Number of lines. Default: `8`. */
  count?: number;
  /** Fixed or randomized line length in pixels. Default: `[18, 42]`. */
  length?: FeelRange;
  /** Stroke width in pixels. Default: `2`. */
  width?: number;
  /** Field width perpendicular to `direction`. Default: `56`. */
  spread?: number;
  /** Field length along `direction`. Default: `72`. */
  depth?: number;
  /** Distance the field moves opposite `direction`. Default: `24`. */
  travel?: number;
  /** Stroke color. Default: `0xffffff`. */
  color?: ColorValue;
  /** Stroke alpha. Default: `0.8`. */
  alpha?: number;
  /** Render layer. Default: `"default"`. */
  layer?: string;
  /** Total duration in seconds. Default: `0.3`. */
  duration?: number;
}

export interface FeelMotionTrailOptions {
  /** Live world position to sample. Defaults to the cue entity's `Transform`. */
  position?: FeelPositionSource;
  /** Time spent collecting positions in seconds, or until release. Default: `0.35`. */
  duration?: number | "held";
  /** Lifetime of each sampled point in seconds. Default: `0.2`. */
  lifetime?: number;
  /** Minimum time between samples in seconds. Default: `1 / 60`. */
  sampleInterval?: number;
  /** Minimum distance between stored points in pixels. Default: `2`. */
  minDistance?: number;
  /** Maximum stored points. Default: `32`. */
  maxPoints?: number;
  /** Stroke width at the newest point in pixels. Default: `4`. */
  width?: number;
  /** Whether old segments narrow as they fade. Default: `true`. */
  taper?: boolean;
  /** Stroke color. Default: `0xffffff`. */
  color?: ColorValue;
  /** Maximum stroke alpha. Default: `0.65`. */
  alpha?: number;
  /** Render layer. Default: `"default"`. */
  layer?: string;
}

interface TrailPoint {
  position: Vec2;
  createdAt: number;
}

/** Spawn a directional field of short streaks that moves and fades. */
export function feelFlightLines(
  options: FeelFlightLinesOptions = {},
): FeelNode {
  const duration = options.duration ?? 0.3;
  const count = options.count ?? 8;
  const length = options.length ?? [18, 42];
  const width = options.width ?? 2;
  const spread = options.spread ?? 56;
  const depth = options.depth ?? 72;
  const travel = options.travel ?? 24;
  const alpha = options.alpha ?? 0.8;
  validateInteger(count, "feelFlightLines: count", 0);
  validateRange(length, "feelFlightLines: length", true);
  validatePositive(width, "feelFlightLines: width");
  validateNonNegative(spread, "feelFlightLines: spread");
  validateNonNegative(depth, "feelFlightLines: depth");
  validateNonNegative(travel, "feelFlightLines: travel");
  validateUnit(alpha, "feelFlightLines: alpha");
  const directionSource = options.direction;
  const staticDirection =
    typeof directionSource === "function"
      ? undefined
      : requireFlightDirection(directionSource ?? Vec2.RIGHT);

  return defineFeelEffect(duration, (context) => {
    const direction =
      typeof directionSource === "function"
        ? resolveLiveFlightDirection(directionSource, context)
        : staticDirection;
    if (!direction) return {};
    const position = resolvePosition(
      options.position,
      context,
      "feelFlightLines",
    );
    const perpendicular = new Vec2(-direction.y, direction.x);
    const lines = Array.from({ length: count }, () => ({
      center: direction
        .scale(context.random.range(-depth / 2, depth / 2))
        .add(
          perpendicular.scale(context.random.range(-spread / 2, spread / 2)),
        ),
      length: resolveRange(length, context),
    }));
    let spawned: Entity | undefined;
    let transformModifier: VisualTransformModifierHandle | undefined;
    let opacityModifier: VisualOpacityModifierHandle | undefined;
    return {
      start: () => {
        spawned = context.entity.scene.spawn("feel:flight-lines");
        try {
          spawned.add(new Transform({ position }));
          const graphics = spawned.add(
            new GraphicsComponent(
              options.layer === undefined
                ? undefined
                : { layer: options.layer },
            ).draw((g) => {
              for (const line of lines) {
                const half = direction.scale(line.length / 2);
                const start = line.center.sub(half);
                const end = line.center.add(half);
                g.moveTo(start.x, start.y)
                  .lineTo(end.x, end.y)
                  .stroke({
                    color: options.color ?? 0xffffff,
                    width,
                    alpha: Math.min(1, alpha * context.intensity),
                  });
              }
            }),
          );
          transformModifier = graphics.modifiers.addTransform();
          opacityModifier = graphics.modifiers.addOpacity();
        } catch (error) {
          spawned.destroy();
          throw error;
        }
      },
      update: (progress) => {
        const eased = easeOutQuad(progress);
        transformModifier?.setPosition(
          direction.scale(-travel * eased * context.intensity),
        );
        opacityModifier?.setFactor(Math.max(0, 1 - eased));
      },
      finish: () => {
        transformModifier?.remove();
        opacityModifier?.remove();
        spawned?.destroy();
      },
    };
  });
}

/** Draw a fading line through recent world-position samples. */
export function feelMotionTrail(
  options: FeelMotionTrailOptions = {},
): FeelNode {
  const sampleDuration = options.duration ?? 0.35;
  const lifetime = options.lifetime ?? 0.2;
  const sampleInterval = options.sampleInterval ?? 1 / 60;
  const minDistance = options.minDistance ?? 2;
  const maxPoints = options.maxPoints ?? 32;
  const width = options.width ?? 4;
  const alpha = options.alpha ?? 0.65;
  if (sampleDuration !== "held") {
    validateNonNegative(sampleDuration, "feelMotionTrail: duration");
  }
  validatePositive(lifetime, "feelMotionTrail: lifetime");
  validatePositive(sampleInterval, "feelMotionTrail: sampleInterval");
  validateNonNegative(minDistance, "feelMotionTrail: minDistance");
  validateInteger(maxPoints, "feelMotionTrail: maxPoints", 2);
  validatePositive(width, "feelMotionTrail: width");
  validateUnit(alpha, "feelMotionTrail: alpha");
  if (sampleDuration === "held") {
    return defineFeelState({ release: lifetime }, (context) => {
      const trail = createMotionTrail(context, options, {
        sampleDuration: null,
        lifetime,
        sampleInterval,
        minDistance,
        maxPoints,
        width,
        alpha,
      });
      return {
        start: trail.start,
        update: (_amount, dt) => trail.update(dt),
        release: trail.release,
        finish: trail.finish,
      };
    });
  }

  const totalDuration = sampleDuration + lifetime;

  return defineFeelEffect(totalDuration, (context) => {
    const trail = createMotionTrail(context, options, {
      sampleDuration,
      lifetime,
      sampleInterval,
      minDistance,
      maxPoints,
      width,
      alpha,
    });
    return {
      start: trail.start,
      update: (_progress, dt) => trail.update(dt),
      finish: trail.finish,
    };
  });
}

function createMotionTrail(
  context: FeelEffectContext,
  options: FeelMotionTrailOptions,
  timing: {
    sampleDuration: number | null;
    lifetime: number;
    sampleInterval: number;
    minDistance: number;
    maxPoints: number;
    width: number;
    alpha: number;
  },
): {
  start(): void;
  update(dt: number): void;
  release(): void;
  finish(): void;
} {
  const points: TrailPoint[] = [];
  let spawned: Entity | undefined;
  let graphics: GraphicsComponent | undefined;
  let elapsed = 0;
  let nextSampleAt = 0;
  let sampling = true;
  return {
    start: () => {
      spawned = context.entity.scene.spawn("feel:motion-trail");
      try {
        spawned.add(new Transform());
        graphics = spawned.add(
          new GraphicsComponent(
            options.layer === undefined ? undefined : { layer: options.layer },
          ),
        );
        addTrailPoint(
          points,
          resolvePosition(options.position, context, "feelMotionTrail"),
          0,
          { minDistance: timing.minDistance, maxPoints: timing.maxPoints },
        );
        nextSampleAt = timing.sampleInterval;
        drawTrail(graphics, points, 0, timing.lifetime, {
          color: options.color ?? 0xffffff,
          width: timing.width,
          alpha: timing.alpha,
          taper: options.taper ?? true,
          intensity: context.intensity,
        });
      } catch (error) {
        spawned.destroy();
        throw error;
      }
    },
    update: (dt) => {
      elapsed += dt;
      if (timing.sampleDuration !== null && elapsed > timing.sampleDuration) {
        sampling = false;
      }
      if (sampling && elapsed >= nextSampleAt) {
        addTrailPoint(
          points,
          resolvePosition(options.position, context, "feelMotionTrail"),
          elapsed,
          { minDistance: timing.minDistance, maxPoints: timing.maxPoints },
        );
        while (nextSampleAt <= elapsed) nextSampleAt += timing.sampleInterval;
      }
      while (
        points.length > 0 &&
        elapsed - (points[0]?.createdAt ?? elapsed) >= timing.lifetime
      ) {
        points.shift();
      }
      if (graphics) {
        drawTrail(graphics, points, elapsed, timing.lifetime, {
          color: options.color ?? 0xffffff,
          width: timing.width,
          alpha: timing.alpha,
          taper: options.taper ?? true,
          intensity: context.intensity,
        });
      }
    },
    release: () => {
      sampling = false;
    },
    finish: () => spawned?.destroy(),
  };
}

function drawTrail(
  graphics: GraphicsComponent,
  points: readonly TrailPoint[],
  elapsed: number,
  lifetime: number,
  style: {
    color: ColorValue;
    width: number;
    alpha: number;
    taper: boolean;
    intensity: number;
  },
): void {
  graphics.draw((g) => {
    g.clear();
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      if (!from || !to) continue;
      const remaining = Math.max(0, 1 - (elapsed - to.createdAt) / lifetime);
      g.moveTo(from.position.x, from.position.y)
        .lineTo(to.position.x, to.position.y)
        .stroke({
          color: style.color,
          width: Math.max(0.0001, style.width * (style.taper ? remaining : 1)),
          alpha: Math.min(1, style.alpha * remaining * style.intensity),
        });
    }
  });
}

function addTrailPoint(
  points: TrailPoint[],
  position: Vec2,
  createdAt: number,
  options: { minDistance: number; maxPoints: number },
): void {
  const previous = points[points.length - 1];
  if (previous && previous.position.distance(position) < options.minDistance) {
    return;
  }
  points.push({ position, createdAt });
  while (points.length > options.maxPoints) points.shift();
}

function resolvePosition(
  source: FeelPositionSource | undefined,
  context: FeelEffectContext,
  effectName: string,
): Vec2 {
  if (source !== undefined) {
    return toVec2(
      resolveCallback(source, context, `${effectName} position source`),
      "position",
    );
  }
  const transform = context.entity.tryGet(Transform);
  if (!transform) {
    throw new Error(
      `${effectName}: the cue entity needs Transform when position is omitted.`,
    );
  }
  return new Vec2(transform.worldPosition.x, transform.worldPosition.y);
}

function resolveLiveFlightDirection(
  source: (context: FeelEffectContext) => Vec2Like,
  context: FeelEffectContext,
): Vec2 | null {
  let direction: Vec2 | null = null;
  context.invoke("flight-line direction source", () => {
    direction = normalizeFlightDirection(source(context));
  });
  return direction;
}

function requireFlightDirection(source: Vec2Like): Vec2 {
  const direction = normalizeFlightDirection(source);
  if (!direction) {
    throw new Error("feelFlightLines: direction must not be zero.");
  }
  return direction;
}

function normalizeFlightDirection(source: Vec2Like): Vec2 | null {
  const direction = toVec2(source, "feelFlightLines: direction");
  const largestComponent = Math.max(
    Math.abs(direction.x),
    Math.abs(direction.y),
  );
  if (
    largestComponent <= ZERO_DIRECTION_COMPONENT_LIMIT &&
    direction.lengthSq() <= ZERO_DIRECTION_LENGTH_SQ
  ) {
    return null;
  }

  const scaledX = direction.x / largestComponent;
  const scaledY = direction.y / largestComponent;
  const scaledLength = Math.sqrt(scaledX * scaledX + scaledY * scaledY);
  return new Vec2(scaledX / scaledLength, scaledY / scaledLength);
}

function resolveCallback<T>(
  source: T | ((context: FeelEffectContext) => T),
  context: FeelEffectContext,
  label: string,
): T {
  if (typeof source !== "function") return source;
  let value: T | undefined;
  context.invoke(label, () => {
    value = (source as (context: FeelEffectContext) => T)(context);
  });
  return value as T;
}

function resolveRange(range: FeelRange, context: FeelEffectContext): number {
  return typeof range === "number"
    ? range
    : context.random.range(range[0], range[1]);
}

function validateRange(
  range: FeelRange,
  label: string,
  positive: boolean,
): void {
  const min = typeof range === "number" ? range : range[0];
  const max = typeof range === "number" ? range : range[1];
  const validBounds = positive ? min > 0 && max > 0 : min >= 0 && max >= 0;
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !validBounds ||
    min > max
  ) {
    throw new Error(`${label} must contain finite ascending positive values.`);
  }
}

function validatePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number > 0, got ${value}.`);
  }
}

function validateNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite number >= 0, got ${value}.`);
  }
}

function validateUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1, got ${value}.`);
  }
}

function validateInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}, got ${value}.`);
  }
}

function toVec2(value: Vec2Like, label: string): Vec2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`${label} must contain finite x/y values.`);
  }
  return new Vec2(value.x, value.y);
}

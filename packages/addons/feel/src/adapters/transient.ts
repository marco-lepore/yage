import {
  Transform,
  Vec2,
  easeOutQuad,
  type Entity,
  type Vec2Like,
} from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type ColorValue,
  type TextStyle,
  type VisualOpacityModifierHandle,
  type VisualTransformModifierHandle,
} from "@yagejs/renderer";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";

type FeelPositionSource = Vec2Like | ((context: FeelEffectContext) => Vec2Like);

type FeelTextSource = string | ((context: FeelEffectContext) => string);

interface FeelTransientPositionOptions {
  /** Spawn position in world pixels. Defaults to the cue entity's world position. */
  position?: FeelPositionSource;
  /** Render layer for the transient visual. Default: `"default"`. */
  layer?: string;
}

export interface FeelFloatingTextOptions extends FeelTransientPositionOptions {
  /** Text to display. A function is evaluated for each playback. */
  text: FeelTextSource;
  /** Text style passed to `TextComponent`. */
  style?: TextStyle;
  /** Initial offset from the resolved world position. Default: `{ x: 0, y: -16 }`. */
  offset?: Vec2Like;
  /** Total travel during the effect. Default: `{ x: 0, y: -48 }`. */
  travel?: Vec2Like;
  /** Random horizontal spawn spread in pixels. Default: `8`. */
  spread?: number;
  /** Horizontal wave amplitude in pixels. Default: `0`. */
  sway?: number;
  /** Total duration in seconds. Default: `0.75`. */
  duration?: number;
  /** Normalized progress where fading starts. Default: `0.4`. */
  fadeAt?: number;
  /** Scale at spawn. Default: `0.7`. */
  startScale?: number;
  /** Largest scale during the pop. Default: `1.12`. */
  peakScale?: number;
  /** Normalized progress where the pop reaches its largest scale. Default: `0.15`. */
  peakAt?: number;
  /** Normalized progress where scale settles at `1`. Default: `0.35`. */
  settleAt?: number;
}

export interface FeelDamageNumberOptions extends FeelTransientPositionOptions {
  /** Damage value. A function is evaluated for each playback. */
  value: number | string | ((context: FeelEffectContext) => number | string);
  /** Whether to use critical-hit styling. A function is evaluated for each playback. */
  critical?: boolean | ((context: FeelEffectContext) => boolean);
  /** Prefix before the value. Default: `""`. */
  prefix?: string;
  /** Suffix after the value. Default: `""`. */
  suffix?: string;
  /** Override how the displayed value is formatted. */
  format?: (value: number | string, context: FeelEffectContext) => string;
  /** Base text color. Default: `0xffffff`. */
  color?: ColorValue;
  /** Critical-hit text color. Default: `0xffd54a`. */
  criticalColor?: ColorValue;
  /** Base font size in pixels. Default: `24`. */
  fontSize?: number;
  /** Critical-hit font-size multiplier. Default: `1.35`. */
  criticalSize?: number;
  /** Outline color. Default: `0x000000`. */
  outlineColor?: ColorValue;
  /** Outline width in pixels. Default: `3`. */
  outlineWidth?: number;
  /** Base text style. Overrides the defaults above. */
  style?: TextStyle;
  /** Extra style applied only to critical hits. */
  criticalStyle?: TextStyle;
  /** Upward travel in pixels. Default: `52`. */
  rise?: number;
  /** Random horizontal spawn spread in pixels. Default: `18`. */
  spread?: number;
  /** Horizontal wave amplitude in pixels. Default: `4`. */
  sway?: number;
  /** Total duration in seconds. Default: `0.8`. */
  duration?: number;
  /** Normalized progress where fading starts. Default: `0.35`. */
  fadeAt?: number;
}

export interface FeelImpactRingOptions extends FeelTransientPositionOptions {
  /** Ring radius in pixels before expansion. Default: `24`. */
  radius?: number;
  /** Final scale multiplier. Default: `2.2`. */
  expand?: number;
  /** Ring and spike width in pixels. Default: `3`. */
  thickness?: number;
  /** Ring and spike color. Default: `0xffd54a`. */
  color?: ColorValue;
  /** Number of radial spikes. Default: `8`. */
  spikes?: number;
  /** Spike length beyond the ring in pixels. Default: `12`. */
  spikeLength?: number;
  /** Total duration in seconds. Default: `0.32`. */
  duration?: number;
  /** Scale at spawn. Default: `0.35`. */
  startScale?: number;
}

interface ResolvedFloatingText {
  text: string;
  style: TextStyle;
  position: Vec2;
  layer: string | undefined;
  offset: Vec2;
  travel: Vec2;
  spread: number;
  sway: number;
  fadeAt: number;
  startScale: number;
  peakScale: number;
  peakAt: number;
  settleAt: number;
}

/** Spawn text that pops, moves, fades, and cleans itself up. */
export function feelFloatingText(options: FeelFloatingTextOptions): FeelNode {
  const duration = options.duration ?? 0.75;
  validateFloatingText(options);
  return floatingTextEffect(duration, (context) => ({
    text: resolveCallback(options.text, context, "floating text source"),
    style: {
      fontSize: 24,
      fontWeight: "bold",
      fill: 0xffffff,
      ...options.style,
    },
    position: resolvePosition(options.position, context),
    layer: options.layer,
    offset: toVec2(options.offset ?? new Vec2(0, -16), "offset"),
    travel: toVec2(options.travel ?? new Vec2(0, -48), "travel"),
    spread: options.spread ?? 8,
    sway: options.sway ?? 0,
    fadeAt: options.fadeAt ?? 0.4,
    startScale: options.startScale ?? 0.7,
    peakScale: options.peakScale ?? 1.12,
    peakAt: options.peakAt ?? 0.15,
    settleAt: options.settleAt ?? 0.35,
  }));
}

/** Spawn a readable floating damage number with optional critical-hit styling. */
export function feelDamageNumber(options: FeelDamageNumberOptions): FeelNode {
  const duration = options.duration ?? 0.8;
  validateDamageNumber(options);
  return floatingTextEffect(duration, (context) => {
    const value = resolveCallback(options.value, context, "damage value");
    const critical = resolveCallback(
      options.critical ?? false,
      context,
      "critical damage predicate",
    );
    let text = `${options.prefix ?? ""}${String(value)}${options.suffix ?? ""}`;
    if (options.format) {
      context.invoke("damage number formatter", () => {
        text = options.format?.(value, context) ?? text;
      });
    }
    const fontSize =
      (options.fontSize ?? 24) *
      (critical ? (options.criticalSize ?? 1.35) : 1);
    const style: TextStyle = {
      fontSize,
      fontWeight: "bold",
      fill: critical
        ? (options.criticalColor ?? 0xffd54a)
        : (options.color ?? 0xffffff),
      stroke: {
        color: options.outlineColor ?? 0x000000,
        width: options.outlineWidth ?? 3,
      },
      ...options.style,
      ...(critical ? options.criticalStyle : undefined),
    };
    return {
      text,
      style,
      position: resolvePosition(options.position, context),
      layer: options.layer,
      offset: new Vec2(0, -16),
      travel: new Vec2(0, -(options.rise ?? 52)),
      spread: options.spread ?? 18,
      sway: options.sway ?? 4,
      fadeAt: options.fadeAt ?? 0.35,
      startScale: critical ? 0.55 : 0.7,
      peakScale: critical ? 1.2 : 1.1,
      peakAt: 0.14,
      settleAt: 0.34,
    };
  });
}

/** Spawn an expanding ring and radial spikes at a world position. */
export function feelImpactRing(options: FeelImpactRingOptions = {}): FeelNode {
  const duration = options.duration ?? 0.32;
  const radius = options.radius ?? 24;
  const expand = options.expand ?? 2.2;
  const thickness = options.thickness ?? 3;
  const spikes = options.spikes ?? 8;
  const spikeLength = options.spikeLength ?? 12;
  const startScale = options.startScale ?? 0.35;
  validatePositive(radius, "feelImpactRing: radius");
  validatePositive(expand, "feelImpactRing: expand");
  validatePositive(thickness, "feelImpactRing: thickness");
  validateNonNegative(spikeLength, "feelImpactRing: spikeLength");
  validatePositive(startScale, "feelImpactRing: startScale");
  if (!Number.isInteger(spikes) || spikes < 0) {
    throw new Error(
      `feelImpactRing: spikes must be an integer >= 0, got ${spikes}.`,
    );
  }

  return defineFeelEffect(duration, (context) => {
    const position = resolvePosition(options.position, context);
    let spawned: Entity | undefined;
    let transformModifier: VisualTransformModifierHandle | undefined;
    let opacityModifier: VisualOpacityModifierHandle | undefined;
    return {
      start: () => {
        spawned = context.entity.scene.spawn("feel:impact-ring");
        try {
          spawned.add(new Transform({ position }));
          const graphics = spawned.add(
            new GraphicsComponent(
              options.layer === undefined
                ? undefined
                : { layer: options.layer },
            ).draw((g) => {
              const color = options.color ?? 0xffd54a;
              g.circle(0, 0, radius).stroke({ color, width: thickness });
              for (let index = 0; index < spikes; index++) {
                const direction = Vec2.fromAngle(
                  (Math.PI * 2 * index) / spikes,
                );
                g.moveTo(direction.x * (radius + 3), direction.y * (radius + 3))
                  .lineTo(
                    direction.x * (radius + 3 + spikeLength),
                    direction.y * (radius + 3 + spikeLength),
                  )
                  .stroke({ color, width: thickness * 0.75 });
              }
            }),
          );
          transformModifier = graphics.modifiers.addTransform({
            scale: startScale,
          });
          opacityModifier = graphics.modifiers.addOpacity();
        } catch (error) {
          spawned.destroy();
          throw error;
        }
      },
      update: (progress) => {
        const eased = easeOutQuad(progress);
        const scale =
          startScale + (expand * context.intensity - startScale) * eased;
        transformModifier?.setScale(Math.max(0.0001, scale));
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

function floatingTextEffect(
  duration: number,
  resolve: (context: FeelEffectContext) => ResolvedFloatingText,
): FeelNode {
  return defineFeelEffect(duration, (context) => {
    const spec = resolve(context);
    const randomX = context.random.range(-spec.spread / 2, spec.spread / 2);
    const phase = context.random.range(0, Math.PI * 2);
    let spawned: Entity | undefined;
    let transformModifier: VisualTransformModifierHandle | undefined;
    let opacityModifier: VisualOpacityModifierHandle | undefined;
    return {
      start: () => {
        spawned = context.entity.scene.spawn("feel:floating-text");
        try {
          spawned.add(new Transform({ position: spec.position }));
          const text = spawned.add(
            new TextComponent({
              text: spec.text,
              style: spec.style,
              anchor: { x: 0.5, y: 0.5 },
              ...(spec.layer === undefined ? {} : { layer: spec.layer }),
            }),
          );
          transformModifier = text.modifiers.addTransform({
            position: spec.offset.add(new Vec2(randomX, 0)),
            scale: scaledFromOne(spec.startScale, context.intensity),
          });
          opacityModifier = text.modifiers.addOpacity();
        } catch (error) {
          spawned.destroy();
          throw error;
        }
      },
      update: (progress) => {
        const movement = easeOutQuad(progress);
        const sway =
          Math.sin(phase + progress * Math.PI * 3) *
          spec.sway *
          (1 - progress) *
          context.intensity;
        transformModifier?.setPosition(
          spec.offset.add(
            new Vec2(
              randomX + spec.travel.x * movement * context.intensity + sway,
              spec.travel.y * movement * context.intensity,
            ),
          ),
        );
        transformModifier?.setScale(
          popScale(progress, spec, context.intensity),
        );
        const fadeProgress =
          progress <= spec.fadeAt
            ? 0
            : (progress - spec.fadeAt) / (1 - spec.fadeAt);
        opacityModifier?.setFactor(Math.max(0, 1 - fadeProgress));
      },
      finish: () => {
        transformModifier?.remove();
        opacityModifier?.remove();
        spawned?.destroy();
      },
    };
  });
}

function popScale(
  progress: number,
  spec: Pick<
    ResolvedFloatingText,
    "startScale" | "peakScale" | "peakAt" | "settleAt"
  >,
  intensity: number,
): number {
  const start = scaledFromOne(spec.startScale, intensity);
  const peak = scaledFromOne(spec.peakScale, intensity);
  if (progress <= spec.peakAt) {
    return start + (peak - start) * easeOutQuad(progress / spec.peakAt);
  }
  if (progress <= spec.settleAt) {
    const t = (progress - spec.peakAt) / (spec.settleAt - spec.peakAt);
    return peak + (1 - peak) * easeOutQuad(t);
  }
  return 1;
}

function scaledFromOne(value: number, intensity: number): number {
  return Math.max(0.0001, 1 + (value - 1) * intensity);
}

function resolvePosition(
  source: FeelPositionSource | undefined,
  context: FeelEffectContext,
): Vec2 {
  if (source !== undefined) {
    return toVec2(
      resolveCallback(source, context, "world position source"),
      "position",
    );
  }
  const transform = context.entity.tryGet(Transform);
  if (!transform) {
    throw new Error(
      "Feel transient visual: the cue entity needs Transform when position is omitted.",
    );
  }
  return new Vec2(transform.worldPosition.x, transform.worldPosition.y);
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

function validateFloatingText(options: FeelFloatingTextOptions): void {
  validateNonNegative(options.spread ?? 8, "feelFloatingText: spread");
  validateNonNegative(options.sway ?? 0, "feelFloatingText: sway");
  validateFadeAt(options.fadeAt ?? 0.4, "feelFloatingText: fadeAt");
  validatePositive(options.startScale ?? 0.7, "feelFloatingText: startScale");
  validatePositive(options.peakScale ?? 1.12, "feelFloatingText: peakScale");
  const peakAt = options.peakAt ?? 0.15;
  const settleAt = options.settleAt ?? 0.35;
  validateUnit(peakAt, "feelFloatingText: peakAt", false);
  validateUnit(settleAt, "feelFloatingText: settleAt", true);
  if (settleAt <= peakAt) {
    throw new Error(
      `feelFloatingText: settleAt must be greater than peakAt, got ${settleAt} <= ${peakAt}.`,
    );
  }
}

function validateDamageNumber(options: FeelDamageNumberOptions): void {
  validatePositive(options.fontSize ?? 24, "feelDamageNumber: fontSize");
  validatePositive(
    options.criticalSize ?? 1.35,
    "feelDamageNumber: criticalSize",
  );
  validateNonNegative(
    options.outlineWidth ?? 3,
    "feelDamageNumber: outlineWidth",
  );
  validateNonNegative(options.rise ?? 52, "feelDamageNumber: rise");
  validateNonNegative(options.spread ?? 18, "feelDamageNumber: spread");
  validateNonNegative(options.sway ?? 4, "feelDamageNumber: sway");
  validateFadeAt(options.fadeAt ?? 0.35, "feelDamageNumber: fadeAt");
}

function validateFadeAt(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(
      `${label} must be a finite number >= 0 and < 1, got ${value}.`,
    );
  }
}

function validateUnit(value: number, label: string, allowOne: boolean): void {
  const valid =
    Number.isFinite(value) && value > 0 && (allowOne ? value <= 1 : value < 1);
  if (!valid) {
    throw new Error(
      `${label} must be a finite number > 0 and ${allowOne ? "<= 1" : "< 1"}, got ${value}.`,
    );
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

function toVec2(value: Vec2Like, label: string): Vec2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(
      `Feel transient visual: ${label} must contain finite x/y values.`,
    );
  }
  return new Vec2(value.x, value.y);
}

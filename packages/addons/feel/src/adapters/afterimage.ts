import { Transform, type Entity } from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  SpriteComponent,
  registerTexture,
  unregisterTexture,
  type BlendMode,
  type ColorValue,
  type DisplayAnimatedSprite,
  type DisplaySprite,
  type VisualOpacityModifierHandle,
  type VisualTransformModifierHandle,
} from "@yagejs/renderer";
import { defineFeelEffect } from "../core/node.js";
import type { FeelEffectContext, FeelNode } from "../core/types.js";

export type FeelAfterimageVisual = SpriteComponent | AnimatedSpriteComponent;

export type FeelAfterimageTarget =
  | FeelAfterimageVisual
  | ((context: FeelEffectContext) => FeelAfterimageVisual);

export interface FeelAfterimageOptions {
  /** Sprite or animated sprite whose current frame is copied. */
  target: FeelAfterimageTarget;
  /** Number of copies. Default: `5`. */
  count?: number;
  /** Seconds between copies. Default: `0.05`. */
  interval?: number;
  /** Lifetime of each copy in seconds. Default: `0.25`. */
  lifetime?: number;
  /** Copy tint. Default: `0x1e3a8a` (dark blue). */
  tint?: ColorValue;
  /** Starting copy opacity. Default: `0.55`. */
  alpha?: number;
  /** Scale at the end of each copy's life. Default: `1`. */
  endScale?: number;
  /** Render layer. Default: the target's layer. */
  layer?: string;
  /** Copy blend mode. Default: the target's blend mode. */
  blendMode?: BlendMode;
}

interface ActiveAfterimage {
  entity: Entity;
  opacity: VisualOpacityModifierHandle;
  scale: VisualTransformModifierHandle;
  textureKey: string;
  createdAt: number;
}

let nextTextureId = 1;

/** Leave fading copies of a sprite's current frame behind its rendered pose. */
export function feelAfterimage(options: FeelAfterimageOptions): FeelNode {
  const count = options.count ?? 5;
  const interval = options.interval ?? 0.05;
  const lifetime = options.lifetime ?? 0.25;
  const alpha = options.alpha ?? 0.55;
  const endScale = options.endScale ?? 1;
  validateInteger(count, "feelAfterimage: count", 1);
  validatePositive(interval, "feelAfterimage: interval");
  validatePositive(lifetime, "feelAfterimage: lifetime");
  validateUnit(alpha, "feelAfterimage: alpha");
  validatePositive(endScale, "feelAfterimage: endScale");
  const totalDuration = (count - 1) * interval + lifetime;

  return defineFeelEffect(totalDuration, (context) => {
    const active: ActiveAfterimage[] = [];
    let emitted = 0;

    const emit = (createdAt: number): void => {
      const target = resolveTarget(options.target, context);
      const display = getDisplay(target);
      const transform = target.entity.tryGet(Transform);
      if (!transform) {
        throw new Error(
          "feelAfterimage: the target entity needs a Transform component.",
        );
      }

      const textureKey = `@yagejs-addons/feel:afterimage:${nextTextureId++}`;
      let registered = false;
      let entity: Entity | undefined;
      try {
        registerTexture(textureKey, display.texture);
        registered = true;
        entity = context.entity.scene.spawn("feel:afterimage");
        const position = transform.worldPosition.add(
          target.modifiers.positionOffset,
        );
        entity.add(
          new Transform({
            position,
            rotation: transform.worldRotation + target.modifiers.rotationOffset,
            scale: transform.worldScale.multiply(target.modifiers.scaleFactor),
          }),
        );
        const visual = entity.add(
          new SpriteComponent({
            texture: textureKey,
            anchor: { x: display.anchor.x, y: display.anchor.y },
            layer: options.layer ?? target.layerName,
            tint: options.tint ?? 0x1e3a8a,
            alpha: Math.max(
              0,
              Math.min(
                1,
                alpha *
                  target.alpha *
                  target.modifiers.opacityFactor *
                  context.intensity,
              ),
            ),
            visible: target.visible && target.modifiers.visible,
            blendMode: options.blendMode ?? target.blendMode,
          }),
        );
        moveBehindSource(visual.sprite, target.renderObject);
        active.push({
          entity,
          opacity: visual.modifiers.addOpacity(),
          scale: visual.modifiers.addTransform(),
          textureKey,
          createdAt,
        });
      } catch (error) {
        entity?.destroy();
        if (registered) unregisterTexture(textureKey);
        throw error;
      }
    };

    const clear = (afterimage: ActiveAfterimage): void => {
      afterimage.opacity.remove();
      afterimage.scale.remove();
      afterimage.entity.destroy();
      unregisterTexture(afterimage.textureKey);
    };

    return {
      label: "sprite afterimage",
      start: () => {
        emit(0);
        emitted = 1;
      },
      update: (progress) => {
        const elapsed = progress * totalDuration;
        while (emitted < count && elapsed >= emitted * interval) {
          emit(emitted * interval);
          emitted++;
        }
        for (let index = active.length - 1; index >= 0; index--) {
          const afterimage = active[index];
          if (!afterimage) continue;
          const age = Math.max(0, elapsed - afterimage.createdAt) / lifetime;
          if (age >= 1) {
            clear(afterimage);
            active.splice(index, 1);
            continue;
          }
          afterimage.opacity.setFactor(1 - age);
          afterimage.scale.setScale(1 + (endScale - 1) * age);
        }
      },
      finish: () => {
        for (const afterimage of active) clear(afterimage);
        active.length = 0;
      },
    };
  });
}

function resolveTarget(
  source: FeelAfterimageTarget,
  context: FeelEffectContext,
): FeelAfterimageVisual {
  let target: FeelAfterimageVisual | undefined =
    typeof source === "function" ? undefined : source;
  if (typeof source === "function") {
    context.invoke("afterimage target source", () => {
      target = source(context);
    });
  }
  if (
    !(target instanceof SpriteComponent) &&
    !(target instanceof AnimatedSpriteComponent)
  ) {
    throw new Error(
      "feelAfterimage: target must resolve to SpriteComponent or AnimatedSpriteComponent.",
    );
  }
  return target;
}

function getDisplay(
  target: FeelAfterimageVisual,
): DisplaySprite | DisplayAnimatedSprite {
  return target instanceof SpriteComponent
    ? target.sprite
    : target.animatedSprite;
}

function moveBehindSource(
  copy: DisplaySprite,
  source: DisplaySprite | DisplayAnimatedSprite,
): void {
  const parent = source.parent;
  if (!parent || copy.parent !== parent) return;
  parent.setChildIndex(copy, parent.getChildIndex(source));
}

function validateInteger(value: number, label: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}, got ${value}.`);
  }
}

function validatePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number > 0, got ${value}.`);
  }
}

function validateUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1, got ${value}.`);
  }
}

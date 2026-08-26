import { describe, expect, it } from "vitest";
import { ErrorBoundaryKey, createMockEntity } from "@yagejs/core";
import { VisualModifierHost, type VisualComponent } from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import { feelParallel } from "../core/node.js";
import {
  feelPositionPunch,
  feelPositionSpring,
  feelRotationSpring,
  feelScalePunch,
  feelScaleShake,
  feelScaleSpring,
} from "./visual.js";

function visualTarget(): VisualComponent {
  return { modifiers: new VisualModifierHost() } as unknown as VisualComponent;
}

describe("Feel visual modifiers", () => {
  it("keeps overlapping plays as separate contributions", () => {
    const { entity } = createMockEntity();
    const target = visualTarget();
    const feel = entity.add(
      new Feel({
        move: {
          overlap: "allow",
          effect: feelPositionPunch({
            target,
            offset: { x: 10, y: 0 },
            duration: 1,
            peakAt: 1,
          }),
        },
      }),
    );

    const first = feel.play("move");
    feel.play("move");
    feel.update(0.5);
    expect(target.modifiers.positionOffset.x).toBe(15);
    expect(target.modifiers.size).toBe(2);

    first?.stop();
    expect(target.modifiers.positionOffset.x).toBe(7.5);
    expect(target.modifiers.size).toBe(1);

    feel.update(0.5);
    expect(target.modifiers.positionOffset.x).toBe(0);
    expect(target.modifiers.size).toBe(0);
  });

  it("removes a zero-scale contribution cleanly", () => {
    const { entity } = createMockEntity();
    const target = visualTarget();
    const feel = entity.add(
      new Feel({
        squash: feelScalePunch({
          target,
          scale: 0,
          duration: 1,
          peakAt: 1,
        }),
      }),
    );

    const playback = feel.play("squash");
    feel.update(1);

    expect(playback?.active).toBe(false);
    expect(target.modifiers.scaleFactor.x).toBe(1);
    expect(target.modifiers.size).toBe(0);
  });

  it("owns scale shake as a removable multiplicative contribution", () => {
    const { entity } = createMockEntity();
    const target = visualTarget();
    const feel = entity.add(
      new Feel({
        shake: feelScaleShake({
          target,
          amplitude: 0.2,
          frequency: 1,
          decay: 0,
          duration: 1,
        }),
      }),
    );

    const playback = feel.play("shake");
    feel.update(0.25);
    expect(target.modifiers.size).toBe(1);
    expect(target.modifiers.scaleFactor.x).not.toBe(1);

    playback?.stop();
    expect(target.modifiers.size).toBe(0);
    expect(target.modifiers.scaleFactor.x).toBe(1);
  });

  it("springs position, rotation, and scale back to neutral", () => {
    const { entity } = createMockEntity();
    const target = visualTarget();
    const feel = entity.add(
      new Feel({
        spring: feelParallel(
          feelPositionSpring({
            target,
            offset: { x: 10, y: -4 },
            duration: 1,
            oscillations: 1,
            decay: 1,
          }),
          feelRotationSpring({
            target,
            radians: 0.4,
            duration: 1,
            oscillations: 1,
            decay: 1,
          }),
          feelScaleSpring({
            target,
            scale: 1.5,
            duration: 1,
            oscillations: 1,
            decay: 1,
          }),
        ),
      }),
    );

    feel.play("spring");
    expect(target.modifiers.positionOffset.x).toBe(10);
    expect(target.modifiers.positionOffset.y).toBe(-4);
    expect(target.modifiers.rotationOffset).toBe(0.4);
    expect(target.modifiers.scaleFactor.x).toBe(1.5);
    expect(target.modifiers.size).toBe(3);

    feel.update(0.5);
    expect(target.modifiers.positionOffset.x).toBeCloseTo(-5);
    expect(target.modifiers.positionOffset.y).toBeCloseTo(2);
    expect(target.modifiers.rotationOffset).toBeCloseTo(-0.2);
    expect(target.modifiers.scaleFactor.x).toBeCloseTo(0.75);

    feel.update(0.5);
    expect(target.modifiers.positionOffset.x).toBe(0);
    expect(target.modifiers.rotationOffset).toBe(0);
    expect(target.modifiers.scaleFactor.x).toBe(1);
    expect(target.modifiers.size).toBe(0);
  });

  it("validates spring shape options", () => {
    const target = visualTarget();

    expect(() =>
      feelPositionSpring({
        target,
        offset: { x: 1, y: 0 },
        oscillations: 0,
      }),
    ).toThrow("oscillations must be a finite number > 0");
    expect(() =>
      feelRotationSpring({ target, radians: 1, decay: Number.NaN }),
    ).toThrow("decay must be a finite number > 0");
  });

  it("attributes visual target functions as developer callbacks", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const feel = entity.add(
      new Feel({
        shake: feelScaleShake({
          target: () => {
            throw new Error("missing visual");
          },
        }),
      }),
    );

    expect(() => feel.play("shake")).toThrow("missing visual");
    expect(boundary.getCallbackErrors()[0]?.kind).toBe(
      "Feel callback (visual target source)",
    );
  });
});

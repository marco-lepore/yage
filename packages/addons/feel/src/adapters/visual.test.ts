import { describe, expect, it, vi } from "vitest";
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
  feelBounce,
  feelRecoil,
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

  it("forwards pulse timing through recoil and bounce", () => {
    const { entity } = createMockEntity();
    const recoilTarget = visualTarget();
    const bounceTarget = visualTarget();
    const recoilAttack = vi.fn((progress: number) => progress * 0.4);
    const recoilRelease = vi.fn((progress: number) => progress * 0.2);
    const bounceAttack = vi.fn((progress: number) => progress * 0.6);
    const bounceRelease = vi.fn((progress: number) => progress * 0.4);
    const feel = entity.add(
      new Feel({
        recoil: feelRecoil({
          target: recoilTarget,
          direction: { x: 1, y: 0 },
          distance: 10,
          duration: 1,
          peakAt: 0.5,
          attackEasing: recoilAttack,
          releaseEasing: recoilRelease,
        }),
        bounce: feelBounce({
          target: bounceTarget,
          distance: 10,
          duration: 1,
          peakAt: 0.5,
          attackEasing: bounceAttack,
          releaseEasing: bounceRelease,
        }),
      }),
    );

    feel.play("recoil");
    feel.play("bounce");
    recoilAttack.mockClear();
    bounceAttack.mockClear();
    feel.update(0.25);
    expect(recoilAttack).toHaveBeenLastCalledWith(0.5);
    expect(bounceAttack).toHaveBeenLastCalledWith(0.5);
    expect(recoilTarget.modifiers.positionOffset.x).toBeCloseTo(-2);
    expect(bounceTarget.modifiers.positionOffset.y).toBeCloseTo(-3);

    feel.update(0.5);
    expect(recoilRelease).toHaveBeenLastCalledWith(0.5);
    expect(bounceRelease).toHaveBeenLastCalledWith(0.5);
    expect(recoilTarget.modifiers.positionOffset.x).toBeCloseTo(-9);
    expect(bounceTarget.modifiers.positionOffset.y).toBeCloseTo(-8);
  });

  it("preserves recoil and bounce pulse defaults", () => {
    const { entity } = createMockEntity();
    const recoilTarget = visualTarget();
    const bounceTarget = visualTarget();
    const recoil = feelRecoil({
      target: recoilTarget,
      direction: { x: 1, y: 0 },
    });
    const bounce = feelBounce({ target: bounceTarget });
    const feel = entity.add(new Feel({ recoil, bounce }));

    feel.play("recoil");
    feel.play("bounce");
    feel.update(0.0225);

    expect(recoil.duration).toBe(0.18);
    expect(bounce.duration).toBe(0.18);
    expect(recoilTarget.modifiers.positionOffset.x).toBeCloseTo(-6);
    expect(bounceTarget.modifiers.positionOffset.y).toBeCloseTo(-6);
  });

  it("names thin pulse wrappers in construction errors", () => {
    const target = visualTarget();

    expect(() =>
      feelRecoil({
        target,
        direction: { x: 1, y: 0 },
        peakAt: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(
      "feelRecoil: peakAt must be a finite number between 0 and 1, got Infinity.",
    );
    expect(() => feelBounce({ target, duration: -1 })).toThrow(
      "feelBounce: duration must be a finite number >= 0, got -1.",
    );
  });
});

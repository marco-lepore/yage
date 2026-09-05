import { describe, expect, it, vi } from "vitest";
import { ErrorBoundaryKey, createMockEntity } from "@yagejs/core";
import type { AnimationController } from "@yagejs/renderer";
import { Feel } from "../Feel.js";
import { feelSpriteAnimation } from "./animation.js";

function mockController() {
  return {
    play: vi.fn(),
    forcePlay: vi.fn(),
    playOneShot: vi.fn(),
  } as unknown as AnimationController<"idle" | "stagger">;
}

describe("feelSpriteAnimation", () => {
  it("forwards cancellation without changing the retimed cue duration and attributes a throw", () => {
    const { entity, context } = createMockEntity();
    const controller = mockController();
    const error = new Error("cancel failed");
    const cancelled = vi.fn(() => {
      throw error;
    });
    const completed = vi.fn();
    const feel = entity.add(
      new Feel({
        shot: feelSpriteAnimation("stagger", {
          target: controller,
          mode: "oneShot",
          duration: 0.2,
          onComplete: completed,
          onCancel: cancelled,
        }),
      }),
    );
    feel.play("shot", { duration: 0.4 });
    const options = vi.mocked(controller.playOneShot).mock.calls[0]?.[1];
    expect(options?.duration).toBe(0.4);
    expect(() => options?.onCancel?.()).toThrow(error);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    expect(context.resolve(ErrorBoundaryKey).getCallbackErrors()).toMatchObject(
      [{ kind: "Feel callback (sprite animation cancellation)" }],
    );
  });

  it.each(["play", "force"] as const)(
    "rejects cancellation callbacks in %s mode",
    (mode) => {
      expect(() =>
        feelSpriteAnimation("idle", { mode, onCancel() {} }),
      ).toThrow(/require mode "oneShot"/);
    },
  );
  it("plays a named sprite animation", () => {
    const { entity } = createMockEntity();
    const controller = mockController();
    const feel = entity.add(
      new Feel({
        stagger: feelSpriteAnimation("stagger", { target: controller }),
      }),
    );

    feel.play("stagger");

    expect(controller.play).toHaveBeenCalledWith("stagger");
  });

  it("supports forced and one-shot playback", () => {
    const { entity } = createMockEntity();
    const controller = mockController();
    const completed = vi.fn();
    const feel = entity.add(
      new Feel({
        forced: feelSpriteAnimation("stagger", {
          target: controller,
          mode: "force",
        }),
        oneShot: feelSpriteAnimation("stagger", {
          target: controller,
          mode: "oneShot",
          duration: 0.2,
          onComplete: completed,
        }),
      }),
    );

    feel.play("forced");
    feel.play("oneShot");

    expect(controller.forcePlay).toHaveBeenCalledWith("stagger");
    expect(controller.playOneShot).toHaveBeenCalledWith("stagger", {
      duration: 0.2,
      onComplete: expect.any(Function),
    });
    const options = vi.mocked(controller.playOneShot).mock.calls[0]?.[1];
    options?.onComplete?.();
    expect(completed).toHaveBeenCalledOnce();
  });

  it("passes a play-time duration override to a one-shot animation", () => {
    const { entity } = createMockEntity();
    const controller = mockController();
    const feel = entity.add(
      new Feel({
        oneShot: feelSpriteAnimation("stagger", {
          target: controller,
          mode: "oneShot",
          duration: 0.2,
        }),
      }),
    );

    feel.play("oneShot", { duration: 0.4 });

    expect(controller.playOneShot).toHaveBeenCalledWith("stagger", {
      duration: 0.4,
    });
  });

  it("attributes target and completion callbacks", () => {
    const { entity, context } = createMockEntity();
    const boundary = context.resolve(ErrorBoundaryKey);
    const controller = mockController();
    const feel = entity.add(
      new Feel({
        brokenTarget: feelSpriteAnimation("stagger", {
          target: () => {
            throw new Error("target failed");
          },
        }),
        brokenCompletion: feelSpriteAnimation("stagger", {
          target: controller,
          mode: "oneShot",
          onComplete: () => {
            throw new Error("completion failed");
          },
        }),
      }),
    );

    expect(() => feel.play("brokenTarget")).toThrow("target failed");
    feel.play("brokenCompletion");
    const options = vi.mocked(controller.playOneShot).mock.calls[0]?.[1];
    expect(() => options?.onComplete?.()).toThrow("completion failed");
    expect(boundary.getCallbackErrors().map((error) => error.kind)).toEqual([
      "Feel callback (sprite animation target)",
      "Feel callback (sprite animation completion)",
    ]);
  });

  it("rejects one-shot-only options on other modes", () => {
    expect(() => feelSpriteAnimation("stagger", { duration: 0.2 })).toThrow(
      /require mode "oneShot"/,
    );
    expect(() =>
      feelSpriteAnimation("stagger", {
        mode: "oneShot",
        duration: Number.NaN,
      }),
    ).toThrow(/duration must be finite/);
  });
});

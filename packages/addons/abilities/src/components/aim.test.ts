import { describe, expect, it, vi } from "vitest";
import { Vec2, createMockEntity } from "@yagejs/core";
import type { StepContext } from "../core/types.js";
import { Facing } from "./Facing.js";
import { resolveAim } from "./aim.js";

describe("resolveAim", () => {
  it("normalizes an explicit Vec2 aim", () => {
    const result = resolveAim(new Vec2(0, 4), {} as StepContext);
    expect(result).toEqual(new Vec2(0, 1));
  });

  it("normalizes an explicit plain {x, y} aim", () => {
    const result = resolveAim({ x: 3, y: 0 }, {} as StepContext);
    expect(result).toEqual(new Vec2(1, 0));
  });

  it("calls a resolver function with the passed context and normalizes its result", () => {
    const { entity } = createMockEntity();
    const ctx = { entity } as StepContext;
    const resolver = vi.fn(() => ({ x: 0, y: 2 }));

    const result = resolveAim(resolver, ctx);

    expect(resolver).toHaveBeenCalledExactlyOnceWith(ctx);
    expect(result).toEqual(new Vec2(0, 1));
  });

  it("snapshots a resolver's result — later state changes don't affect the returned vector", () => {
    let dir = { x: 1, y: 0 };
    const result = resolveAim(() => dir, {} as StepContext);
    dir = { x: 0, y: 1 };
    expect(result).toEqual(new Vec2(1, 0));
  });

  it("falls back to a sibling Facing when aim is omitted", () => {
    const { entity } = createMockEntity();
    const facing = entity.add(new Facing());
    facing.set(0, -3);

    const result = resolveAim(undefined, { entity } as StepContext);

    expect(result).toEqual(new Vec2(0, -1));
  });

  it("throws when aim is omitted and there is no Facing", () => {
    const { entity } = createMockEntity();

    expect(() => resolveAim(undefined, { entity } as StepContext)).toThrow(
      /Facing.*aim/,
    );
  });

  it("throws when an explicit aim resolves to a zero vector", () => {
    expect(() =>
      resolveAim({ x: 0, y: 0 }, {} as StepContext),
    ).toThrow(/zero vector/);
  });
});

import { describe, expect, it } from "vitest";
import type { Hit } from "./types.js";
import type { HitStage } from "./resolve.js";
import { resolveHit } from "./resolve.js";

function makeHit(over: Partial<Hit> = {}): Hit {
  return {
    source: {} as Hit["source"],
    direction: { x: 1, y: 0 } as Hit["direction"],
    tags: [],
    data: {},
    ...over,
  };
}

describe("resolveHit", () => {
  it("resolves to 'hit' when every stage returns void", () => {
    const order: string[] = [];
    const stages: HitStage[] = [
      () => {
        order.push("a");
      },
      () => {
        order.push("b");
      },
    ];
    expect(resolveHit(makeHit(), stages, undefined)).toBe("hit");
    expect(order).toEqual(["a", "b"]);
  });

  it("stops at the first stage returning a result; later stages don't run", () => {
    const order: string[] = [];
    const stages: HitStage[] = [
      () => {
        order.push("a");
        return "ignored";
      },
      () => {
        order.push("b");
      },
    ];
    expect(resolveHit(makeHit(), stages, undefined)).toBe("ignored");
    expect(order).toEqual(["a"]);
  });

  it("an empty chain resolves to 'hit'", () => {
    expect(resolveHit(makeHit(), [], undefined)).toBe("hit");
  });

  it("passes the same ctx to every stage", () => {
    const ctx = { tag: "receiver" };
    const seen: unknown[] = [];
    const stages: HitStage<Hit["data"], typeof ctx>[] = [
      (_hit, c) => {
        seen.push(c);
      },
    ];
    resolveHit(makeHit(), stages, ctx);
    expect(seen).toEqual([ctx]);
  });

  it("a stage may mutate hit.data in place; the mutation is visible to later stages", () => {
    const hit = makeHit({ data: { damage: 10 } });
    const stages: HitStage[] = [
      (h) => {
        h.data.damage = (h.data.damage ?? 0) / 2;
      },
      () => {},
    ];
    resolveHit(hit, stages, undefined);
    expect(hit.data.damage).toBe(5);
  });
});

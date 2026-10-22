import { describe, expect, it, vi } from "vitest";
import { createRandomService, ErrorBoundary, Logger } from "@yagejs/core";
import { LootTables } from "./LootTables.js";
import type { LootEntry, LootTable } from "./types.js";

const item = (id: string, weight = 1) => ({
  id,
  kind: "item" as const,
  item: id,
  weight,
});
const make = (
  entries: readonly LootEntry<string>[],
  rolls = 1,
  unique = false,
) =>
  new LootTables<string>({
    chest: { pools: [{ id: "rewards", entries, rolls, unique }] },
  });
const fixed = (value: number) => ({ float: () => value });
const quiet = () => new ErrorBoundary(new Logger({ output: () => {} }));

describe("LootTables", () => {
  it("uses half-open weight intervals and excludes zero weights at zero", () => {
    const model = make([item("off", 0), item("a", 1), item("b", 3)]);
    for (const [roll, expected] of [
      [0, "a"],
      [0.249, "a"],
      [0.25, "b"],
      [1 - Number.EPSILON, "b"],
    ] as const) {
      const result = model.roll("chest", { random: fixed(roll) });
      expect(result.rewards[0]?.item).toBe(expected);
      expect(result.trace[0]?.candidates.map((c) => c.probability)).toEqual([
        0, 0.25, 0.75,
      ]);
      expect(result.randomDraws).toBe(1);
    }
  });

  it("replays a complete nested result with the same seeded generator", () => {
    const model = new LootTables<string>({
      chest: {
        pools: [
          {
            id: "coins",
            entries: [
              {
                id: "coins",
                kind: "item",
                item: "coin",
                quantity: { min: 2, max: 8 },
              },
            ],
          },
          {
            id: "bonus",
            rolls: { min: 2, max: 4 },
            entries: [
              { id: "gear", kind: "table", table: "gear" },
              { id: "none", kind: "empty" },
            ],
          },
        ],
      },
      gear: {
        pools: [{ id: "gear", entries: [item("sword"), item("shield")] }],
      },
    });
    const a = createRandomService(13);
    const b = createRandomService(13);
    for (let i = 0; i < 100; i++) {
      const result = model.roll("chest", { random: a });
      expect(result).toEqual(model.roll("chest", { random: b }));
      expect(result.rewards[0]?.quantity).toBeGreaterThanOrEqual(2);
      expect(result.rewards[0]?.quantity).toBeLessThanOrEqual(8);
      for (const trace of result.trace.filter(
        (entry) => entry.table === "gear",
      )) {
        expect(trace.parent).toMatchObject({
          table: "chest",
          pool: "bonus",
          entry: "gear",
          invocation: 0,
        });
      }
    }
  });

  it("samples inclusive count endpoints; constant counts consume no random draw", () => {
    const model = new LootTables({
      chest: {
        pools: [
          {
            id: "p",
            rolls: { min: 1, max: 2 },
            entries: [
              {
                id: "a",
                kind: "item",
                item: "a",
                quantity: { min: 0, max: 3 },
              },
            ],
          },
        ],
      },
    });
    expect(model.roll("chest", { random: fixed(0) })).toMatchObject({
      rewards: [],
      randomDraws: 3,
    });
    const result = model.roll("chest", { random: fixed(1 - Number.EPSILON) });
    expect(result.rewards.map((r) => r.quantity)).toEqual([3, 3]);
    expect(result.randomDraws).toBe(5);
    expect(
      make([item("a")]).roll("chest", { random: fixed(0) }).randomDraws,
    ).toBe(1);
  });

  it("removes entry identity without replacement, reports exhaustion and resets on each call", () => {
    const model = make(
      [item("a"), item("b"), { id: "none", kind: "empty" }],
      5,
      true,
    );
    const result = model.roll("chest", { random: fixed(0) });
    expect(result.rewards.map((r) => r.item)).toEqual(["a", "b"]);
    expect(result.trace.map((r) => r.status)).toEqual([
      "selected",
      "selected",
      "selected",
      "no-eligible",
    ]);
    expect(result.trace[1]?.candidates[0]?.status).toBe("already-selected");
    expect(result.randomDraws).toBe(3);
    expect(model.roll("chest", { random: fixed(0) })).toEqual(result);
  });

  it("keeps uniqueness local to each nested invocation, not item equality", () => {
    const model = new LootTables<string>({
      root: {
        pools: [
          {
            id: "p",
            rolls: 2,
            entries: [{ id: "child", kind: "table", table: "child" }],
          },
        ],
      },
      child: {
        pools: [
          {
            id: "p",
            rolls: 2,
            unique: true,
            entries: [
              { ...item("a"), item: "same" },
              { ...item("b"), item: "same" },
            ],
          },
        ],
      },
    });
    expect(
      model.roll("root", { random: fixed(0) }).rewards.map((r) => r.item),
    ).toEqual(["same", "same", "same", "same"]);
  });

  it("reports pool and entry refusals and evaluates policies once per invocation", () => {
    const when = vi.fn((level: number) => level >= 3 || "requires-level-3");
    const weight = vi.fn((level: number) => level);
    const model = new LootTables<string, number>({
      chest: {
        pools: [
          { id: "skip", when: () => false, entries: [item("skip")] },
          { id: "zero", rolls: 0, entries: [item("zero")] },
          {
            id: "pick",
            rolls: 3,
            entries: [
              { id: "rare", kind: "item", item: "rare", when },
              { id: "common", kind: "item", item: "common", weight },
            ],
          },
        ],
      },
    });
    const result = model.roll("chest", { random: fixed(0), context: 1 });
    expect(result.trace[0]).toMatchObject({
      status: "condition",
      reason: "condition-failed",
    });
    expect(result.trace[1]?.status).toBe("zero-rolls");
    expect(result.trace[2]?.candidates[0]).toMatchObject({
      status: "condition",
      reason: "requires-level-3",
      probability: 0,
    });
    expect(when).toHaveBeenCalledTimes(1);
    expect(weight).toHaveBeenCalledTimes(1);
    expect(result.rewards.map((r) => r.item)).toEqual([
      "common",
      "common",
      "common",
    ]);
  });

  it("returns an explained empty result without drawing from an empty eligible pool", () => {
    for (const entries of [
      [],
      [item("off", 0)],
      [{ ...item("a"), when: () => false }],
    ]) {
      const random = { float: vi.fn(() => 0) };
      expect(make(entries).roll("chest", { random })).toMatchObject({
        rewards: [],
        randomDraws: 0,
        trace: [{ status: "no-eligible" }],
      });
      expect(random.float).not.toHaveBeenCalled();
    }
  });

  it("copies definition structure and leaves game items opaque", () => {
    const payload = { name: "sword" };
    const entry = {
      id: "a",
      kind: "item" as const,
      item: payload,
      quantity: { min: 2, max: 2 },
    };
    const input = { chest: { pools: [{ id: "p", entries: [entry] }] } };
    const model = new LootTables(input);
    entry.quantity.min = 999;
    input.chest.pools.length = 0;
    const result = model.roll("chest", { random: fixed(0) });
    expect(result.rewards[0]?.quantity).toBe(2);
    expect(result.rewards[0]?.item).toBe(payload);
    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(result.trace[0]?.candidates[0])).toBe(true);
  });

  it("rejects missing nested references and cycles even in disabled entries", () => {
    expect(
      () =>
        new LootTables<string>({
          a: {
            pools: [
              {
                id: "p",
                entries: [
                  { id: "bad", kind: "table", table: "missing", weight: 0 },
                ],
              },
            ],
          },
        }),
    ).toThrow(/a\/p\/bad.*unknown table missing/);
    expect(
      () =>
        new LootTables<string>({
          a: {
            pools: [
              { id: "p", entries: [{ id: "b", kind: "table", table: "b" }] },
            ],
          },
          b: {
            pools: [
              { id: "p", entries: [{ id: "a", kind: "table", table: "a" }] },
            ],
          },
        }),
    ).toThrow(/cycle a -> b -> a/);
  });

  it.each([-1, NaN, Infinity, -Infinity])("rejects weight %s", (value) => {
    expect(() => make([item("bad", value)])).toThrow(
      /weight must be finite and nonnegative/,
    );
  });

  it.each([
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
    { min: 3, max: 1 },
    { min: 0, max: Infinity },
  ])("rejects malformed count %j", (value) => {
    expect(
      () =>
        new LootTables({
          a: { pools: [{ id: "p", rolls: value, entries: [] }] },
        }),
    ).toThrow();
    expect(
      () =>
        new LootTables({
          a: {
            pools: [
              {
                id: "p",
                entries: [
                  { id: "a", kind: "item", item: "a", quantity: value },
                ],
              },
            ],
          },
        }),
    ).toThrow();
  });

  it("rejects malformed JS definitions with authored locations", () => {
    for (const entries of [
      [item("a"), item("a")],
      [{ ...item("a"), kind: "wat" }],
      [{ ...item("a"), weight: null }],
      [{ ...item("a"), when: 1 }],
      new Array(1),
    ]) {
      const invalid = {
        a: { pools: [{ id: "p", entries }] },
      } as unknown as Record<string, LootTable<string>>;
      expect(() => new LootTables(invalid)).toThrow(/LootTables.a\/p/);
    }
  });

  it("allows finite weights whose unscaled sum would overflow", () => {
    const result = make([
      item("a", Number.MAX_VALUE),
      item("b", Number.MAX_VALUE),
    ]).roll("chest", { random: fixed(0.75) });
    expect(result.rewards[0]?.item).toBe("b");
    expect(result.trace[0]?.candidates.map((c) => c.probability)).toEqual([
      0.5, 0.5,
    ]);
  });

  it("expands a long chain of nested tables", () => {
    const tables: Record<string, LootTable<string>> = {};
    for (let i = 0; i < 200; i++)
      tables[String(i)] = {
        pools: [
          {
            id: "p",
            entries:
              i === 199
                ? [item("end")]
                : [{ id: "next", kind: "table", table: String(i + 1) }],
          },
        ],
      };
    const result = new LootTables(tables).roll("0", { random: fixed(0) });
    expect(result.trace).toHaveLength(200);
    expect(result.rewards[0]?.source.invocation).toBe(199);
  });

  it("attributes throwing/invalid policy and random callbacks and stops subsequent work", () => {
    const boundary = quiet();
    const later = vi.fn(() => true);
    const error = new Error("bad predicate");
    const model = new LootTables({
      a: {
        pools: [
          {
            id: "p",
            entries: [
              {
                ...item("bad"),
                when: () => {
                  throw error;
                },
              },
            ],
          },
          { id: "later", entries: [item("a")], when: later },
        ],
      },
    });
    expect(() =>
      model.roll("a", { random: fixed(0), errorBoundary: boundary }),
    ).toThrow(error);
    expect(later).not.toHaveBeenCalled();
    expect(boundary.getCallbackErrors()).toMatchObject([
      { kind: "Loot condition", event: "a/p/bad", error: "bad predicate" },
    ]);
    for (const value of [NaN, Infinity, -0.1, 1]) {
      expect(() =>
        make([item("a")]).roll("chest", {
          random: fixed(value),
          errorBoundary: boundary,
        }),
      ).toThrow(/random.float/);
    }
    const badWeight = make([{ ...item("bad"), weight: () => NaN }]);
    expect(() =>
      badWeight.roll("chest", { random: fixed(0), errorBoundary: boundary }),
    ).toThrow(/weight/);
    expect(boundary.getCallbackErrors().at(-1)?.kind).toBe("Loot weight");
  });

  it("logs a callback failure with its path when a roll passes no boundary", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = new Error("bad predicate");
      const model = new LootTables({
        a: {
          pools: [
            {
              id: "p",
              entries: [
                {
                  ...item("bad"),
                  when: () => {
                    throw error;
                  },
                },
              ],
            },
          ],
        },
      });
      expect(() => model.roll("a", { random: fixed(0) })).toThrow(error);
      expect(log.mock.calls.flat().join(" ")).toContain("a/p/bad");
    } finally {
      log.mockRestore();
    }
  });

  it("matches weighted frequencies over a deterministic sample", () => {
    const model = make([
      item("common", 7),
      item("rare", 2),
      { id: "none", kind: "empty", weight: 1 },
    ]);
    const rng = createRandomService(98765);
    const counts = { common: 0, rare: 0, none: 0 };
    for (let i = 0; i < 20000; i++) {
      const result = model.roll("chest", { random: rng });
      const trace = result.trace[0];
      if (trace?.status !== "selected") throw new Error("expected a draw");
      counts[trace.entry as keyof typeof counts]++;
      expect(result.rewards.length).toBeLessThanOrEqual(1);
    }
    expect(counts.common / 20000).toBeCloseTo(0.7, 1);
    expect(counts.rare / 20000).toBeCloseTo(0.2, 1);
    expect(counts.none / 20000).toBeCloseTo(0.1, 1);
  });
});

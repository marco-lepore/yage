import { describe, expect, it, vi } from "vitest";
import {
  createMockEntity,
  createTestEngine,
  ErrorBoundaryKey,
  InspectorKey,
  InspectorPlugin,
  Scene,
} from "@yagejs/core";
import { LootTables } from "./core/LootTables.js";
import { LootComponent, LootRolledEvent } from "./LootComponent.js";

const model = () =>
  new LootTables({
    chest: {
      pools: [
        { id: "p", entries: [{ id: "coin", kind: "item", item: "coin" }] },
      ],
    },
  });

describe("LootComponent", () => {
  it("uses scene randomness and emits after publishing the completed result", () => {
    const { entity } = createMockEntity();
    const loot = entity.add(new LootComponent(model()));
    const listener = vi.fn(() =>
      expect(loot.lastRoll?.rewards[0]?.item).toBe("coin"),
    );
    entity.on(LootRolledEvent, listener);
    const result = loot.roll("chest");
    expect(result).toBe(loot.lastRoll);
    expect(listener).toHaveBeenCalledWith({ table: "chest", rewardCount: 1 });
  });

  it("rejects unattached, disabled, inactive, removed and destroyed hosts", () => {
    expect(() => new LootComponent(model()).roll("chest")).toThrow(/attached/);
    const { entity } = createMockEntity();
    const loot = entity.add(new LootComponent(model()));
    loot.enabled = false;
    expect(() => loot.roll("chest")).toThrow(/enabled/);
    loot.enabled = true;
    entity.setActive(false);
    expect(() => loot.roll("chest")).toThrow(/enabled/);
    entity.setActive(true);
    expect(loot.roll("chest").rewards).toHaveLength(1);
    loot.destroy();
    expect(() => loot.roll("chest")).toThrow(/enabled/);
    const other = entity.add(new LootComponent(model()));
    entity.destroy();
    expect(() => other.roll("chest")).toThrow(/live/);
  });

  it("shares models without changing their boundary and attributes policy errors to the engine", () => {
    const { entity, scene, context } = createMockEntity();
    const tables = new LootTables<string, boolean>({
      chest: {
        pools: [
          {
            id: "p",
            entries: [
              {
                id: "a",
                kind: "item",
                item: "a",
                when: (ok) => {
                  if (!ok) throw new Error("broken");
                  return true;
                },
              },
            ],
          },
        ],
      },
    });
    const boundary = tables.errorBoundary;
    const loot = entity.add(new LootComponent(tables));
    const other = scene.spawn("other").add(new LootComponent(tables));
    const previous = loot.roll("chest", true);
    expect(() => loot.roll("chest", false)).toThrow("broken");
    expect(loot.lastRoll).toBe(previous);
    expect(tables.errorBoundary).toBe(boundary);
    expect(boundary.getCallbackErrors()).toEqual([]);
    expect(context.resolve(ErrorBoundaryKey).getCallbackErrors()).toMatchObject(
      [
        {
          kind: "Loot condition",
          event: "chest/p/a",
          entity: entity.name,
          scene: scene.name,
        },
      ],
    );
    expect(other.roll("chest", true).rewards).toHaveLength(1);
  });

  it("accepts a custom model and explicit RNG without a registry", () => {
    const { entity } = createMockEntity();
    const random = { float: () => 0 };
    const result = { table: "custom", rewards: [], trace: [], randomDraws: 0 };
    const roll = vi.fn(() => result);
    const loot = entity.add(
      new LootComponent({ tableIds: ["custom"], roll }, random),
    );
    expect(loot.roll("custom")).toBe(result);
    expect(roll.mock.calls[0]).toBeDefined();
  });

  it("keeps Inspector explanations readable for opaque non-JSON rewards", async () => {
    class LootScene extends Scene {
      readonly name = "loot";
    }
    const engine = await createTestEngine(undefined, [new InspectorPlugin()]);
    const scene = new LootScene();
    await engine.scenes.push(scene);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const toJSON = vi.fn(() => {
      throw new Error("item must remain opaque");
    });
    try {
      for (const item of [cyclic, 42n, { toJSON }]) {
        const entity = scene.spawn("chest");
        const loot = entity.add(
          new LootComponent(
            new LootTables({
              chest: {
                pools: [
                  {
                    id: "reward",
                    entries: [
                      { id: "opaque", kind: "item", item, quantity: 2 },
                    ],
                  },
                ],
              },
            }),
          ),
        );
        expect(loot.diagnostics).toBeNull();
        const result = loot.roll("chest");
        expect(loot.lastRoll?.rewards[0]?.item).toBe(item);
        const data = engine.context
          .resolve(InspectorKey)
          .getComponentData(entity.id, "LootComponent");
        expect(data).toMatchObject({
          diagnostics: {
            table: "chest",
            randomDraws: 1,
            rewards: [{ quantity: 2, source: { entry: "opaque" } }],
            trace: result.trace,
          },
        });
        expect(data).not.toHaveProperty("lastRoll");
        expect(data).not.toHaveProperty("diagnostics.rewards.0.item");
      }
      expect(toJSON).not.toHaveBeenCalled();
    } finally {
      engine.destroy();
    }
  });
});

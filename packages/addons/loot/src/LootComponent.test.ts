import { describe, expect, it, vi } from "vitest";
import {
  createMockEntity,
  createTestEngine,
  ErrorBoundaryKey,
  InspectorKey,
  InspectorPlugin,
  RandomKey,
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
    const { entity, scene } = createMockEntity();
    const float = vi.spyOn(scene._resolveScoped(RandomKey)!, "float");
    const loot = entity.add(new LootComponent({ model: model() }));
    const listener = vi.fn(() =>
      expect(loot.lastRoll?.rewards[0]?.item).toBe("coin"),
    );
    entity.on(LootRolledEvent, listener);
    const result = loot.roll("chest");
    expect(result).toBe(loot.lastRoll);
    expect(float).toHaveBeenCalledTimes(result.randomDraws);
    expect(listener).toHaveBeenCalledWith({
      table: "chest",
      rewards: result.rewards,
    });
  });

  it("rejects unattached, disabled, inactive, removed and destroyed hosts", () => {
    const refused =
      "LootComponent.roll: component must be attached and enabled on a live scene entity";
    expect(() => new LootComponent({ model: model() }).roll("chest")).toThrow(
      refused,
    );
    const { entity } = createMockEntity();
    const loot = entity.add(new LootComponent({ model: model() }));
    loot.enabled = false;
    expect(() => loot.roll("chest")).toThrow(refused);
    loot.enabled = true;
    entity.setActive(false);
    expect(() => loot.roll("chest")).toThrow(refused);
    entity.setActive(true);
    expect(loot.roll("chest").rewards).toHaveLength(1);
    loot.destroy();
    expect(() => loot.roll("chest")).toThrow(refused);
    const other = entity.add(new LootComponent({ model: model() }));
    entity.destroy();
    expect(() => other.roll("chest")).toThrow(refused);
  });

  it("shares one model and records policy errors on the engine boundary", () => {
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
    const loot = entity.add(new LootComponent({ model: tables }));
    const other = scene
      .spawn("other")
      .add(new LootComponent({ model: tables }));
    const previous = loot.roll("chest", true);
    expect(() => loot.roll("chest", false)).toThrow("broken");
    expect(loot.lastRoll).toBe(previous);
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
    // A component found by class has unknown types and accepts any context.
    expect(entity.get(LootComponent).roll("chest", true).rewards).toHaveLength(
      1,
    );
  });

  it("passes an explicit random source to a custom model", () => {
    const { entity } = createMockEntity();
    const random = { float: () => 0 };
    const result = { table: "custom", rewards: [], trace: [], randomDraws: 0 };
    const roll = vi.fn(() => result);
    const loot = entity.add(new LootComponent({ model: { roll }, random }));
    expect(loot.roll("custom")).toBe(result);
    expect(roll).toHaveBeenCalledWith(
      "custom",
      expect.objectContaining({ random }),
    );
  });

  it("shows the last roll, items included, through the Inspector", async () => {
    class LootScene extends Scene {
      readonly name = "loot";
    }
    const engine = await createTestEngine(undefined, [new InspectorPlugin()]);
    try {
      const scene = new LootScene();
      await engine.scenes.push(scene);
      const entity = scene.spawn("chest");
      const loot = entity.add(
        new LootComponent({
          model: new LootTables({
            chest: {
              pools: [
                {
                  id: "reward",
                  entries: [
                    {
                      id: "sword",
                      kind: "item",
                      item: { name: "sword", damage: 3 },
                      quantity: 2,
                    },
                  ],
                },
              ],
            },
          }),
        }),
      );
      const inspector = engine.context.resolve(InspectorKey);
      expect(
        inspector.getComponentData(entity.id, "LootComponent"),
      ).toMatchObject({ lastRoll: null });
      const result = loot.roll("chest");
      const data = inspector.getComponentData(entity.id, "LootComponent");
      expect(data).toEqual({
        enabled: true,
        effectiveEnabled: true,
        lastRoll: JSON.parse(JSON.stringify(result)),
      });
      expect(data).toMatchObject({
        lastRoll: { rewards: [{ item: { name: "sword" }, quantity: 2 }] },
      });
    } finally {
      engine.destroy();
    }
  });
});

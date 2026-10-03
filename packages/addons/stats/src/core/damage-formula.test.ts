import { describe, expect, it } from "vitest";
import { FormulaGraph } from "./FormulaGraph.js";
import { Stats } from "./Stats.js";

// Game-authored rules: the addon assigns no meaning to damage, elements, or levels.
type ActorStat = "attack" | "maxHp" | "bonus" | "critDamage" | "mastery";
type DamageNode =
  | "scaling"
  | "reaction"
  | "bonus"
  | "critical"
  | "defense"
  | "resistance"
  | "damage";
interface HitContext {
  attacker: Readonly<Record<ActorStat, number>>;
  target: { level: number; resistance: number; defenseReduction: number };
  level: number;
  talent: number;
  hpScaling: number;
  flat: number;
  critical: boolean;
  amplify: boolean;
}

const damage = new FormulaGraph<DamageNode, HitContext>({
  scaling: {
    dependencies: [],
    evaluate: (_, hit) =>
      hit.attacker.attack * hit.talent +
      hit.attacker.maxHp * hit.hpScaling +
      hit.flat,
  },
  reaction: {
    dependencies: [],
    evaluate: (_, hit) =>
      hit.amplify
        ? 1.5 *
          (1 + (2.78 * hit.attacker.mastery) / (hit.attacker.mastery + 1400))
        : 1,
  },
  bonus: { dependencies: [], evaluate: (_, hit) => 1 + hit.attacker.bonus },
  critical: {
    dependencies: [],
    evaluate: (_, hit) => (hit.critical ? 1 + hit.attacker.critDamage : 1),
  },
  defense: {
    dependencies: [],
    evaluate: (_, hit) =>
      (hit.level + 100) /
      (hit.level +
        100 +
        (hit.target.level + 100) * (1 - hit.target.defenseReduction)),
  },
  resistance: {
    dependencies: [],
    evaluate: (_, hit) => {
      const resistance = hit.target.resistance;
      return resistance < 0
        ? 1 - resistance / 2
        : resistance < 0.75
          ? 1 - resistance
          : 1 / (4 * resistance + 1);
    },
  },
  damage: {
    dependencies: [
      "scaling",
      "reaction",
      "bonus",
      "critical",
      "defense",
      "resistance",
    ],
    evaluate: (get) =>
      get("scaling") *
      get("reaction") *
      get("bonus") *
      get("critical") *
      get("defense") *
      get("resistance"),
  },
});

function attacker() {
  return new Stats<ActorStat>({
    attack: { base: 800 },
    maxHp: { base: 10000 },
    bonus: { base: 0 },
    critDamage: { base: 0.5 },
    mastery: { base: 0 },
  });
}
const hit = (model: Stats<ActorStat>): HitContext => ({
  attacker: model.values(),
  target: { level: 90, resistance: 0.1, defenseReduction: 0 },
  level: 90,
  talent: 2,
  hpScaling: 0,
  flat: 0,
  critical: false,
  amplify: false,
});

describe("game-authored RPG damage formulas", () => {
  it("separates base attack percentages from equipment flat attack", () => {
    const model = attacker();
    model.setSource("equipment", [
      { stat: "attack", operation: "flat", value: 300 },
      { stat: "attack", operation: "basePercent", value: 0.5 },
      { stat: "bonus", operation: "flat", value: 0.4 },
      { stat: "bonus", operation: "flat", value: 0.2 },
    ]);
    expect(model.get("attack")).toBe(1500);
    const result = damage.values({
      ...hit(model),
      critical: true,
      amplify: true,
    });
    expect(result).toMatchObject({
      scaling: 3000,
      reaction: 1.5,
      bonus: 1.6,
      critical: 1.5,
      defense: 0.5,
      resistance: 0.9,
    });
    expect(result.damage).toBeCloseTo(4860);
  });

  it("supports mixed HP/attack scaling, flat reaction damage, and target-specific rules", () => {
    const context = { ...hit(attacker()), hpScaling: 0.1, flat: 400 };
    expect(damage.evaluate("scaling", context)).toBe(3000);
    expect(damage.evaluate("damage", context)).toBeCloseTo(1350);
    expect(
      damage.evaluate("resistance", {
        ...context,
        target: { ...context.target, resistance: -0.2 },
      }),
    ).toBe(1.1);
    expect(
      damage.evaluate("resistance", {
        ...context,
        target: { ...context.target, resistance: 1 },
      }),
    ).toBe(0.2);
    expect(
      damage.evaluate("defense", {
        ...context,
        target: { ...context.target, defenseReduction: 1 },
      }),
    ).toBe(1);
  });

  it("lets the game choose hit-time snapshots or current stats", () => {
    const model = attacker();
    const captured = hit(model);
    model.addEffect({
      modifiers: [{ stat: "attack", operation: "multiply", value: 2 }],
      duration: 1,
    });
    expect(damage.evaluate("damage", captured)).toBe(720);
    expect(damage.evaluate("damage", hit(model))).toBe(1440);
    model.advance(1);
    expect(damage.evaluate("damage", hit(model))).toBe(720);
  });

  it("expresses independent charm factors and summed affix percentages", () => {
    const model = new Stats({
      speed: { base: 200, max: 420 },
      projectiles: { base: 0, round: "floor" },
    });
    model.setSource("charms", [
      { stat: "speed", operation: "flat", value: 40 },
      { stat: "speed", operation: "multiply", value: 1.1 },
      { stat: "speed", operation: "multiply", value: 1.2 },
    ]);
    expect(model.get("speed")).toBeCloseTo(316.8);
    model.setSource("charms", [
      { stat: "speed", operation: "percent", value: 0.1 },
      { stat: "speed", operation: "percent", value: 0.2 },
      { stat: "projectiles", operation: "flat", value: 1.8 },
    ]);
    expect(model.values()).toEqual({ speed: 260, projectiles: 1 });
  });
});

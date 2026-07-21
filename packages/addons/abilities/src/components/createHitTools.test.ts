import { describe, expect, it, vi } from "vitest";
import {
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  createMockScene,
  trait,
} from "@yagejs/core";
import { Abilities } from "../core/Abilities.js";
import { AbilitySpawned } from "../core/AbilitySpawned.js";
import type { AbilitySpawnContext } from "../core/AbilitySpawned.js";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitResult, StandardHitData } from "../core/hit/types.js";
import { HitDealt } from "./reportedDelivery.js";
import { guard } from "./steps/guard.js";
import { hitbox } from "./steps/hitbox.js";
import { createHitTools } from "./createHitTools.js";
import type {
  CreateHitToolsOptions,
  HitDataPredicate,
  HitTools,
} from "./createHitTools.js";
import type { HitReceiver } from "./HitReceiver.js";

vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");

  class RigidBodyComponent extends core.Component {
    setVelocity(): void {}
  }

  class ColliderComponent extends core.Component {
    onTrigger(): () => void {
      return () => {};
    }
  }

  return { RigidBodyComponent, ColliderComponent };
});

interface ArcaneHitData {
  kind: "arcane";
  power: number;
}

function isArcaneData(data: unknown): data is ArcaneHitData {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { kind?: unknown; power?: unknown };
  return candidate.kind === "arcane" && typeof candidate.power === "number";
}

const arcane = createHitTools<ArcaneHitData>({ isData: isArcaneData });

@trait(AbilitySpawned)
class ArcaneOrb extends Entity {
  abilitySpawnContext: AbilitySpawnContext<{ speed: number }> | undefined;

  override setup(context: AbilitySpawnContext<{ speed: number }>): void {
    this.abilitySpawnContext = context;
  }
}

@trait(Hittable)
class ArcaneTarget extends Entity {
  receiver: HitReceiver<ArcaneHitData> | undefined;

  receiveHit(hit: Hit): HitResult {
    if (!arcane.isHit(hit) || !this.receiver) return "ignored";
    return this.receiver.receive(hit);
  }
}

describe("createHitTools", () => {
  it("narrows singleton-boundary data with the supplied predicate", () => {
    const { scene } = createMockScene();
    const hit: Hit<unknown> = {
      source: scene.spawn("source"),
      direction: new Vec2(1, 0),
      tags: [],
      data: { kind: "arcane", power: 7 },
    };

    expect(arcane.isData(hit.data)).toBe(true);
    if (!arcane.isHit(hit)) throw new Error("expected an arcane hit");
    expect(hit.data.power).toBe(7);

    expect(arcane.isData({ kind: "arcane", power: "wrong" })).toBe(false);
  });

  it("uses the captured predicate for both boundary guards", () => {
    const options = { isData: isArcaneData };
    const tools = createHitTools<ArcaneHitData>(options);
    options.isData = (data: unknown): data is ArcaneHitData => {
      void data;
      return false;
    };
    const hit: Hit<unknown> = {
      source: new Entity(),
      direction: new Vec2(1, 0),
      tags: [],
      data: { kind: "arcane", power: 7 },
    };

    expect(tools.isData(hit.data)).toBe(true);
    expect(tools.isHit(hit)).toBe(true);
  });

  it("pins delivery, receiver, stage, and reporting data to one type", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("source");
    source.add(new Transform({ position: Vec2.ZERO }));
    const target = scene.spawn(ArcaneTarget);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    const seen: number[] = [];
    const stage = arcane.stage((hit, receiver) => {
      seen.push(hit.data.power);
      expect(receiver.team).toBe("enemy");
    });
    target.receiver = target.add(
      arcane.receiver({ team: "enemy", steps: [stage] }),
    );

    const delivery = arcane.delivery({
      source,
      data: { kind: "arcane", power: 3 },
    });
    expect(delivery.deliver(target, Vec2.ZERO)).toBe("hit");

    const reported: number[] = [];
    source.on(HitDealt, ({ data }) => {
      if (arcane.isData(data)) reported.push(data.power);
    });
    arcane
      .reportingDelivery({
        source,
        data: { kind: "arcane", power: 5 },
      })
      .deliver(target, Vec2.ZERO);

    expect(seen).toEqual([3, 5]);
    expect(reported).toEqual([5]);
  });

  it("types hitbox, guard, and spawn without losing nested inference", () => {
    const hitboxStep = arcane.hitbox({
      from: 0,
      to: 0.2,
      shape: { type: "circle", radius: 8 },
      hit: { kind: "arcane", power: 4 },
    });
    const guardStep = arcane.guard({
      from: 0,
      to: "end",
      outcome: "blocked",
      policy(hit, receiver) {
        const power: number = hit.data.power;
        const team: string | undefined = receiver.team;
        return power > 0 && team !== "ally" ? "negate" : "pass";
      },
      punish: { kind: "arcane", power: 1 },
    });
    const spawnStep = arcane.spawn({
      at: 0.1,
      entity: ArcaneOrb,
      params: { speed: 120 },
      hit: { kind: "arcane", power: 6 },
    });

    expect(hitboxStep.params.hit).toEqual({ kind: "arcane", power: 4 });
    expect(guardStep.params.punish).toEqual({ kind: "arcane", power: 1 });
    expect(spawnStep.params.params.speed).toBe(120);
  });

  it("keeps the raw hitbox and guard factories generic", () => {
    const rawHitbox = hitbox<ArcaneHitData>({
      from: 0,
      to: 0.1,
      shape: { type: "circle", radius: 4 },
      hit: { kind: "arcane", power: 2 },
    });
    const rawGuard = guard<ArcaneHitData>({
      from: 0,
      to: 0.1,
      outcome: "parried",
      policy: (hit) => (hit.data.power > 0 ? "negate" : "pass"),
    });

    expect(rawHitbox.kind).toBe("hitbox");
    expect(rawGuard.kind).toBe("guard");
  });

  it("rejects foreign data and preserves spawned-entity setup params", () => {
    arcane.delivery({
      source: new Entity(),
      // @ts-expect-error the toolkit accepts only ArcaneHitData
      data: { kind: "blade", sharpness: 2 },
    });
    arcane.spawn({
      at: 0,
      entity: ArcaneOrb,
      // @ts-expect-error ArcaneOrb setup requires a numeric speed
      params: { speed: "fast" },
    });
    arcane.stage((hit) => {
      // @ts-expect-error ArcaneHitData has no sharpness field
      expect(hit.data.sharpness).toBeUndefined();
    });
  });

  it("opens a typed guard on a matching receiver", () => {
    const { scene } = createMockScene();
    const attacker = scene.spawn("attacker");
    const target = scene.spawn(ArcaneTarget);
    target.add(new Transform());
    const process = target.add(new ProcessComponent());
    target.receiver = target.add(arcane.receiver({ team: "enemy", steps: [] }));
    target.add(
      new Abilities([
        {
          id: "ward",
          timeline: [
            arcane.guard({
              from: 0,
              to: 1,
              outcome: "blocked",
              policy: (hit) => (hit.data.power >= 5 ? "negate" : "pass"),
            }),
          ],
        },
      ]),
    );

    target.get(Abilities).send("ward");
    process._tick(0.01);
    const result = arcane
      .delivery({
        source: attacker,
        data: { kind: "arcane", power: 5 },
      })
      .deliver(target, Vec2.ZERO);

    expect(result).toBe("blocked");
  });
});

const _typeSurface: HitTools<ArcaneHitData> = arcane;
const _defaultPredicate: HitDataPredicate = (
  data: unknown,
): data is StandardHitData => typeof data === "object" && data !== null;
const _defaultOptions: CreateHitToolsOptions = {
  isData: _defaultPredicate,
};
const _defaultTypeSurface: HitTools = createHitTools(_defaultOptions);
void _typeSurface;
void _defaultTypeSurface;

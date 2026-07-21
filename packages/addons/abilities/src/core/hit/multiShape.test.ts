import { describe, expect, it, vi } from "vitest";
import { Entity, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { Hittable } from "./types.js";
import type { Hit, HitResult } from "./types.js";
import { createHitDelivery, resolveHitSpec } from "./delivery.js";
import type { HitSpec } from "./delivery.js";
import type { HitStage } from "./resolve.js";
import type { StepContext } from "../types.js";
import { HitReceived, HitReceiver } from "../../components/HitReceiver.js";

// HitReceiver's default steps pull in Stagger, whose RigidBodyComponent
// import can't resolve Rapier headless — stub the class (no Stagger here).
vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  class RigidBodyComponent extends core.Component {
    setVelocity(): void {}
  }
  return { RigidBodyComponent };
});

// Two combat systems in one game, each with its own hit-data interface and
// a `kind` discriminant. Neither declares anything globally — no module
// augmentation, no shared vocabulary.
interface SpiritHitData {
  kind: "spirit";
  pressure: number;
  aspect: "fear" | "awe";
}

interface BladeHitData {
  kind: "blade";
  sharpness: number;
}

// The one guard a system pays at its receipt boundary: the `Hittable` trait
// and the `HitReceived` event are singleton tokens typed against the
// default vocabulary, so incoming hits arrive as plain `Hit` and each
// system narrows them to its own payload type here. The parameter is
// `Hit<unknown>` (accepts any hit) because the predicate type must be
// assignable to the parameter type.
function isSpiritHit(hit: Hit<unknown>): hit is Hit<SpiritHitData> {
  return (hit.data as { kind?: string }).kind === "spirit";
}

@trait(Hittable)
class SpiritShrine extends Entity {
  receiver!: HitReceiver<SpiritHitData>;

  receiveHit(hit: Hit): HitResult {
    if (!isSpiritHit(hit)) return "ignored";
    // Past the guard, `hit` is Hit<SpiritHitData> — no further casts.
    return this.receiver.receive(hit);
  }
}

function spawnShrine(
  scene: Scene,
  steps: readonly HitStage<SpiritHitData, HitReceiver<SpiritHitData>>[],
) {
  const shrine = scene.spawn(SpiritShrine);
  shrine.add(new Transform({ position: new Vec2(10, 0) }));
  shrine.receiver = shrine.add(new HitReceiver<SpiritHitData>({ steps }));
  return shrine;
}

describe("per-system hit data (two combat systems, discriminated payloads)", () => {
  it("a receiver typed to one system gets fully typed hits from it", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const seen: Array<[number, "fear" | "awe"]> = [];
    // The step's `hit` parameter is Hit<SpiritHitData>: reading the
    // system's own fields needs no casts.
    const spiritStep: HitStage<SpiritHitData, HitReceiver<SpiritHitData>> = (
      hit,
    ) => {
      seen.push([hit.data.pressure, hit.data.aspect]);
    };
    const shrine = spawnShrine(scene, [spiritStep]);

    const delivery = createHitDelivery<SpiritHitData>({
      source,
      data: { kind: "spirit", pressure: 4, aspect: "fear" },
    });
    expect(delivery.deliver(shrine, new Vec2(0, 0))).toBe("hit");
    expect(seen).toEqual([[4, "fear"]]);
  });

  it("rejects hits from the other system at the boundary guard", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    let steps = 0;
    const shrine = spawnShrine(scene, [
      () => {
        steps++;
      },
    ]);

    const bladeDelivery = createHitDelivery<BladeHitData>({
      source,
      data: { kind: "blade", sharpness: 7 },
    });
    expect(bladeDelivery.deliver(shrine, new Vec2(0, 0))).toBe("ignored");
    expect(steps).toBe(0);
  });

  it("HitReceived carries the per-system payload; handlers re-narrow", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    const shrine = spawnShrine(scene, []);
    const aspects: string[] = [];
    shrine.on(HitReceived, ({ hit }) => {
      if (isSpiritHit(hit)) aspects.push(hit.data.aspect);
    });

    createHitDelivery<SpiritHitData>({
      source,
      data: { kind: "spirit", pressure: 1, aspect: "awe" },
    }).deliver(shrine, new Vec2(0, 0));
    expect(aspects).toEqual(["awe"]);
  });

  it("HitSpec/resolveHitSpec keep the system's type through the builder", () => {
    const spec: HitSpec<SpiritHitData> = () => ({
      kind: "spirit",
      pressure: 2,
      aspect: "awe",
    });
    const data = resolveHitSpec(spec, {} as StepContext);
    // `data` is SpiritHitData — the discriminant is the literal type.
    expect(data.kind).toBe("spirit");
    expect(data.pressure).toBe(2);
  });

  it("authoring is typed per call site: foreign fields don't compile", () => {
    const { scene } = createMockScene();
    const source = scene.spawn("attacker");
    createHitDelivery<SpiritHitData>({
      source,
      // @ts-expect-error a blade payload is not a spirit payload
      data: { kind: "blade", sharpness: 7 },
    });
    // Runtime is unaffected; the check above is compile-time only.
    expect(true).toBe(true);
  });
});

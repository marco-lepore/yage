import { describe, it, expect, expectTypeOf } from "vitest";
import { Entity } from "./Entity.js";
import type { Scene } from "./Scene.js";

// Type-level regression coverage for the class form of `Scene.spawn` and
// `Entity.spawnChild`. The single class-form overload derives its trailing
// arguments from the entity's `setup()` signature, so omitting a required
// field reports that field as missing on the params object instead of falling
// through to an options-only overload that mislabels a valid field as unknown.
//
// The assertions run at compile time. The `assertTypes` body is never invoked
// — it exists so `tsc` (via the test build) type-checks the calls and the
// `@ts-expect-error` guards; the runtime test below only asserts that.

declare const scene: Scene;
declare const parent: Entity;

class Enemy extends Entity {
  archetype = "";
  override setup(params: {
    archetype: string;
    hp: number;
    spawnPoint: { x: number; y: number };
  }): void {
    this.archetype = params.archetype;
  }
}

class Plain extends Entity {}

class DefaultedSetup extends Entity {
  x = 0;
  override setup(params: { x?: number } = {}): void {
    this.x = params.x ?? 0;
  }
}

function assertTypes(): void {
  // Scene.spawn — params inferred from setup(); complete object accepted.
  expectTypeOf(scene.spawn(Enemy, {
    archetype: "goblin",
    hp: 10,
    spawnPoint: { x: 0, y: 0 },
  })).toEqualTypeOf<Enemy>();

  // Omitting a required field surfaces "Property 'spawnPoint' is missing" on
  // the params object — not a misleading "X does not exist on SpawnOptions".
  // @ts-expect-error spawnPoint is required by Enemy.setup()
  scene.spawn(Enemy, { archetype: "goblin", hp: 10 });

  // Wrong-typed required field is rejected.
  scene.spawn(Enemy, {
    archetype: "g",
    // @ts-expect-error hp must be a number
    hp: "lots",
    spawnPoint: { x: 0, y: 0 },
  });

  // No-setup entity: 2nd arg routes to options.
  scene.spawn(Plain, { key: "marker" });
  // @ts-expect-error `wrongProp` is not a SpawnOptions field
  scene.spawn(Plain, { wrongProp: 1 });

  // All-optional setup: a key-only object and a real-params object both work.
  scene.spawn(DefaultedSetup, { key: "k" });
  scene.spawn(DefaultedSetup, { x: 42 });

  // Explicit 3-arg form (params, options).
  scene.spawn(
    Enemy,
    { archetype: "g", hp: 1, spawnPoint: { x: 0, y: 0 } },
    { key: "boss" },
  );

  // Entity.spawnChild mirrors the same class-form shape.
  expectTypeOf(parent.spawnChild("foe", Enemy, {
    archetype: "goblin",
    hp: 10,
    spawnPoint: { x: 0, y: 0 },
  })).toEqualTypeOf<Enemy>();

  // @ts-expect-error spawnPoint is required by Enemy.setup()
  parent.spawnChild("foe", Enemy, { archetype: "goblin", hp: 10 });

  parent.spawnChild("marker", Plain, { key: "m" });
}

describe("spawn / spawnChild class-form types", () => {
  it("type-checks the class form (assertions enforced at compile time)", () => {
    expect(typeof assertTypes).toBe("function");
  });
});

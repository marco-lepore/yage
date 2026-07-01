import { describe, it, expect, expectTypeOf } from "vitest";
import { Entity } from "./Entity.js";
import type { Scene, SpawnOptions } from "./Scene.js";

// Type-level regression coverage for the class form of `Scene.spawn` and
// `Entity.spawnChild`. The single class-form overload derives its trailing
// arguments from the entity's `setup()` PARAMETER: whether a params argument is
// required, and its type. Omitting a required field reports that field as
// missing on the params object instead of falling through to an options-only
// overload that mislabels a valid field as unknown.
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

// Required parameter, but every field of the parameter object is optional.
// The params ARGUMENT is still required — `setup(undefined)` would crash a body
// that reads `params`, so `spawn(RequiredParam)` must be a type error.
class RequiredParam extends Entity {
  x = 0;
  override setup(params: { x?: number }): void {
    this.x = params.x ?? 0;
  }
}

class Plain extends Entity {}

// Explicit zero-parameter `setup(): void`. Behaves like a class with no
// declared setup: no params slot, only the trailing options slot.
class VoidSetup extends Entity {
  ready = false;
  override setup(): void {
    this.ready = true;
  }
}

// Optional parameter (default value) — a zero-argument `setup()` is valid, so
// the params slot is optional.
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

  // A required-parameter setup demands the params argument even when the
  // param object's fields are all optional. Omitting it is a type error — the
  // runtime would call setup(undefined) and crash a body that reads params.
  // @ts-expect-error params argument is required by RequiredParam.setup()
  scene.spawn(RequiredParam);
  scene.spawn(RequiredParam, {}); // empty object satisfies the required slot
  scene.spawn(RequiredParam, { x: 1 });

  // No-setup entity: 1-arg is valid; 2nd arg routes to options.
  scene.spawn(Plain);
  scene.spawn(Plain, { key: "marker" });
  // @ts-expect-error `wrongProp` is not a SpawnOptions field
  scene.spawn(Plain, { wrongProp: 1 });

  // Zero-parameter `setup(): void`: same shape as no-setup. The class alone
  // works, and a 2nd arg routes to options (there is no params slot).
  scene.spawn(VoidSetup);
  scene.spawn(VoidSetup, { key: "captured" });
  // @ts-expect-error `wrongProp` is not a SpawnOptions field
  scene.spawn(VoidSetup, { wrongProp: 1 });

  // All-optional setup: the class alone, real params, or explicit options all
  // work. A key-only literal is NOT accepted in the params slot (it isn't a
  // `{ x?: number }`); key via the 3-arg form instead.
  scene.spawn(DefaultedSetup);
  scene.spawn(DefaultedSetup, { x: 42 });
  scene.spawn(DefaultedSetup, {}, { key: "k" });
  scene.spawn(DefaultedSetup, undefined, { key: "k" });
  // @ts-expect-error a SpawnOptions-shaped literal is not a { x?: number } param
  scene.spawn(DefaultedSetup, { key: "k" });
  // Same rejection in the explicit 3-arg form: the params slot must be the
  // setup param type, not an arbitrary options object. Overload resolution
  // surfaces the error on the call, so the guard sits on the call line.
  // @ts-expect-error { key } is not a { x?: number } param in the 3-arg form
  scene.spawn(DefaultedSetup, { key: "setup-key" }, { key: "entity-key" });

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

  // @ts-expect-error params argument is required by RequiredParam.setup()
  parent.spawnChild("opt", RequiredParam);
  parent.spawnChild("opt", RequiredParam, {});

  parent.spawnChild("marker", Plain);
  parent.spawnChild("marker", Plain, { key: "m" });

  // Zero-parameter setup mirrors no-setup in the child form too.
  parent.spawnChild("ready", VoidSetup);
  parent.spawnChild("ready", VoidSetup, { key: "captured" });
  // @ts-expect-error a SpawnOptions-shaped literal is not a { x?: number } param
  parent.spawnChild("def", DefaultedSetup, { key: "m" });
  parent.spawnChild("def", DefaultedSetup, {}, { key: "m" });
}

// Residual case that structural typing cannot close: when the setup param type
// itself declares an optional `key`, a `{ key }` literal satisfies the params
// slot and the runtime routes it to options (the "don't name a top-level setup
// field `key`" footgun documented on `SpawnOptions.key`). Documented here, not
// silently accepted elsewhere.
class KeyishSetup extends Entity {
  seen: { key?: string; hp?: number } = {};
  override setup(params: { key?: string; hp?: number } = {}): void {
    this.seen = params;
  }
}

function assertResidual(): void {
  // Accepted by the type; at runtime `{ key }` routes to options, not params.
  scene.spawn(KeyishSetup, { key: "k" });
  // The unambiguous fix is the 3-arg form.
  scene.spawn(KeyishSetup, { key: "player-1" }, { key: "entity-key" });
  // `SpawnOptions` still refers to the shared options type.
  expectTypeOf<SpawnOptions>().toMatchTypeOf<{ key?: string }>();
}

describe("spawn / spawnChild class-form types", () => {
  it("type-checks the class form (assertions enforced at compile time)", () => {
    expect(typeof assertTypes).toBe("function");
    expect(typeof assertResidual).toBe("function");
  });
});

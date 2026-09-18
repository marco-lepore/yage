import { describe, it, expect } from "vitest";
import { Entity } from "./Entity.js";
import { Scene } from "./Scene.js";

// Type-level coverage for the ban on a per-frame hook. `Scene` and `Entity`
// each declare `update` and `fixedUpdate` as `never`, so a subclass that
// defines either one fails to compile. Each `@ts-expect-error` below fails if
// the declaration ever disappears.

class SceneWithUpdate extends Scene {
  readonly name = "SceneWithUpdate";

  // @ts-expect-error — a scene has no per-frame hook.
  update(dt: number): void {
    void dt;
  }
}

class SceneWithFixedUpdate extends Scene {
  readonly name = "SceneWithFixedUpdate";

  // @ts-expect-error — a scene has no fixed-step hook either.
  fixedUpdate(dt: number): void {
    void dt;
  }
}

class EntityWithUpdate extends Entity {
  // @ts-expect-error — an entity has no per-frame hook.
  update(dt: number): void {
    void dt;
  }
}

class EntityWithFixedUpdate extends Entity {
  // @ts-expect-error — an entity has no fixed-step hook either.
  fixedUpdate(dt: number): void {
    void dt;
  }
}

/** A subclass that declares neither name compiles. */
class PlainScene extends Scene {
  readonly name = "PlainScene";

  override onEnter(): void {}
}

/** Same for an entity. */
class PlainEntity extends Entity {}

describe("per-frame hook names", () => {
  it("compiles its type assertions", () => {
    expect([
      SceneWithUpdate,
      SceneWithFixedUpdate,
      EntityWithUpdate,
      EntityWithFixedUpdate,
      PlainScene,
      PlainEntity,
    ]).toHaveLength(6);
  });
});

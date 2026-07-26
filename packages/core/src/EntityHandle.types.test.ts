import { describe, it, expect, expectTypeOf } from "vitest";
import { Entity } from "./Entity.js";
import type { EntityHandle } from "./EntityHandle.js";

// Type-level coverage for the handle's variance: `handle()` keeps the entity's
// own type, and the parameter is output-only, so a handle on a subclass stands
// in for a handle on the base and not the reverse. The assertions compile;
// `assertTypes` is never called, and the runtime test below only asserts that.

class Enemy extends Entity {
  health = 3;
}

function assertTypes(): void {
  const enemy = new Enemy("enemy");

  expectTypeOf(enemy.handle()).toEqualTypeOf<EntityHandle<Enemy>>();
  expectTypeOf(enemy.handle().current).toEqualTypeOf<Enemy | undefined>();

  const specific: EntityHandle<Enemy> = enemy.handle();
  const general: EntityHandle<Entity> = specific;
  // @ts-expect-error — an Entity handle is not an Enemy handle.
  const narrowed: EntityHandle<Enemy> = general;
  void narrowed;

  // @ts-expect-error — `current` is read-only.
  specific.current = undefined;
}

describe("EntityHandle types", () => {
  it("compiles its type assertions", () => {
    expect(typeof assertTypes).toBe("function");
  });
});

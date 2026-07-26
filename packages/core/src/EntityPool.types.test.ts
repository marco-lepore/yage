import { describe, it, expect, expectTypeOf } from "vitest";
import { Entity } from "./Entity.js";
import { EntityPool } from "./EntityPool.js";
import type { Scene } from "./Scene.js";

// Type-level coverage for the pool's two derived signatures: `acquire`'s
// arguments come from the member's own `onAcquire`, and its return type from
// whether the pool is capped. The assertions compile; `assertTypes` is never
// called, and the runtime test below only asserts that.

declare const scene: Scene;

class Bullet extends Entity {
  onAcquire(x: number, y: number): void {
    void x;
    void y;
  }
}

/** No reset to do, stated explicitly — the constraint demands the hook. */
class Blank extends Entity {
  onAcquire(): void {}
}

/** Pooled member whose `setup()` requires params. */
class Tinted extends Entity {
  override setup(params: { color: number }): void {
    void params;
  }
  onAcquire(): void {}
}

/** Inherits a concrete `onAcquire` — enough to be poolable. */
class Tracer extends Bullet {}

/** Never declares the hook, so it cannot be pooled. */
class Plain extends Entity {}

function assertTypes(): void {
  const elastic = new EntityPool(scene, Bullet, { prewarm: 4 });
  expectTypeOf(elastic.acquire(1, 2)).toEqualTypeOf<Bullet>();
  expectTypeOf(elastic.forceAcquire(1, 2)).toEqualTypeOf<Bullet>();

  const capped = new EntityPool(scene, Bullet, { maxSize: 8 });
  expectTypeOf(capped.acquire(1, 2)).toEqualTypeOf<Bullet | undefined>();
  expectTypeOf(capped.forceAcquire(1, 2)).toEqualTypeOf<Bullet>();

  // @ts-expect-error — onAcquire takes two numbers.
  elastic.acquire(1);
  // @ts-expect-error — and they are numbers.
  elastic.acquire("1", 2);

  const blank = new EntityPool(scene, Blank);
  expectTypeOf(blank.acquire()).toEqualTypeOf<Blank>();

  const inherited = new EntityPool(scene, Tracer);
  expectTypeOf(inherited.acquire(1, 2)).toEqualTypeOf<Tracer>();

  // @ts-expect-error — Plain declares no onAcquire.
  new EntityPool(scene, Plain);

  // @ts-expect-error — Tinted.setup requires params.
  new EntityPool(scene, Tinted);
  // @ts-expect-error — and they must match its signature.
  new EntityPool(scene, Tinted, { setup: { color: "red" } });
  new EntityPool(scene, Tinted, { setup: { color: 1 } });

  // @ts-expect-error — Bullet.setup takes nothing.
  new EntityPool(scene, Bullet, { setup: { color: 1 } });

  // reclaimPriority sees the member type.
  new EntityPool(scene, Bullet, {
    maxSize: 2,
    reclaimPriority: (member) => {
      expectTypeOf(member).toEqualTypeOf<Bullet>();
      return 0;
    },
  });
}

describe("EntityPool types", () => {
  it("compiles its type assertions", () => {
    expect(typeof assertTypes).toBe("function");
  });
});

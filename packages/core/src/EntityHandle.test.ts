import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Entity } from "./Entity.js";
import { EntityPool } from "./EntityPool.js";
import type { EntityHandle } from "./EntityHandle.js";
import { createMockScene } from "./test-utils.js";

describe("EntityHandle", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("resolves to the entity while its life lasts", () => {
    const { scene } = createMockScene();
    const enemy = scene.spawn("enemy");

    expect(enemy.handle().current).toBe(enemy);
  });

  it("stops resolving once the entity is destroyed", () => {
    const { scene } = createMockScene();
    const enemy = scene.spawn("enemy");
    const handle = enemy.handle();

    enemy.destroy();

    expect(handle.current).toBeUndefined();
  });

  it("still resolves a dormant entity — same life, just switched off", () => {
    const { scene } = createMockScene();
    const enemy = scene.spawn("enemy");
    const handle = enemy.handle();

    enemy.setActive(false);

    expect(handle.current).toBe(enemy);
  });

  it("stops resolving children destroyed with their parent", () => {
    const { scene } = createMockScene();
    const parent = scene.spawn("parent");
    const child = parent.spawnChild("body");
    const handle = child.handle();

    parent.destroy();

    expect(handle.current).toBeUndefined();
  });

  it("ends every descendant's life before the destroy cascade runs hooks", () => {
    const { scene } = createMockScene();

    const seenDuringRelease: Array<Entity | undefined> = [];
    const takenDuringRelease: Array<Entity | undefined> = [];
    class Probe extends Entity {
      sibling?: EntityHandle<Entity>;
      siblingRef?: Entity;
      onAcquire(): void {}
      override onRelease(): void {
        seenDuringRelease.push(this.sibling?.current);
        // A handle taken NOW must be dead too: the sibling sits under a
        // destroyed parent, even though the cascade has not reached it yet.
        takenDuringRelease.push(this.siblingRef?.handle().current);
      }
    }

    const pool = new EntityPool(scene, Probe, { prewarm: 1 });
    const parent = scene.spawn("parent");
    const member = pool.acquire()!;
    parent.addChild("member", member);
    const sibling = parent.spawnChild("sibling");
    member.sibling = sibling.handle();
    member.siblingRef = sibling;

    parent.destroy();

    // The pooled child's `onRelease` ran mid-cascade, before the sibling was
    // visited — the sibling's handle must already be dead by then.
    expect(seenDuringRelease).toEqual([undefined]);
    expect(takenDuringRelease).toEqual([undefined]);
  });

  it("stops resolving after scene teardown", () => {
    const { scene } = createMockScene();
    const enemy = scene.spawn("enemy");
    const handle = enemy.handle();

    scene._destroyAllEntities();

    // The life ended, not just the destroyed flag: teardown must bump.
    expect(handle.current).toBeUndefined();
    expect(enemy.generation).toBe(1);
  });

  it("starts every entity at generation 0 and moves it on when a life ends", () => {
    const { scene } = createMockScene();
    const first = scene.spawn("first");
    const second = scene.spawn("second");

    expect(first.generation).toBe(0);
    expect(second.generation).toBe(0);

    first.destroy();

    expect(first.generation).toBe(1);
    expect(second.generation).toBe(0);
  });

  it("keeps working on an entity that was never spawned", () => {
    const loose = new Entity("loose");

    expect(loose.handle().current).toBe(loose);
  });
});

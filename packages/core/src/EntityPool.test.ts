import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Entity } from "./Entity.js";
import { Component } from "./Component.js";
import { EntityPool } from "./EntityPool.js";
import { QueryCacheKey } from "./EngineContext.js";
import type { QueryCache } from "./QueryCache.js";
import { createMockScene } from "./test-utils.js";

class Marker extends Component {
  log: string[] = [];
  override onAdd(): void {
    this.log.push("add");
  }
  override onEnable(): void {
    this.log.push("enable");
  }
  override onDisable(): void {
    this.log.push("disable");
  }
}

class Spark extends Entity {
  x = 0;
  acquires = 0;
  releases = 0;
  marker!: Marker;

  constructor() {
    super("spark", ["spark"]);
  }

  override setup(): void {
    this.marker = this.add(new Marker());
  }

  onAcquire(x: number): void {
    this.x = x;
    this.acquires++;
  }

  override onRelease(): void {
    this.releases++;
  }
}

/** A member whose `setup()` needs params, to cover the typed setup option. */
class Tinted extends Entity {
  color = 0;
  override setup(params: { color: number }): void {
    this.color = params.color;
  }
  onAcquire(): void {}
}

describe("EntityPool", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("construction", () => {
    it("prewarms members dormant, without acquiring them", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 3 });

      expect(pool.size).toBe(3);
      expect(pool.free).toBe(3);
      expect(pool.leased).toBe(0);
      for (const entity of scene.getEntities()) {
        expect(entity.isActive).toBe(false);
        expect((entity as Spark).acquires).toBe(0);
      }
    });

    it("builds members without a query join or an enable hook", () => {
      const { scene, context } = createMockScene();
      const queries = context.resolve(QueryCacheKey) as QueryCache;
      const query = queries.register([Marker]);

      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const member = pool.acquire(0);

      expect(member.marker.log).toEqual(["add", "enable"]);
      expect(query.size).toBe(1);
    });

    it("keeps a member's children dormant with it, and its own hooks quiet", () => {
      const { scene } = createMockScene();

      class Composite extends Entity {
        marker!: Marker;
        override setup(): void {
          this.marker = this.spawnChild("body").add(new Marker());
        }
        onAcquire(): void {}
      }
      const pool = new EntityPool(scene, Composite, { prewarm: 1 });
      const member = pool.acquire();

      expect(member.marker.log).toEqual(["add", "enable"]);
      expect(member.getChild("body").isActive).toBe(true);

      pool.release(member);
      expect(member.getChild("body").isActive).toBe(false);
    });

    it("leaves an unrelated entity spawned during setup active", () => {
      const { scene } = createMockScene();

      class Chatty extends Entity {
        override setup(): void {
          this.scene.spawn("bystander").add(new Marker());
        }
        onAcquire(): void {}
      }
      new EntityPool(scene, Chatty, { prewarm: 1 });

      const bystander = scene.findEntity("bystander");
      expect(bystander?.isActive).toBe(true);
      expect(bystander?.get(Marker).log).toEqual(["add", "enable"]);
    });

    it("marks members as pooled so save skips them", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      expect(pool.acquire(0).isPooled).toBe(true);
    });

    it("passes typed setup params through to setup()", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Tinted, { setup: { color: 0x30 } });
      expect(pool.acquire().color).toBe(0x30);
    });

    it("leaves nothing behind when a prewarm fails", () => {
      class Fragile extends Entity {
        static builds = 0;
        override setup(): void {
          if (++Fragile.builds === 2) throw new Error("setup failed");
        }
        onAcquire(): void {}
      }
      const { scene } = createMockScene();

      expect(() => new EntityPool(scene, Fragile, { prewarm: 3 })).toThrow(
        "setup failed",
      );

      // The constructor threw, so nobody holds the pool. Neither the member
      // it did build nor the pool's registration may outlive the call.
      scene._flushDestroyQueue();
      expect(scene.getEntities().size).toBe(0);
    });

    it("rejects an unusable capacity", () => {
      const { scene } = createMockScene();
      expect(() => new EntityPool(scene, Spark, { maxSize: 0 })).toThrow(
        /maxSize must be an integer of at least 1/,
      );
      expect(
        () => new EntityPool(scene, Spark, { maxSize: 2, prewarm: 3 }),
      ).toThrow(/below prewarm/);
      expect(() => new EntityPool(scene, Spark, { prewarm: -1 })).toThrow(
        /non-negative integer/,
      );
    });
  });

  describe("acquire and release", () => {
    it("wakes a member, runs onAcquire on it, and counts the lease", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });

      const spark = pool.acquire(42);

      expect(spark.isActive).toBe(true);
      expect(spark.x).toBe(42);
      expect(spark.acquires).toBe(1);
      expect(pool.leased).toBe(1);
      expect(pool.free).toBe(0);
    });

    it("hands the same entity back out instead of spawning another", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark);

      const first = pool.acquire(1);
      pool.release(first);
      const second = pool.acquire(2);

      expect(second).toBe(first);
      expect(second.id).toBe(first.id);
      expect(pool.size).toBe(1);
      expect(second.acquires).toBe(2);
      expect(scene.getEntities().size).toBe(1);
    });

    it("grows past the prewarm on an elastic pool", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });

      pool.acquire(1);
      pool.acquire(2);

      expect(pool.size).toBe(2);
      expect(pool.leased).toBe(2);
    });

    it("releases through onRelease, then dormancy", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const spark = pool.acquire(1);
      spark.marker.log.length = 0;

      pool.release(spark);

      expect(spark.releases).toBe(1);
      expect(spark.isActive).toBe(false);
      expect(spark.marker.log).toEqual(["disable"]);
      expect(pool.leased).toBe(0);
      expect(pool.free).toBe(1);
    });

    it("keeps a dormant member out of queries and lookups", () => {
      const { scene, context } = createMockScene();
      const queries = context.resolve(QueryCacheKey) as QueryCache;
      const query = queries.register([Marker]);
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });

      const spark = pool.acquire(1);
      expect(query.size).toBe(1);
      expect(scene.findEntitiesByTag("spark")).toEqual([spark]);

      pool.release(spark);
      expect(query.size).toBe(0);
      expect(scene.findEntitiesByTag("spark")).toEqual([]);
      expect(scene.getEntities().has(spark)).toBe(true);
    });

    it("reports a double release and leaves the pool unchanged", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const spark = pool.acquire(1);

      pool.release(spark);
      pool.release(spark);

      expect(pool.free).toBe(1);
      expect(spark.releases).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("has not leased"),
      );
    });

    it("ignores an external setActive on a leased member", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const spark = pool.acquire(1);

      spark.setActive(false);

      expect(pool.leased).toBe(1);
      expect(pool.free).toBe(0);
      expect(pool.acquire(2)).not.toBe(spark);
    });

    it("returns a member to its pool when destroy() retires it", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const spark = pool.acquire(1);

      // The retire site — a collision handler, an update — holds a plain
      // Entity and no pool reference, so destroy() has to do the right thing.
      spark.destroy();

      expect(spark.isDestroyed).toBe(false);
      expect(spark.isActive).toBe(false);
      expect(spark.releases).toBe(1);
      expect(pool.leased).toBe(0);
      expect(pool.acquire(2)).toBe(spark);
    });

    it("releases a member hung under an entity that gets destroyed", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const spark = pool.acquire(1);
      const carrier = scene.spawn("carrier");
      carrier.addChild("spark", spark);

      carrier.destroy();

      // The carrier owns the tree, but not the member inside it.
      expect(carrier.isDestroyed).toBe(true);
      expect(spark.isDestroyed).toBe(false);
      expect(spark.parent).toBeNull();
      expect(pool.free).toBe(1);
    });
  });

  describe("capacity", () => {
    it("returns undefined once a capped pool is saturated", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { maxSize: 2 });

      expect(pool.acquire(1)).toBeDefined();
      expect(pool.acquire(2)).toBeDefined();
      expect(pool.acquire(3)).toBeUndefined();
      expect(pool.size).toBe(2);
    });

    it("forceAcquire reclaims the oldest lease by default", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { maxSize: 2 });
      const first = pool.acquire(1)!;
      const second = pool.acquire(2)!;

      const third = pool.forceAcquire(3);

      expect(third).toBe(first);
      expect(third.releases).toBe(1);
      expect(third.acquires).toBe(2);
      expect(third.x).toBe(3);
      expect(third.isActive).toBe(true);
      expect(pool.leased).toBe(2);
      expect(second.isActive).toBe(true);
    });

    it("forceAcquire picks the lowest reclaimPriority", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, {
        maxSize: 3,
        reclaimPriority: (member) => member.x,
      });
      pool.acquire(30);
      const cheapest = pool.acquire(10)!;
      pool.acquire(20);

      expect(pool.forceAcquire(99)).toBe(cheapest);
    });

    it("frees the slot when destroy() retires a member of a capped pool", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { maxSize: 1 });
      const first = pool.acquire(1)!;

      first.destroy();

      expect(pool.leased).toBe(0);
      expect(pool.free).toBe(1);
      expect(pool.acquire(2)).toBe(first);
    });

    it("ignores a destroy() from the victim's own onRelease", () => {
      class SelfDestruct extends Entity {
        onAcquire(): void {}
        override onRelease(): void {
          this.destroy();
        }
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, SelfDestruct, { maxSize: 1 });
      const only = pool.forceAcquire();

      // Mid-release the member is already on its way back, so retiring it
      // again does nothing and the reclaim completes.
      expect(pool.forceAcquire()).toBe(only);
      expect(only.isDestroyed).toBe(false);
      expect(pool.leased).toBe(1);
    });

    it("forceAcquire on an elastic pool just grows", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark);

      const first = pool.forceAcquire(1);
      const second = pool.forceAcquire(2);

      expect(second).not.toBe(first);
      expect(pool.size).toBe(2);
    });

    it("aborts the reclaim when reclaimPriority throws", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, {
        maxSize: 1,
        reclaimPriority: () => {
          throw new Error("bad priority");
        },
      });
      const only = pool.acquire(1)!;

      expect(() => pool.forceAcquire(2)).toThrow("bad priority");
      expect(pool.leased).toBe(1);
      expect(only.releases).toBe(0);
      expect(only.x).toBe(1);
    });
  });

  describe("held releases", () => {
    it("keeps a member released inside the hold out of reach until it ends", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });
      const spark = pool.acquire(1);

      scene.deferPoolReleases(() => {
        pool.release(spark);
        expect(spark.isActive).toBe(false);
        // Counted as neither leased nor free while the hold lasts.
        expect(pool.leased).toBe(0);
        expect(pool.free).toBe(0);
        expect(pool.acquire(2)).not.toBe(spark);
      });

      expect(pool.acquire(3)).toBe(spark);
    });

    it("forceAcquire hands back a held member when nothing is live", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { maxSize: 1 });
      const spark = pool.acquire(1)!;

      scene.deferPoolReleases(() => {
        pool.release(spark);
        // The only member is held, so the reclaim falls through to the batch
        // rather than failing a call that promises a member.
        expect(pool.forceAcquire(2)).toBe(spark);
        expect(spark.isActive).toBe(true);
        expect(pool.leased).toBe(1);
      });

      // Taken out of the batch, so the hold ending does not free it twice.
      expect(pool.leased).toBe(1);
      expect(pool.free).toBe(0);
      expect(pool.size).toBe(1);
    });
  });

  describe("failing hooks", () => {
    class ThrowOnAcquire extends Entity {
      onAcquire(): void {
        throw new Error("acquire failed");
      }
    }

    class ThrowOnRelease extends Entity {
      onAcquire(): void {}
      override onRelease(): void {
        throw new Error("release failed");
      }
    }

    it("leaves the member leased and active when onAcquire throws", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, ThrowOnAcquire);

      expect(() => pool.acquire()).toThrow("acquire failed");
      expect(pool.leased).toBe(1);
      expect(pool.free).toBe(0);
    });

    it("parks the member anyway when onRelease throws during a reclaim", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, ThrowOnRelease, { maxSize: 1 });
      const only = pool.forceAcquire();

      expect(() => pool.forceAcquire()).toThrow("release failed");
      // The caller never got the member, so it is back in the pool rather
      // than stranded in neither the lease set nor the free list.
      expect(pool.leased).toBe(0);
      expect(pool.free).toBe(1);
      expect(only.isActive).toBe(false);
    });

    it("parks the member anyway when onRelease throws", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, ThrowOnRelease);
      const member = pool.acquire();

      expect(() => pool.release(member)).toThrow("release failed");
      expect(member.isActive).toBe(false);
      expect(pool.free).toBe(1);
      expect(pool.acquire()).toBe(member);
    });

    it("tears the parent down even when a pooled child's onRelease throws", () => {
      class Difficult extends Entity {
        onAcquire(): void {}
        override onRelease(): void {
          throw new Error("release failed");
        }
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Difficult);
      const member = pool.acquire();
      const carrier = scene.spawn("carrier");
      carrier.addChild("held", member);

      expect(() => carrier.destroy()).toThrow("release failed");

      // The throw comes from the child's hook. If it skipped the parent's
      // queue step the carrier would stay marked destroyed and never be torn
      // down — alive in the scene with nothing left to clean it up.
      scene._flushDestroyQueue();
      expect(carrier.isDestroyed).toBe(true);
      expect(scene.getEntities().has(carrier)).toBe(false);
    });

    it("puts a member to sleep before it can be acquired again", () => {
      const seen: boolean[] = [];
      class Nosy extends Component {
        pool!: EntityPool<Watcher>;
        override onDisable(): void {
          // Acquiring from inside the release must not hand back the member
          // whose deactivation is still running.
          const other = this.pool.acquire();
          seen.push(other === this.entity);
        }
      }
      class Watcher extends Entity {
        nosy!: Nosy;
        override setup(): void {
          this.nosy = this.add(new Nosy());
        }
        onAcquire(): void {}
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Watcher);
      const member = pool.acquire();
      member.nosy.pool = pool;

      pool.release(member);

      expect(seen).toEqual([false]);
    });

    it("keeps the slot when a reclaim victim's onDisable throws", () => {
      class Brittle extends Component {
        armed = false;
        override onDisable(): void {
          if (this.armed) throw new Error("disable failed");
        }
      }
      class Fragile extends Entity {
        brittle!: Brittle;
        override setup(): void {
          this.brittle = this.add(new Brittle());
        }
        onAcquire(): void {}
      }
      const { scene } = createMockScene();
      const pool: EntityPool<Fragile, number> = new EntityPool(scene, Fragile, {
        maxSize: 1,
      });
      const only = pool.forceAcquire();
      only.brittle.armed = true;

      expect(() => pool.forceAcquire()).toThrow("disable failed");
      // The deactivation runs after the victim leaves the lease, so a throw
      // there must not strand it: a capped pool would lose the slot for good.
      expect(pool.size).toBe(1);
      expect(pool.leased + pool.free).toBe(1);
    });

    it("parks the member anyway when a component onDisable throws", () => {
      class Brittle extends Component {
        override onDisable(): void {
          throw new Error("disable failed");
        }
      }
      class Fragile extends Entity {
        override setup(): void {
          this.add(new Brittle());
        }
        onAcquire(): void {}
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Fragile);
      const member = pool.acquire();

      expect(() => pool.release(member)).toThrow("disable failed");
      // Filed before the deactivation, so the throw does not strand it
      // outside every collection the pool tracks.
      expect(pool.leased).toBe(0);
      expect(pool.free).toBe(1);
    });
  });

  describe("hooks that reenter the pool", () => {
    it("takes the member back when onAcquire releases it", () => {
      class SelfReleasing extends Entity {
        pool!: EntityPool<SelfReleasing>;
        armed = false;
        onAcquire(): void {
          if (!this.armed) return;
          this.armed = false;
          this.pool.release(this);
        }
        override onRelease(): void {}
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, SelfReleasing);
      const member = pool.acquire();
      member.pool = pool;
      pool.release(member);
      member.armed = true;

      const handed = pool.acquire();

      // Without the take-back the member would sit in the free list while the
      // caller held it, and the next acquire would hand it to a second owner.
      expect(handed).toBe(member);
      expect(pool.acquire()).not.toBe(handed);
      expect(pool.leased).toBe(2);
      expect(pool.free).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("released the member being acquired"),
      );
    });

    it("takes the member back when onAcquire destroys it", () => {
      class SelfDestroying extends Entity {
        armed = false;
        onAcquire(): void {
          if (!this.armed) return;
          this.armed = false;
          this.destroy();
        }
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, SelfDestroying);
      const member = pool.acquire();
      pool.release(member);
      member.armed = true;

      // destroy() is a release here, so it hits the same take-back as any
      // other hook that hands its member away mid-acquisition.
      const handed = pool.acquire();

      expect(handed).toBe(member);
      expect(handed.isDestroyed).toBe(false);
      expect(pool.leased).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("released the member being acquired"),
      );
    });

    it("says why forceAcquire cannot serve a call from the last member's onRelease", () => {
      class Greedy extends Entity {
        pool!: EntityPool<Greedy, number>;
        armed = false;
        onAcquire(): void {}
        override onRelease(): void {
          if (!this.armed) return;
          this.armed = false;
          this.pool.forceAcquire();
        }
      }
      const { scene } = createMockScene();
      const pool: EntityPool<Greedy, number> = new EntityPool(scene, Greedy, {
        maxSize: 1,
      });
      const member = pool.forceAcquire();
      member.pool = pool;
      member.armed = true;

      // The member is mid-release, so it is neither leased nor free, and the
      // cap stops the pool building another. The old message blamed an empty
      // pool, which is the one thing it is not.
      expect(() => pool.release(member)).toThrow(/all being released/);
      expect(pool.size).toBe(1);
      expect(pool.free).toBe(1);
    });

    it("keeps ownership single when onRelease acquires from the same pool", () => {
      class Reacquiring extends Entity {
        pool!: EntityPool<Reacquiring>;
        armed = false;
        taken: Reacquiring | undefined;
        onAcquire(): void {}
        override onRelease(): void {
          if (!this.armed) return;
          this.armed = false;
          this.taken = this.pool.acquire();
        }
      }
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Reacquiring);
      const member = pool.acquire();
      member.pool = pool;
      member.armed = true;

      pool.release(member);

      // The member leaves the lease set before its hook runs, so the nested
      // acquisition cannot reach it and grows instead.
      expect(member.taken).not.toBe(member);
      expect(pool.leased).toBe(1);
      expect(pool.free).toBe(1);
      expect(member.isActive).toBe(false);
    });
  });

  describe("disposal", () => {
    it("destroys its members and refuses further acquisitions", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 2 });
      const spark = pool.acquire(1);

      pool.dispose();
      scene._flushDestroyQueue();

      expect(spark.isDestroyed).toBe(true);
      expect(pool.size).toBe(0);
      expect(() => pool.acquire(1)).toThrow(/disposed pool/);
    });

    it("is disposed with the scene it belongs to", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 1 });

      scene._destroyAllEntities();

      expect(() => pool.forceAcquire(1)).toThrow(/disposed pool/);
    });

    it("releaseAll returns every leased member", () => {
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Spark, { prewarm: 2 });
      pool.acquire(1);
      pool.acquire(2);

      pool.releaseAll();

      expect(pool.leased).toBe(0);
      expect(pool.free).toBe(2);
    });
  });
});

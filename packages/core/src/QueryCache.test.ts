import { describe, it, expect, beforeEach } from "vitest";
import { QueryCache } from "./QueryCache.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { Component } from "./Component.js";

class Position extends Component {}
class Velocity extends Component {}
class Health extends Component {}

describe("QueryCache", () => {
  let cache: QueryCache;

  beforeEach(() => {
    _resetEntityIdCounter();
    cache = new QueryCache();
  });

  function makeEntity(name: string): Entity {
    const e = new Entity(name);
    e._setScene(null, {
      onComponentAdded: (entity) => cache.onComponentAdded(entity),
      onComponentRemoved: (entity) => cache.onComponentRemoved(entity),
      onEntityActivated: (entity) => cache.onEntityActivated(entity),
      onEntityDeactivated: (entity) => cache.onEntityDeactivated(entity),
    });
    return e;
  }

  it("returns empty query result initially", () => {
    const result = cache.register([Position]);
    expect(result.size).toBe(0);
    expect(result.first).toBeUndefined();
    expect(result.toArray()).toEqual([]);
  });

  it("adds entity to query when components match", () => {
    const result = cache.register([Position]);
    const e = makeEntity("test");
    e.add(new Position());
    expect(result.size).toBe(1);
    expect(result.first).toBe(e);
  });

  it("does not add entity until all required components are present", () => {
    const result = cache.register([Position, Velocity]);
    const e = makeEntity("test");
    e.add(new Position());
    expect(result.size).toBe(0);
    e.add(new Velocity());
    expect(result.size).toBe(1);
  });

  it("removes entity when a required component is removed", () => {
    const result = cache.register([Position, Velocity]);
    const e = makeEntity("test");
    e.add(new Position());
    e.add(new Velocity());
    expect(result.size).toBe(1);
    e.remove(Position);
    expect(result.size).toBe(0);
  });

  it("removes entity on destroy", () => {
    const result = cache.register([Position]);
    const e = makeEntity("test");
    e.add(new Position());
    expect(result.size).toBe(1);
    cache.onEntityDestroyed(e);
    expect(result.size).toBe(0);
  });

  it("supports multiple queries", () => {
    const posQuery = cache.register([Position]);
    const velQuery = cache.register([Velocity]);
    const bothQuery = cache.register([Position, Velocity]);

    const e = makeEntity("test");
    e.add(new Position());
    expect(posQuery.size).toBe(1);
    expect(velQuery.size).toBe(0);
    expect(bothQuery.size).toBe(0);

    e.add(new Velocity());
    expect(posQuery.size).toBe(1);
    expect(velQuery.size).toBe(1);
    expect(bothQuery.size).toBe(1);
  });

  it("supports multiple entities", () => {
    const result = cache.register([Position]);
    const a = makeEntity("a");
    const b = makeEntity("b");
    a.add(new Position());
    b.add(new Position());
    expect(result.size).toBe(2);
    expect(result.toArray()).toContain(a);
    expect(result.toArray()).toContain(b);
  });

  it("QueryResult is iterable", () => {
    const result = cache.register([Position]);
    const e = makeEntity("test");
    e.add(new Position());
    const entities = [...result];
    expect(entities).toEqual([e]);
  });

  it("entity with extra components still matches query", () => {
    const result = cache.register([Position]);
    const e = makeEntity("test");
    e.add(new Position());
    e.add(new Velocity());
    e.add(new Health());
    expect(result.size).toBe(1);
  });

  it("removing a non-required component does not remove from query", () => {
    const result = cache.register([Position]);
    const e = makeEntity("test");
    e.add(new Position());
    e.add(new Velocity());
    expect(result.size).toBe(1);
    e.remove(Velocity);
    expect(result.size).toBe(1);
  });

  it("unregister stops a query from receiving further entity updates", () => {
    const result = cache.register([Position]);
    const e = makeEntity("test");
    e.add(new Position());
    expect(result.size).toBe(1);

    cache.unregister(result);

    const other = makeEntity("other");
    other.add(new Position());
    expect(result.size).toBe(1); // unchanged — no longer tracked
  });

  it("unregister twice is a no-op", () => {
    const result = cache.register([Position]);
    cache.unregister(result);
    expect(() => cache.unregister(result)).not.toThrow();
  });

  it("unregistering one query leaves others tracking", () => {
    const posQuery = cache.register([Position]);
    const velQuery = cache.register([Velocity]);
    cache.unregister(posQuery);

    const e = makeEntity("test");
    e.add(new Position());
    e.add(new Velocity());
    expect(posQuery.size).toBe(0);
    expect(velQuery.size).toBe(1);
  });

  it("register() seeds from entities that already match before registration", () => {
    const e = makeEntity("test");
    e.add(new Position());
    e.add(new Velocity());

    const result = cache.register([Position, Velocity]);
    expect(result.size).toBe(1);
    expect(result.first).toBe(e);
  });

  it("register() re-seeds after a prior unregister instead of starting empty", () => {
    const e = makeEntity("test");
    e.add(new Position());

    const first = cache.register([Position]);
    expect(first.size).toBe(1);
    cache.unregister(first);

    const second = cache.register([Position]);
    expect(second.size).toBe(1);
    expect(second.first).toBe(e);
  });

  it("queryOnce returns currently matching entities", () => {
    const e = makeEntity("test");
    e.add(new Position());

    const result = cache.queryOnce([Position]);
    expect(result.size).toBe(1);
    expect(result.first).toBe(e);
  });

  it("queryOnce does not receive later updates", () => {
    const result = cache.queryOnce([Position]);
    expect(result.size).toBe(0);

    const e = makeEntity("test");
    e.add(new Position());
    expect(result.size).toBe(0);
  });

  it("queryOnce results are unaffected by unregister (they were never registered)", () => {
    const e = makeEntity("test");
    e.add(new Position());

    const result = cache.queryOnce([Position]);
    expect(result.size).toBe(1);

    expect(() => cache.unregister(result)).not.toThrow();
    expect(result.size).toBe(1);
  });
  describe("dormant entities", () => {
    it("leaves every query when deactivated and rejoins when reactivated", () => {
      const e = makeEntity("e");
      e.add(new Position());
      const result = cache.register([Position]);
      expect(result.size).toBe(1);

      e.setActive(false);
      expect(result.size).toBe(0);

      e.setActive(true);
      expect(result.size).toBe(1);
      expect(result.first).toBe(e);
    });

    it("does not join a query for a component added while dormant", () => {
      const e = makeEntity("e");
      e.add(new Position());
      e.setActive(false);
      const result = cache.register([Position, Velocity]);

      e.add(new Velocity());
      expect(result.size).toBe(0);

      e.setActive(true);
      expect(result.size).toBe(1);
    });

    it("does not seed a query registered while the entity is dormant", () => {
      const e = makeEntity("e");
      e.add(new Position());
      e.setActive(false);
      expect(cache.register([Position]).size).toBe(0);
    });
  });
});

describe("QueryCache subclass matching", () => {
  abstract class Base extends Component {}
  class Sub extends Base {}
  class Other extends Component {}

  let cache: QueryCache;

  beforeEach(() => {
    _resetEntityIdCounter();
    cache = new QueryCache();
  });

  function makeEntity(name: string): Entity {
    const e = new Entity(name);
    e._setScene(null, {
      onComponentAdded: (entity) => cache.onComponentAdded(entity),
      onComponentRemoved: (entity) => cache.onComponentRemoved(entity),
      onEntityActivated: (entity) => cache.onEntityActivated(entity),
      onEntityDeactivated: (entity) => cache.onEntityDeactivated(entity),
    });
    return e;
  }

  it("seeds a base-class query from an entity holding only a subclass", () => {
    const e = makeEntity("e");
    e.add(new Sub());
    const result = cache.register([Base]);
    expect(result.toArray()).toEqual([e]);
  });

  it("joins on add, leaves on remove and on going dormant", () => {
    const result = cache.register([Base]);
    const e = makeEntity("e");
    expect(result.size).toBe(0);

    e.add(new Sub());
    expect(result.size).toBe(1);

    e.setActive(false);
    expect(result.size).toBe(0);
    e.setActive(true);
    expect(result.size).toBe(1);

    e.remove(Sub);
    expect(result.size).toBe(0);
  });

  it("requires every filter class, base ones included", () => {
    const result = cache.register([Other, Base]);
    const e = makeEntity("e");
    e.add(new Sub());
    expect(result.size).toBe(0);
    e.add(new Other());
    expect(result.size).toBe(1);
  });
});

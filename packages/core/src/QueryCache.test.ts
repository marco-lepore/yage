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
});

import { describe, expect, it } from "vitest";
import { RoomGenerator } from "./RoomGenerator.js";
import {
  isRoomLayoutWalkable,
  roomOpenings,
  validateRoomLayout,
} from "./layout.js";
import { crossRoom, roomDefinition } from "./test-fixtures.js";
import type { RoomDefinition, RoomGenerationOptions } from "./types.js";

describe("RoomGenerator", () => {
  it("realises the graph and connects the actual floor across 100 seeds", () => {
    const definition = roomDefinition(),
      layouts = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const job = new RoomGenerator(definition, { seed }),
        layout = job.generate()!;
      expect(job.status).toBe("succeeded");
      expect(validateRoomLayout(definition, layout)).toEqual([]);
      expect(new Set(layout.connections.map((c) => c.id))).toEqual(
        new Set(["a", "b", "c"]),
      );
      layouts.add(JSON.stringify(layout.rooms));
      const floor = new Set<string>();
      for (const room of layout.rooms)
        for (let y = room.y; y < room.y + room.height; y++)
          for (let x = room.x; x < room.x + room.width; x++)
            if (isRoomLayoutWalkable(definition, layout, { x, y }))
              floor.add(`${x},${y}`);
      const queue = [floor.values().next().value!];
      floor.delete(queue[0]!);
      for (let i = 0; i < queue.length; i++) {
        const [x, y] = queue[i]!.split(",").map(Number) as [number, number];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const key = `${x + dx!},${y + dy!}`;
          if (floor.delete(key)) queue.push(key);
        }
      }
      expect(floor.size).toBe(0);
    }
    expect(layouts.size).toBeGreaterThan(20);
  });
  it("selects a two-tile opening at the position required by bounds", () => {
    const a = {
      ...crossRoom,
      id: "a",
      kinds: ["a"],
      size: { width: 7, height: 5 },
      navigation: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
      connections: [
        {
          id: "south",
          side: "south" as const,
          offset: { min: 1, max: 4 },
          width: 2,
        },
      ],
    };
    const b = {
      ...crossRoom,
      id: "b",
      kinds: ["b"],
      connections: [
        { id: "north", side: "north" as const, offset: 1, width: 2 },
      ],
    };
    const definition: RoomDefinition = {
      id: "range",
      revision: "1",
      templates: [a, b],
      graph: {
        start: "a",
        regions: [
          { id: "a", kind: "a" },
          { id: "b", kind: "b" },
        ],
        connections: [{ id: "join", from: "a", to: "b" }],
      },
    };
    const layout = new RoomGenerator(definition, {
      seed: 42,
      bounds: { x: 0, y: 0, width: 7, height: 10 },
    }).generate()!;
    expect(layout).not.toBeNull();
    const edge = layout.connections[0]!;
    expect(edge.fromOpening.width).toBe(2);
    expect(edge.fromOpening.offset).toBeGreaterThanOrEqual(1);
    expect(edge.fromOpening.offset).toBeLessThanOrEqual(3);
    for (let x = 0; x < 7; x++)
      expect(isRoomLayoutWalkable(definition, layout, { x, y: 4 })).toBe(
        x >= edge.fromOpening.offset && x < edge.fromOpening.offset + 2,
      );
    expect(roomOpenings(layout, "b")).toEqual([edge.toOpening]);
  });
  it("embeds a four-room cycle instead of requiring a parent tree", () => {
    const definition: RoomDefinition = {
      ...roomDefinition(),
      graph: {
        start: "a",
        regions: ["a", "b", "c", "d"].map((id) => ({ id, kind: "hall" })),
        connections: [
          { id: "ab", from: "a", to: "b" },
          { id: "bc", from: "b", to: "c" },
          { id: "cd", from: "c", to: "d" },
          { id: "da", from: "d", to: "a" },
        ],
      },
    };
    for (let seed = 0; seed < 10; seed++) {
      const layout = new RoomGenerator(definition, {
        seed,
        maxSteps: 100000,
      }).generate()!;
      expect(layout).not.toBeNull();
      expect(layout.connections).toHaveLength(4);
      expect(validateRoomLayout(definition, layout)).toEqual([]);
    }
  });
  it("places footprints without masks and refuses to claim or query walkability", () => {
    const definition = {
      ...roomDefinition(),
      templates: roomDefinition().templates.map((template) => ({
        id: template.id,
        kinds: template.kinds,
        size: template.size,
        connections: template.connections,
      })),
    };
    const layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
    expect(layout.validation.connectedWalkableCells).toBeNull();
    expect(validateRoomLayout(definition, layout)).toEqual([]);
    expect(() =>
      isRoomLayoutWalkable(definition, layout, { x: 2, y: 2 }),
    ).toThrow("navigation mask");
    expect(
      validateRoomLayout(definition, {
        ...layout,
        validation: { ...layout.validation, connectedWalkableCells: true },
      }),
    ).toContain("Layout validation claims do not match available geometry.");
  });
  it("is independent of frame chunks and copies caller inputs", () => {
    const options = { seed: 72, origin: { x: 1, y: 2 } },
      definition = roomDefinition();
    const one = new RoomGenerator(definition, options),
      many = new RoomGenerator(definition, options);
    options.origin.x = 6;
    while (one.status === "running") one.step(1);
    many.generate();
    expect(one.result).toEqual(many.result);
    expect(one.steps).toBe(many.steps);
    expect(one.result!.rooms[0]!.x).toBe(1);
    expect(Object.isFrozen(definition)).toBe(false);
    expect(Object.isFrozen(one.result!.rooms[0])).toBe(true);
  });
  it("backtracks into a bounded strip", () => {
    const base = roomDefinition();
    const definition = {
      ...base,
      graph: {
        start: "start",
        regions: base.graph.regions.slice(0, 3),
        connections: base.graph.connections.slice(0, 2),
      },
    };
    const job = new RoomGenerator(definition, {
      seed: 5,
      bounds: { x: 0, y: 0, width: 15, height: 5 },
    });
    expect(job.generate()).not.toBeNull();
    expect(job.result!.rooms.map((r) => r.x)).toEqual([0, 5, 10]);
    expect(job.inspect().rejections.bounds).toBeGreaterThan(0);
  });
  it("distinguishes bounded failure, exhaustive rejection and cancellation", () => {
    const budget = new RoomGenerator(roomDefinition(), {
      seed: 0,
      maxSteps: 1,
    });
    expect(budget.generate()).toBeNull();
    expect(budget.status).toBe("budget-exceeded");
    expect(
      budget
        .inspect()
        .diagnostics.some((d) => d.message.includes("does not prove")),
    ).toBe(true);
    const impossible = new RoomGenerator(
      { ...roomDefinition(), maxUses: { cross: 0, other: 0 } },
      { seed: 0 },
    );
    expect(impossible.generate()).toBeNull();
    expect(impossible.status).toBe("exhausted");
    const cancelled = new RoomGenerator(roomDefinition(), { seed: 0 });
    cancelled.step(1);
    cancelled.cancel();
    const steps = cancelled.steps;
    cancelled.generate();
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.steps).toBe(steps);
  });
  it("round trips snapshots and rejects tampered graphs, openings and placements", () => {
    const job = new RoomGenerator(roomDefinition(), { seed: 42 });
    expect(() => job.snapshot()).toThrow("completed layout");
    job.generate();
    const snapshot = job.snapshot();
    expect(
      RoomGenerator.restore(
        JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
      ).snapshot(),
    ).toEqual(snapshot);
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        version: 2,
      } as unknown as typeof snapshot),
    ).toThrow("version 2");
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        definition: { ...snapshot.definition, revision: "changed" },
      }),
    ).toThrow("revision");
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        layout: { ...snapshot.layout, rooms: snapshot.layout.rooms.slice(1) },
      }),
    ).toThrow("Required region");
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        layout: { ...snapshot.layout, connections: [] },
      }),
    ).toThrow("connection");
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        layout: {
          ...snapshot.layout,
          rooms: snapshot.layout.rooms.map((room) => ({
            ...room,
            x: room.x + 1,
          })),
        },
      }),
    ).toThrow("origin");
    const edge = snapshot.layout.connections[0]!;
    expect(() =>
      RoomGenerator.restore({
        ...snapshot,
        layout: {
          ...snapshot.layout,
          connections: [
            { ...edge, fromOpening: { ...edge.fromOpening, width: 10 } },
            ...snapshot.layout.connections.slice(1),
          ],
        },
      }),
    ).toThrow("undeclared opening");
  });
  it.each([NaN, Infinity, -1, 1.5, 0x1_0000_0000])(
    "rejects invalid seed %s",
    (seed) =>
      expect(() => new RoomGenerator(roomDefinition(), { seed })).toThrow(
        "seed",
      ),
  );
  it.each([
    { seed: 0, maxSteps: 0 },
    { seed: 0, origin: { x: Infinity, y: 0 } },
    { seed: 0, bounds: { x: 0, y: 0, width: 1.5, height: 5 } },
  ] satisfies RoomGenerationOptions[])("validates options %s", (options) =>
    expect(() => new RoomGenerator(roomDefinition(), options)).toThrow(),
  );
  it("rejects disconnected masks, invalid opening ranges and unknown region kinds", () => {
    const base = roomDefinition();
    const invalid: RoomDefinition[] = [
      {
        ...base,
        templates: [
          {
            ...crossRoom,
            navigation: ["#####", "#.#.#", "#.#.#", "#.#.#", "#####"],
          },
        ],
      },
      {
        ...base,
        templates: [
          {
            ...crossRoom,
            connections: [
              { id: "bad", side: "north", offset: { min: 2, max: 4 } },
            ],
          },
        ],
      },
      { ...base, templates: [{ ...crossRoom, kinds: ["missing"] }] },
    ];
    for (const definition of invalid)
      expect(() => new RoomGenerator(definition, { seed: 0 })).toThrow();
  });
});

import { expect, it } from "vitest";
import { CatalogGenerator } from "./CatalogGenerator.js";
import { RegionGraphGenerator } from "./RegionGraphGenerator.js";
import { RoomGenerator } from "./RoomGenerator.js";
import { inspectProgression, validateRegionGraph } from "./progression.js";
import { dungeonRequirements, crossRoom } from "./test-fixtures.js";
import { createRoomLayoutGraph } from "../navigation.js";
import type { RegionGraph, RoomDefinition } from "./types.js";

it("generates the fifteen-room contract and enforces both keys in physical navigation", () => {
  for (let seed = 0; seed < 30; seed++) {
    const graphJob = new RegionGraphGenerator(dungeonRequirements, { seed }),
      graph = graphJob.generate()!;
    expect(graphJob.status).toBe("succeeded");
    expect(graph.regions).toHaveLength(15);
    expect(validateRegionGraph(graph)).toEqual([]);
    for (const kind of ["shop", "forge", "boss"])
      expect(graph.regions.filter((r) => r.kind === kind)).toHaveLength(1);
    expect(graph.regions.filter((r) => r.kind === "treasure")).toHaveLength(2);
    for (const edge of graph.connections) {
      const kinds = [edge.from, edge.to].map(
        (id) => graph.regions.find((r) => r.id === id)!.kind,
      );
      expect(kinds.sort()).not.toEqual(["forge", "shop"]);
    }
    const definition: RoomDefinition = {
      graph,
      templates: [
        {
          ...crossRoom,
          kinds: ["start", "hall", "treasure", "shop", "forge", "boss"],
        },
      ],
    };
    const job = new RoomGenerator(definition, { seed, maxSteps: 200000 }),
      layout = job.generate()!;
    expect(
      job.status,
      `seed ${seed}: ${JSON.stringify(job.inspect().rejections)}`,
    ).toBe("succeeded");
    const point = (id: string) => {
      const room = layout.regions.find((r) => r.id === id)!;
      return { x: room.x + 2.5, y: room.y + 2.5 };
    };
    const keys: string[] = [];
    const nav = createRoomLayoutGraph(layout, {
      tileWidth: 1,
      tileHeight: 1,
      hasKey: (key) => keys.includes(key),
    });
    // One graph for the whole run: it reads the current keys on every query.
    for (const held of [[], ["key-a"], ["key-b"], ["key-a", "key-b"]]) {
      keys.splice(0, keys.length, ...held);
      expect(nav.findPath(point("start"), point("treasure-a"))).not.toBeNull();
      expect(nav.findPath(point("start"), point("treasure-b"))).not.toBeNull();
      expect(nav.findPath(point("start"), point("boss")) !== null).toBe(
        held.length === 2,
      );
    }
  }
});
it("validates reusable-key collection through cycles and detects inaccessible keys", () => {
  const graph: RegionGraph = {
    start: "start",
    regions: [
      { id: "start", kind: "room" },
      { id: "key", kind: "room", grants: ["red"] },
      { id: "boss", kind: "room", requires: ["red"] },
    ],
    connections: [
      { id: "a", from: "start", to: "key" },
      { id: "b", from: "key", to: "boss" },
      { id: "c", from: "start", to: "boss" },
    ],
  };
  expect(validateRegionGraph(graph)).toEqual([]);
  expect(
    inspectProgression(graph, { collectKeys: false }).reachable,
  ).not.toContain("boss");
  expect(
    inspectProgression(graph, { keys: ["red"], collectKeys: false }).reachable,
  ).toContain("boss");
  expect(inspectProgression(graph).reachable).toContain("boss");
  expect(
    validateRegionGraph({
      ...graph,
      regions: graph.regions.map((r) =>
        r.id === "key" ? { ...r, requires: ["red"] } : r,
      ),
    }),
  ).toHaveLength(2);
  // Parallel connections are two doors between the same pair of regions.
  expect(
    validateRegionGraph({
      ...graph,
      connections: [
        ...graph.connections,
        { id: "d", from: "start", to: "key" },
      ],
    }),
  ).toEqual([]);
  expect(
    validateRegionGraph({
      ...graph,
      connections: [
        ...graph.connections,
        { id: "d", from: "key", to: "key" },
        { id: "a", from: "start", to: "ghost" },
      ],
    }),
  ).toEqual([
    'Connection "d" connects a region to itself.',
    'Duplicate connection "a".',
    'Connection "a" has an unknown endpoint.',
  ]);
});
it("keeps graph generation deterministic across chunks and distinguishes impossible adjacency from budget limits", () => {
  const a = new RegionGraphGenerator(dungeonRequirements, { seed: 7 }),
    b = new RegionGraphGenerator(dungeonRequirements, { seed: 7 });
  while (a.status === "running") a.step(1);
  b.generate();
  expect(a.result).toEqual(b.result);
  const impossible = new RegionGraphGenerator(
    {
      start: { id: "a", kind: "a" },
      required: [{ id: "b", kind: "b" }],
      minRegions: 2,
      fillKind: "b",
      forbiddenConnections: [["a", "b"]],
    },
    { seed: 0 },
  );
  expect(impossible.generate()).toBeNull();
  expect(impossible.status).toBe("exhausted");
  const budget = new RegionGraphGenerator(dungeonRequirements, {
    seed: 0,
    maxSteps: 1,
  });
  budget.generate();
  expect(budget.status).toBe("budget-exceeded");
});
it("creates min regions of a kind, or a seeded count up to max", () => {
  const counted = (seed: number, max?: number): number => {
    const graph = new RegionGraphGenerator(
      {
        ...dungeonRequirements,
        counts: [{ kind: "shop", min: 1, ...(max ? { max } : {}) }],
        minRegions: 4,
      },
      { seed },
    ).generate()!;
    return graph.regions.filter((r) => r.kind === "shop").length;
  };
  expect(counted(0)).toBe(1);
  const seeded = new Set(
    Array.from({ length: 20 }, (_, seed) => counted(seed, 3)),
  );
  expect([...seeded].sort()).toEqual([1, 2, 3]);
  // Named regions above min are allowed when max is omitted.
  const graph = new RegionGraphGenerator(
    { ...dungeonRequirements, counts: [{ kind: "treasure", min: 1 }] },
    { seed: 0 },
  ).generate()!;
  expect(graph.regions.filter((r) => r.kind === "treasure")).toHaveLength(2);
});
it("rejects invalid counts and unknown keys before generation", () => {
  expect(
    () =>
      new RegionGraphGenerator(
        {
          ...dungeonRequirements,
          counts: [{ kind: "treasure", min: 1, max: 1 }],
        },
        { seed: 0 },
      ),
  ).toThrow("exceed");
  expect(
    () =>
      new RegionGraphGenerator(
        { ...dungeonRequirements, minRegions: NaN },
        { seed: 0 },
      ),
  ).toThrow("minRegions");
  expect(
    () =>
      new RegionGraphGenerator(
        {
          ...dungeonRequirements,
          required: [{ id: "boss", kind: "boss", requires: ["missing"] }],
        },
        { seed: 0 },
      ),
  ).toThrow("which no region grants");
  expect(
    () =>
      new RegionGraphGenerator(
        {
          ...dungeonRequirements,
          start: { id: "start", kind: "start", requires: ["key-a"] },
        },
        { seed: 0 },
      ),
  ).toThrow("cannot require keys");
});
it("accepts keys the player holds before the start region", () => {
  const graph: RegionGraph = {
    start: "a",
    regions: [
      { id: "a", kind: "room" },
      { id: "b", kind: "room" },
    ],
    connections: [{ id: "door", from: "a", to: "b", requires: ["lantern"] }],
  };
  expect(validateRegionGraph(graph)).toEqual([
    '"door" requires key "lantern", which no region grants.',
  ]);
  expect(validateRegionGraph(graph, { keys: ["lantern"] })).toEqual([]);
  expect(inspectProgression(graph, { keys: ["lantern"] }).reachable).toEqual([
    "a",
    "b",
  ]);
  // Catalog generation checks structure only; progression is the game's call.
  expect(
    new CatalogGenerator(
      {
        graph,
        templates: [
          { id: "room", kinds: ["room"], connections: [{ id: "d" }] },
        ],
      },
      { seed: 0 },
    ).generate()?.connections,
  ).toHaveLength(1);
});
it("draws new counts when a ranged draw cannot be completed", () => {
  // Three of the four draws of "x" leave an x region with no allowed
  // neighbour; each seed has to find the draw with no x regions.
  for (let seed = 0; seed < 10; seed++) {
    const job = new RegionGraphGenerator(
      {
        start: { id: "s", kind: "s" },
        counts: [{ kind: "x", min: 0, max: 2 }],
        minRegions: 3,
        fillKind: "f",
        forbiddenConnections: [
          ["s", "x"],
          ["x", "x"],
          ["x", "f"],
        ],
      },
      { seed },
    );
    expect(job.generate()?.regions.map((r) => r.kind)).toEqual(["s", "f", "f"]);
  }
  expect(
    () =>
      new RegionGraphGenerator(
        {
          start: { id: "s", kind: "s" },
          counts: [{ kind: "room", min: 0, max: 2 }],
          minRegions: 10,
          fillKind: "room",
        },
        { seed: 0 },
      ),
  ).toThrow('needs at least 9 "room" regions, over its max of 2');
});

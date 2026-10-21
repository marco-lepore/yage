import { expect, it } from "vitest";
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
      id: "dungeon",
      revision: "1",
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
      const room = layout.rooms.find((r) => r.id === id)!;
      return { x: room.x + 2.5, y: room.y + 2.5 };
    };
    for (const keys of [[], ["key-a"], ["key-b"], ["key-a", "key-b"]]) {
      const nav = createRoomLayoutGraph(
        definition,
        layout,
        { tileWidth: 1, tileHeight: 1 },
        { keys },
      );
      expect(nav.findPath(point("start"), point("treasure-a"))).not.toBeNull();
      expect(nav.findPath(point("start"), point("treasure-b"))).not.toBeNull();
      expect(nav.findPath(point("start"), point("boss")) !== null).toBe(
        keys.length === 2,
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
  expect(inspectProgression(graph, [], false).reachable).not.toContain("boss");
  expect(inspectProgression(graph).reachable).toContain("boss");
  expect(
    validateRegionGraph({
      ...graph,
      regions: graph.regions.map((r) =>
        r.id === "key" ? { ...r, requires: ["red"] } : r,
      ),
    }),
  ).toHaveLength(2);
  expect(
    validateRegionGraph({
      ...graph,
      connections: [
        ...graph.connections,
        { id: "d", from: "start", to: "key" },
      ],
    }).join(),
  ).toContain("repeated");
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
it("rejects invalid counts and unknown keys before generation", () => {
  expect(
    () =>
      new RegionGraphGenerator(
        { ...dungeonRequirements, counts: [{ kind: "treasure", min: 1 }] },
        { seed: 0 },
      ),
  ).toThrow("maximum");
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
  ).toThrow("unknown key");
});

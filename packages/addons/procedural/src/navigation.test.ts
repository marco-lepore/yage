import { expect, it, vi } from "vitest";
import * as catalog from "./core/catalog.js";
import { isRoomLayoutWalkable } from "./core/layout.js";
import { RoomGenerator } from "./core/RoomGenerator.js";
import { crossRoom, roomDefinition } from "./core/test-fixtures.js";
import type { RoomDefinition } from "./core/types.js";
import { createRoomLayoutGraph } from "./navigation.js";

it("routes the same tile layout at different world scales, including rectangular tiles", () => {
  const definition = roomDefinition();
  for (let seed = 0; seed < 30; seed++) {
    const layout = new RoomGenerator(definition, {
      seed,
      origin: { x: -3, y: 2 },
    }).generate()!;
    for (const scale of [
      { tileWidth: 16, tileHeight: 16 },
      { tileWidth: 32, tileHeight: 24 },
    ]) {
      const graph = createRoomLayoutGraph(definition, layout, scale);
      const root = layout.rooms[0]!;
      for (const room of layout.rooms) {
        const start = {
          x: (root.x + 2.5) * scale.tileWidth,
          y: (root.y + 2.5) * scale.tileHeight,
        };
        const end = {
          x: (room.x + 2.5) * scale.tileWidth,
          y: (room.y + 2.5) * scale.tileHeight,
        };
        const path = graph.findPath(start, end);
        expect(path).not.toBeNull();
        expect(path!.waypoints[0]).toMatchObject(start);
        expect(path!.waypoints.at(-1)).toMatchObject(end);
      }
      expect(() =>
        createRoomLayoutGraph(definition, layout, scale, { maxCells: 1 }),
      ).toThrow("cell count");
    }
    expect(layout.rooms[0]).toMatchObject({ x: -3, y: 2, width: 5, height: 5 });
  }
});

it("keeps graph navigation stable when caller-owned definitions or scale change", () => {
  const definition = { ...roomDefinition() };
  const scale = { tileWidth: 16, tileHeight: 32 };
  const layout = new RoomGenerator(definition, { seed: 7 }).generate()!;
  const graph = createRoomLayoutGraph(definition, layout, scale);
  const from = layout.rooms[0]!,
    to = layout.rooms[1]!;
  const start = { x: from.x * 16 + 40, y: from.y * 32 + 80 };
  const end = { x: to.x * 16 + 40, y: to.y * 32 + 80 };
  const path = graph.findPath(start, end);
  expect(path).not.toBeNull();
  scale.tileWidth = 100;
  scale.tileHeight = 200;
  definition.templates = [];
  expect(graph.findPath(start, end)).toEqual(path);
});

it("preserves variant masks, wide openings and region/connection locks when rebuilding", () => {
  const definition: RoomDefinition = {
    id: "locks",
    revision: "1",
    templates: [
      {
        ...crossRoom,
        connections: [
          { id: "e", side: "east", offset: 1, width: 2 },
          { id: "w", side: "west", offset: 1, width: 2 },
        ],
        variants: [
          { id: "open", regionIds: ["start", "middle"] },
          {
            id: "obstacle",
            regionIds: ["goal"],
            navigation: ["#####", "#...#", "#.#.#", "#...#", "#####"],
          },
        ],
      },
    ],
    graph: {
      start: "start",
      regions: [
        { id: "start", kind: "hall", grants: ["region-key", "edge-key"] },
        { id: "middle", kind: "hall", requires: ["region-key"] },
        { id: "goal", kind: "hall" },
      ],
      connections: [
        { id: "a", from: "start", to: "middle" },
        { id: "b", from: "middle", to: "goal", requires: ["edge-key"] },
      ],
    },
  };
  const layout = new RoomGenerator(definition, {
    seed: 0,
    origin: { x: -5, y: -2 },
    bounds: { x: -5, y: -2, width: 15, height: 5 },
  }).generate()!;
  expect(layout).not.toBeNull();
  const scale = { tileWidth: 16, tileHeight: 32 };
  for (const keys of [
    [],
    ["region-key"],
    ["edge-key"],
    ["region-key", "edge-key"],
  ]) {
    const graph = createRoomLayoutGraph(definition, layout, scale, { keys });
    const start = graph.cellToWorld(1, 1);
    expect(graph.findPath(start, graph.cellToWorld(6, 1)) !== null).toBe(
      keys.includes("region-key"),
    );
    expect(graph.findPath(start, graph.cellToWorld(11, 1)) !== null).toBe(
      keys.length === 2,
    );
    expect(
      graph.findPath(graph.cellToWorld(11, 2), graph.cellToWorld(12, 2)),
    ).toBeNull();
    for (let row = 0; row < graph.rows; row++)
      for (let col = 0; col < graph.cols; col++) {
        const source = graph.cellToWorld(col === 0 ? 1 : col - 1, row);
        const target = graph.cellToWorld(col, row);
        expect(graph.findPath(source, target) !== null).toBe(
          isRoomLayoutWalkable(
            definition,
            layout,
            { x: col - 5, y: row - 2 },
            keys,
          ),
        );
      }
  }
});

it("bounds catalog resolution work when building sixty-four 64x64 rooms", () => {
  const count = 64,
    size = 64;
  const definition: RoomDefinition = {
    id: "large",
    revision: "1",
    templates: [
      {
        ...crossRoom,
        variants: [
          {
            id: "large",
            metadata: { theme: "ruins" },
            size: { width: size, height: size },
            navigation: Array.from({ length: size }, (_, row) =>
              row === 0 || row === size - 1
                ? "#".repeat(size)
                : `#${".".repeat(size - 2)}#`,
            ),
            connections: [
              { id: "e", side: "east", offset: 31, width: 2 },
              { id: "w", side: "west", offset: 31, width: 2 },
            ],
          },
        ],
      },
    ],
    graph: {
      start: "room-0",
      regions: Array.from({ length: count }, (_, i) => ({
        id: `room-${i}`,
        kind: "hall",
      })),
      connections: Array.from({ length: count - 1 }, (_, i) => ({
        id: `edge-${i}`,
        from: `room-${i}`,
        to: `room-${i + 1}`,
      })),
    },
  };
  const layout = new RoomGenerator(definition, {
    seed: 0,
    bounds: { x: 0, y: 0, width: count * size, height: size },
  }).generate()!;
  expect(layout).not.toBeNull();
  const resolve = catalog.resolveRoomTemplate;
  let resolutions = 0;
  const spy = vi
    .spyOn(catalog, "resolveRoomTemplate")
    .mockImplementation((...args) => {
      if (++resolutions > count * 8)
        throw new Error(
          "Grid construction exceeded the per-room catalog resolution budget",
        );
      return resolve(...args);
    });
  try {
    const graph = createRoomLayoutGraph(definition, layout, {
      tileWidth: 1,
      tileHeight: 1,
    });
    expect(graph.cols * graph.rows).toBe(count * size * size);
    const path = graph.findPath(
      graph.cellToWorld(1, 31),
      graph.cellToWorld(count * size - 2, 31),
    );
    expect(path).not.toBeNull();
    expect(path!.cells).toHaveLength(count * size - 2);
    expect(resolutions).toBeGreaterThan(0);
  } finally {
    spy.mockRestore();
  }
});

it.each([NaN, Infinity, 0, -1, 1.5, 1_000_001])(
  "rejects invalid world tile dimensions %s",
  (value) => {
    const definition = roomDefinition();
    const layout = new RoomGenerator(definition, { seed: 0 }).generate()!;
    expect(() =>
      createRoomLayoutGraph(definition, layout, {
        tileWidth: value,
        tileHeight: 16,
      }),
    ).toThrow("tileWidth");
    expect(() =>
      createRoomLayoutGraph(definition, layout, {
        tileWidth: 16,
        tileHeight: value,
      }),
    ).toThrow("tileHeight");
  },
);

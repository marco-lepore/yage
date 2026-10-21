import { expect, it } from "vitest";
import { isRoomLayoutWalkable } from "./core/layout.js";
import { RoomGenerator } from "./core/RoomGenerator.js";
import { crossRoom, roomDefinition } from "./core/test-fixtures.js";
import type { RoomDefinition } from "./core/types.js";
import { createRoomLayoutGraph, createTileMapGraph } from "./navigation.js";

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
      { tileWidth: 12.5, tileHeight: 10 },
    ]) {
      const graph = createRoomLayoutGraph(layout, scale);
      const root = layout.regions[0]!;
      for (const room of layout.regions) {
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
    }
    expect(layout.regions[0]).toMatchObject({
      x: -3,
      y: 2,
      width: 5,
      height: 5,
    });
  }
});

it("keeps routing unchanged when the caller's scale object changes afterwards", () => {
  const scale = { tileWidth: 16, tileHeight: 32 };
  const layout = new RoomGenerator(roomDefinition(), { seed: 7 }).generate()!;
  const graph = createRoomLayoutGraph(layout, scale);
  const from = layout.regions[0]!,
    to = layout.regions[1]!;
  const start = { x: from.x * 16 + 40, y: from.y * 32 + 80 };
  const end = { x: to.x * 16 + 40, y: to.y * 32 + 80 };
  const path = graph.findPath(start, end);
  expect(path).not.toBeNull();
  scale.tileWidth = 100;
  scale.tileHeight = 200;
  expect(graph.findPath(start, end)).toEqual(path);
});

it("opens region and connection locks as keys arrive, without a rebuild", () => {
  const definition: RoomDefinition = {
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
  const keys = new Set<string>();
  const hasKey = (key: string): boolean => keys.has(key);
  const graph = createRoomLayoutGraph(layout, {
    tileWidth: 16,
    tileHeight: 32,
    hasKey,
  });
  for (const held of [
    [],
    ["region-key"],
    ["edge-key"],
    ["region-key", "edge-key"],
  ]) {
    keys.clear();
    for (const key of held) keys.add(key);
    const start = graph.cellToWorld(1, 1);
    expect(graph.findPath(start, graph.cellToWorld(6, 1)) !== null).toBe(
      keys.has("region-key"),
    );
    expect(graph.findPath(start, graph.cellToWorld(11, 1)) !== null).toBe(
      keys.size === 2,
    );
    // The goal variant's mask blocks its centre tile.
    expect(
      graph.findPath(graph.cellToWorld(11, 2), graph.cellToWorld(12, 2)),
    ).toBeNull();
    for (let row = 0; row < graph.rows; row++)
      for (let col = 0; col < graph.cols; col++) {
        const source = graph.cellToWorld(col === 0 ? 1 : col - 1, row);
        const target = graph.cellToWorld(col, row);
        expect(graph.findPath(source, target) !== null).toBe(
          isRoomLayoutWalkable(layout, { x: col - 5, y: row - 2 }, hasKey),
        );
      }
  }
});

it("builds navigation for sixty-four 64x64 rooms", () => {
  const count = 64,
    size = 64;
  const definition: RoomDefinition = {
    templates: [
      {
        id: "large",
        kinds: ["hall"],
        size: { width: size, height: size },
        connections: [
          { id: "e", side: "east", offset: 31, width: 2 },
          { id: "w", side: "west", offset: 31, width: 2 },
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
  const graph = createRoomLayoutGraph(layout, { tileWidth: 1, tileHeight: 1 });
  expect(graph.cols * graph.rows).toBe(count * size * size);
  const path = graph.findPath(
    graph.cellToWorld(1, 31),
    graph.cellToWorld(count * size - 2, 31),
  );
  expect(path).not.toBeNull();
  expect(path!.cells).toHaveLength(count * size - 2);
});

it.each([NaN, Infinity, 0, -1])(
  "rejects invalid world tile dimensions %s",
  (value) => {
    const layout = new RoomGenerator(roomDefinition(), { seed: 0 }).generate()!;
    expect(() =>
      createRoomLayoutGraph(layout, { tileWidth: value, tileHeight: 16 }),
    ).toThrow("tileWidth");
    expect(() =>
      createTileMapGraph(
        { origin: { x: 0, y: 0 }, cells: ["###", "#.#", "###"] },
        { tileWidth: 16, tileHeight: value },
      ),
    ).toThrow("tileHeight");
  },
);

it("navigates a tile map from its origin and rejects ragged rows", () => {
  const graph = createTileMapGraph(
    { origin: { x: 10, y: -2 }, cells: ["#####", "#...#", "#####"] },
    { tileWidth: 8, tileHeight: 8 },
  );
  expect(graph.origin).toMatchObject({ x: 80, y: -16 });
  expect(graph.findPath({ x: 92, y: -4 }, { x: 108, y: -4 })).not.toBeNull();
  expect(() =>
    createTileMapGraph(
      { origin: { x: 0, y: 0 }, cells: ["###", "#.", "###"] },
      { tileWidth: 8, tileHeight: 8 },
    ),
  ).toThrow("equal-length rows");
});

import { RegionGraphGenerator } from "@yagejs-addons/procedural";
import type {
  CatalogRules,
  RegionGraph,
  RegionRequirements,
  RoomConnectionArea,
  RoomDefinition,
  RoomTemplate,
  TileBounds,
} from "@yagejs-addons/procedural";
import { COLORS } from "./constants.js";

// ---------------------------------------------------------------------------
// Room catalog — footprints in tiles, walls included
// ---------------------------------------------------------------------------

/** Where a 9 × 7 room may open: any wall tile at least two tiles from a corner. */
const SMALL_DOORS: readonly RoomConnectionArea[] = [
  { id: "north", side: "north", offset: { min: 2, max: 6 } },
  { id: "south", side: "south", offset: { min: 2, max: 6 } },
  { id: "east", side: "east", offset: { min: 2, max: 4 } },
  { id: "west", side: "west", offset: { min: 2, max: 4 } },
];
const SMALL = { width: 9, height: 7 };

export const TEMPLATES: readonly RoomTemplate[] = [
  // No mask: walls on the boundary, an open floor inside.
  {
    id: "entry",
    kinds: ["entrance"],
    size: SMALL,
    connections: SMALL_DOORS,
    metadata: { color: COLORS.start },
  },
  {
    id: "hall",
    kinds: ["encounter"],
    size: SMALL,
    connections: SMALL_DOORS,
    variants: [
      { id: "stone", weight: 3, metadata: { color: COLORS.floor } },
      { id: "moss", weight: 1, tags: ["moss"], metadata: { color: 0x355e4b } },
    ],
  },
  {
    id: "shop",
    kinds: ["shop"],
    size: SMALL,
    connections: SMALL_DOORS,
    // A counter across the middle of the room.
    navigation: [
      "#########",
      "#.......#",
      "#..###..#",
      "#.......#",
      "#.......#",
      "#.......#",
      "#########",
    ],
    metadata: { color: COLORS.special, merchant: "traveller" },
    variants: [
      { id: "weapons", weight: 4, metadata: { stock: "weapons" } },
      {
        id: "healing",
        weight: 1,
        tags: ["healing"],
        metadata: { stock: "potions", color: 0x6b4a7a },
      },
    ],
  },
  {
    id: "forge",
    kinds: ["forge"],
    size: SMALL,
    connections: SMALL_DOORS,
    // Four pillars around the anvil.
    navigation: [
      "#########",
      "#.......#",
      "#.#...#.#",
      "#.......#",
      "#.#...#.#",
      "#.......#",
      "#########",
    ],
    metadata: { color: COLORS.special },
  },
  {
    id: "treasure",
    kinds: ["treasure"],
    size: SMALL,
    connections: SMALL_DOORS,
    metadata: { color: 0x7a5a2b },
  },
  {
    id: "boss",
    kinds: ["boss"],
    size: { width: 13, height: 9 },
    connections: [
      { id: "north", side: "north", offset: { min: 2, max: 10 } },
      { id: "south", side: "south", offset: { min: 2, max: 10 } },
      { id: "east", side: "east", offset: { min: 2, max: 6 } },
      { id: "west", side: "west", offset: { min: 2, max: 6 } },
    ],
    navigation: [
      "#############",
      "#...........#",
      "#...........#",
      "#..#.....#..#",
      "#...........#",
      "#..#.....#..#",
      "#...........#",
      "#...........#",
      "#############",
    ],
    metadata: { color: COLORS.boss },
  },
];

// ---------------------------------------------------------------------------
// What the dungeon must contain
// ---------------------------------------------------------------------------

/**
 * Fifteen regions: an entrance, two shops, a forge, two treasure rooms that
 * each grant a key, and a boss room that needs both keys. Shops never touch
 * the forge, and no region has more than three neighbours.
 */
export const REQUIREMENTS: RegionRequirements = {
  start: { id: "start", kind: "entrance" },
  required: [
    { id: "treasure-a", kind: "treasure", grants: ["key-a"] },
    { id: "treasure-b", kind: "treasure", grants: ["key-b"] },
    { id: "boss", kind: "boss", requires: ["key-a", "key-b"] },
  ],
  counts: [
    { kind: "shop", min: 2 },
    { kind: "forge", min: 1 },
  ],
  minRegions: 15,
  fillKind: "encounter",
  forbiddenConnections: [["shop", "forge"]],
  maxConnections: 3,
};

/** Exactly one healing shop, and two to five mossy halls. */
export const RULES: CatalogRules = {
  counts: [
    { match: { tags: ["healing"] }, min: 1, max: 1 },
    { match: { tags: ["moss"] }, min: 2, max: 5 },
  ],
};
/**
 * Bounds that hold the entrance room and nothing else. Every other room falls
 * outside, so the search tries every candidate and fails.
 */
export const IMPOSSIBLE_BOUNDS: TileBounds = { x: 0, y: 0, ...SMALL };

/** The region graph for one seed. Graph generation is fast, so it runs in one call. */
export function dungeonGraph(seed: number): RegionGraph {
  const job = new RegionGraphGenerator(REQUIREMENTS, { seed });
  const graph = job.generate();
  if (!graph) throw new Error(`Region graph generation ended ${job.status}`);
  return graph;
}

export function dungeonDefinition(graph: RegionGraph): RoomDefinition {
  return { graph, templates: TEMPLATES, rules: RULES };
}

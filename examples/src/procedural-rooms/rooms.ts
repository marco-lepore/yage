import { RegionGraphGenerator } from "@yagejs-addons/procedural";
import type {
  RegionRequirements,
  RoomConnectionArea,
  RoomDefinition,
  RoomTemplate,
} from "@yagejs-addons/procedural";
const connections: readonly RoomConnectionArea[] = [
  { id: "north", side: "north", offset: { min: 2, max: 6 } },
  { id: "south", side: "south", offset: { min: 2, max: 6 } },
  { id: "east", side: "east", offset: { min: 2, max: 4 } },
  { id: "west", side: "west", offset: { min: 2, max: 4 } },
];
const navigation = [
  "#########",
  "#.......#",
  "#.......#",
  "#.......#",
  "#.......#",
  "#.......#",
  "#########",
];
export const TEMPLATES: readonly RoomTemplate[] = [
  {
    id: "entry",
    kinds: ["entrance"],
    size: { width: 9, height: 7 },
    navigation,
    connections,
  },
  {
    id: "hall",
    kinds: ["encounter"],
    variants: [
      { id: "stone", weight: 3, metadata: { color: 0x314a67, theme: "stone" } },
      {
        id: "moss",
        weight: 1,
        tags: ["moss"],
        metadata: { color: 0x355e4b, theme: "moss" },
      },
    ],
    size: { width: 9, height: 7 },
    navigation,
    connections,
  },
  {
    id: "shop",
    kinds: ["shop"],
    metadata: { merchant: "traveller" },
    variants: [
      { id: "weapons", weight: 4, metadata: { stock: "weapons" } },
      {
        id: "healing",
        weight: 1,
        tags: ["healing"],
        metadata: { stock: "potions" },
      },
    ],
    size: { width: 9, height: 7 },
    navigation,
    connections,
  },
  {
    id: "forge",
    kinds: ["forge"],
    size: { width: 9, height: 7 },
    navigation,
    connections,
  },
  {
    id: "treasure",
    kinds: ["treasure"],
    size: { width: 9, height: 7 },
    navigation,
    connections,
  },
  {
    id: "boss",
    kinds: ["boss"],
    size: { width: 9, height: 7 },
    navigation,
    connections,
  },
];
export const REQUIREMENTS: RegionRequirements = {
  start: { id: "start", kind: "entrance" },
  required: [
    { id: "treasure-a", kind: "treasure", grants: ["key-a"] },
    { id: "treasure-b", kind: "treasure", grants: ["key-b"] },
    { id: "boss", kind: "boss", requires: ["key-a", "key-b"] },
  ],
  counts: [
    { kind: "shop", min: 1 },
    { kind: "forge", min: 1 },
    { kind: "treasure", min: 2 },
    { kind: "boss", min: 1 },
  ],
  minRegions: 15,
  fillKind: "encounter",
  forbiddenConnections: [["shop", "forge"]],
  maxConnections: 3,
};
export function createRooms(seed: number): RoomDefinition {
  const job = new RegionGraphGenerator(REQUIREMENTS, { seed });
  const graph = job.generate();
  if (!graph) throw new Error(`Room graph generation failed: ${job.status}`);
  return {
    id: "room-lab",
    revision: "4",
    templates: TEMPLATES,
    graph,
    rules: {
      counts: [
        { match: { tags: ["healing"] }, min: 1 },
        { match: { tags: ["moss"] }, min: 2, max: 5 },
      ],
    },
  };
}

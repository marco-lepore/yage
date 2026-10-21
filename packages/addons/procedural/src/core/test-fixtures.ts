import type {
  RegionRequirements,
  RoomDefinition,
  RoomTemplate,
} from "./types.js";
export const crossRoom: RoomTemplate = {
  id: "cross",
  kinds: ["start", "hall", "goal", "shop"],
  size: { width: 5, height: 5 },
  navigation: ["#####", "#...#", "#...#", "#...#", "#####"],
  connections: [
    { id: "n", side: "north", offset: 2 },
    { id: "e", side: "east", offset: 2 },
    { id: "s", side: "south", offset: 2 },
    { id: "w", side: "west", offset: 2 },
  ],
};
export function roomDefinition(): RoomDefinition {
  return {
    id: "test",
    revision: "1",
    templates: [crossRoom, { ...crossRoom, id: "other" }],
    graph: {
      start: "start",
      regions: [
        { id: "start", kind: "start" },
        { id: "hall", kind: "hall" },
        { id: "goal", kind: "goal" },
        { id: "shop", kind: "shop" },
      ],
      connections: [
        { id: "a", from: "start", to: "hall" },
        { id: "b", from: "hall", to: "goal" },
        { id: "c", from: "hall", to: "shop" },
      ],
    },
  };
}
export const dungeonRequirements: RegionRequirements = {
  start: { id: "start", kind: "start" },
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
  fillKind: "hall",
  forbiddenConnections: [["shop", "forge"]],
  maxConnections: 3,
};

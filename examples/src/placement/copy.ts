import type { FurnitureType, RoomView } from "./content.js";

/**
 * Writing brief: a hands-on placement example with no characters or dialogue.
 * The pictures establish the viewing direction; text names the next action and
 * valid support. Labels use at most three words, hints one short sentence.
 * Errors explain how to repair a placement. Advanced controls stay below the game.
 */
export const placementHints: Readonly<Record<FurnitureType, string>> = {
  table: "Place the table on the floor.",
  chair: "Place the chair on the floor.",
  lamp: "Place the lamp on a table.",
  plant: "Place the plant on the floor or a table.",
  floor: "Place a floor section beside another section.",
  wall: "Place the wall panel on a floor section.",
  art: "Place the picture on a wall panel.",
};
export const supportLabels: Readonly<Record<FurnitureType, string>> = {
  table: "Floor",
  chair: "Floor",
  lamp: "Tabletop",
  plant: "Floor / table",
  floor: "Ground",
  wall: "Floor section",
  art: "Wall panel",
};
export const roomTitles: Record<RoomView, string> = {
  topdown: "ROOM PLANNER",
  side: "SIDE-VIEW WORKSHOP",
  isometric: "ISOMETRIC ROOM",
};
export const roomInstructions: Record<RoomView, string> = {
  topdown: "Choose a table or chair, then click an empty part of the floor.",
  side: "Choose a floor section and extend the platform to the right.",
  isometric: "Choose a chair, then place it on the diamond-shaped floor.",
};

import { CollisionLayers } from "@yagejs/physics";

export const WIDTH = 960;
export const HEIGHT = 600;
export const SPAWN = { x: 70, y: 530 };
const layers = new CollisionLayers();
export const PLAYER = layers.define("player");
export const SOLID = layers.define("solid");
export const ONE_WAY = layers.define("one-way");
export const GROUND_GROUPS = CollisionLayers.interactionGroups(
  PLAYER,
  SOLID | ONE_WAY,
);
export const SOLID_GROUPS = CollisionLayers.interactionGroups(PLAYER, SOLID);
export const COLORS = {
  solid: 0x33445f,
  edge: 0x718aaa,
  player: 0x5eead4,
  oneWay: 0xfbbf24,
  moving: 0xc4b5fd,
};

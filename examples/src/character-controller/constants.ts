import { CollisionLayers } from "@yagejs/physics";

export const WIDTH = 960;
export const HEIGHT = 600;
export const WORLD_WIDTH = 4400;
export const STATIONS = [
  { name: "JUMPS + ONE-WAY", x: 70 },
  { name: "SLIDE", x: 650 },
  { name: "STEPS", x: 1250 },
  { name: "ALTERNATING SLOPES", x: 1850 },
  { name: "MOVING SUPPORT", x: 2920 },
  { name: "LEDGE HELPER", x: 3470 },
  { name: "WALL JUMP", x: 4070 },
] as const;
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

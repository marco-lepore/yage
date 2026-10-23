import type { PlatformerConfig } from "@yagejs-addons/character-controller";

export const WIDTH = 960;
export const HEIGHT = 600;
export const WORLD_WIDTH = 4400;
/** Top of the ground every zone stands on. */
export const FLOOR_Y = 540;

/** Screen-space render layer for the in-canvas HUD. */
export const HUD_LAYER = "hud";

/** The zones the playground can respawn the player at, left to right. */
export const STATIONS = [
  { name: "JUMPS + ONE-WAY", x: 70 },
  { name: "SLIDE", x: 650 },
  { name: "STEPS", x: 1250 },
  { name: "ALTERNATING SLOPES", x: 1850 },
  { name: "MOVING PLATFORM", x: 2920 },
  { name: "LEDGE CLIMB", x: 3470 },
  { name: "WALL JUMP", x: 4070 },
] as const;

/** Movement presets. A preset lists only the numbers it changes from the shipped defaults. */
export const PRESETS = {
  default: { label: "DEFAULT", tuning: {} },
  nimble: {
    label: "NIMBLE",
    tuning: { runSpeed: 260, jumpSpeed: 480, airJumps: 2, dashCooldown: 0.3 },
  },
} as const satisfies Record<
  string,
  { label: string; tuning: Partial<PlatformerConfig> }
>;
export type PresetName = keyof typeof PRESETS;

export const COLORS = {
  solid: 0x33445f,
  edge: 0x718aaa,
  player: 0x5eead4,
  dash: 0xfbbf24,
  oneWay: 0xfbbf24,
  moving: 0xc4b5fd,
  sign: 0x94a3b8,
};

export const WIDTH = 960;
export const HEIGHT = 650;
/** Panel backgrounds and buttons draw under the chest and the texts. */
export const PANEL_LAYER = "loot-panels";
export const HUD_LAYER = "loot-hud";

/** Canvas buttons. Drawing and pointer hit-testing share this geometry. */
export const BUTTON_Y = 580;
export const BUTTON_HEIGHT = 44;
export const BUTTONS = [
  { action: "open", x: 28, width: 270, label: "OPEN CHEST  [Space]" },
  { action: "bank", x: 320, width: 290, label: "BANK + COLLECT  [B]" },
  { action: "level", x: 632, width: 300, label: "CHANGE LEVEL  [L]" },
] as const;
export type ButtonAction = (typeof BUTTONS)[number]["action"];

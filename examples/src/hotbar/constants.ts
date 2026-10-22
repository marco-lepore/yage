import { defineEvent } from "@yagejs/core";
import type { GraphicsContext } from "@yagejs/renderer";
import { defineItems } from "@yagejs-addons/inventory";

export const WIDTH = 800;
export const HEIGHT = 500;

export const WORLD_LAYER = "world";
export const HUD_LAYER = "hud";

export const PLAYER_KEY = "player";
export const TARGET_KEY = "target";

export const FLOOR_Y = 300;
export const PLAYER_START_X = 160;
export const PLAYER_MIN_X = 60;
export const PLAYER_MAX_X = 480;
export const TARGET_X = 640;
/** Pixels per second. */
export const WALK_SPEED = 220;

export const MAX_HEALTH = 100;
export const START_HEALTH = 60;
export const POTION_HEAL = 20;
export const MAX_POTIONS = 9;
export const RESTOCK_POTIONS = 3;

/** The dummy hits back on this period, so potions have a use. */
export const STRIKE_PERIOD = 4;
export const STRIKE_DAMAGE = 12;

/** Seconds of holding that give the beam its full damage. */
export const BEAM_FULL_CHARGE = 1.2;

/** The dummy hit the player for this much damage. */
export const DummyStrike = defineEvent<number>("hotbar-demo:dummy-strike");

/** One line of feedback for the status panel, emitted on any entity. */
export const Notice = defineEvent<string>("hotbar-demo:notice");

/** Every action the bar can hold. The hotbar checks slot assignments against this union. */
export type BarAction = "zap" | "beam" | "potion" | "restock";

export const ICON_POTION = "hotbar-demo/potion";
export const ICON_SIZE = 24;

/** The bag's catalog. A hotbar item binding takes its label and icon from here. */
export const ITEMS = defineItems({
  potion: { name: "Potion", icon: ICON_POTION, maxStack: MAX_POTIONS },
});

/** Drawn once at boot and registered under {@link ICON_POTION}. */
export function drawPotionIcon(g: GraphicsContext): void {
  const s = ICON_SIZE;
  g.circle(s / 2, s * 0.62, s * 0.3).fill({ color: 0xff5566 });
  g.rect(s * 0.42, s * 0.12, s * 0.16, s * 0.24).fill({ color: 0xd8dae8 });
}

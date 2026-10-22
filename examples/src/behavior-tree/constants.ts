import { defineEvent } from "@yagejs/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 800;
export const HEIGHT = 540;

/** Vertical centre of each guard's lane. */
export const LANE_Y = [180, 390] as const;
/** Where a guard rests and heals. */
export const HOME_X = 100;
/** Where a guard stands to strike its gate. */
export const STRIKE_X = 660;
/** Centre of the gate each guard attacks. */
export const GATE_X = 694;

/** Screen-space render layer for the guard panels. */
export const HUD_LAYER = "hud";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** A guard landed a strike. Emitted on the guard entity. */
export const GuardStruck = defineEvent<{ heavy: boolean }>("guard:struck");

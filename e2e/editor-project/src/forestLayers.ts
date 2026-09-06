import { ySort, type LayerDef } from "@yagejs/renderer";

/**
 * The layers this project's levels are authored against.
 *
 * One array, exported once: the scene spreads it into its own `layers`, and
 * the editor config names this module so the editor's preview, the play page
 * and the game all draw the level the same way.
 */
const FOREST_LAYERS: readonly LayerDef[] = [
  { name: "bg", order: -10 },
  { name: "props", order: 10 },
  // A layer that keys its own order every frame, so the editor's ordering
  // controls have a case where they are switched off.
  { name: "canopy", order: 20, sort: ySort },
  // Screen space, which a level must never be offered: a camera skips it, so
  // a world transform there would be drawn at raw screen pixels.
  { name: "hud", order: 100, space: "screen" },
];

export default FOREST_LAYERS;

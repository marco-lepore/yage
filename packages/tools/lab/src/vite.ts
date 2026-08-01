/**
 * The Vite plugin behind `yage-lab dev` and `yage-lab build`.
 *
 * A project only needs it directly to run the lab from a config of its own —
 * the plugin answers the dev server's root URL with the lab page, so that
 * config serves the lab rather than the game.
 */
export { yageLab, type YageLabOptions } from "./vite/labPlugin.js";

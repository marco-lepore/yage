/**
 * `@yagejs-addons/dialogue/yarn` — play Yarn Spinner dialogue.
 *
 * `loadYarn` compiles `.yarn` files (and a `.yarnproject` with its
 * localisation tables) into the same validated script every other loader
 * returns, so a game plays Yarn content through its `DialogueController` with
 * no other setup:
 *
 *     import { loadYarn } from "@yagejs-addons/dialogue/yarn";
 *     const yarn = loadYarn(
 *       import.meta.glob("./dialogue/*", { query: "?raw", import: "default", eager: true }),
 *     );
 *     controller.play(yarn, { start: "Shopkeeper" });
 *
 * Kept off the root entry so games that don't use Yarn don't bundle the
 * compiler.
 */

export { loadYarn } from "./core/formats/yarn/load.js";
export type {
  YarnCatalogs,
  YarnOptions,
  YarnScript,
} from "./core/formats/yarn/load.js";
export { DialogueYarnError } from "./core/formats/yarn/parse.js";

// The package's public entry. Both the server and the browser import it, so it
// reaches into neither `./server/` nor `./browser/`.

/** Project modules the editor loads. Paths are relative to the config file. */
export interface EditorModules {
  /** The module default-exporting the `LevelProject` a game also uses. */
  readonly project: string;
  /** The engine and plugin factory, in the shape a lab harness uses. */
  readonly harness: string;
}

/**
 * A level glob together with the render layers the levels it matches are
 * authored against.
 *
 * `layers` is a path to a module default-exporting a `LayerDef[]` — the same
 * array the game's own `Scene` spreads into its `layers`, exported once and
 * imported by both. It is a path rather than the array itself because the CLI
 * reads this config in Node before the server starts, and an imported array
 * would evaluate the renderer and whatever the layers module reaches from
 * there. The browser imports it, so a `sort` in it stays a real function.
 *
 * The path is relative to the config file, like `modules`; the glob is
 * relative to the Vite root, like every other pattern here.
 */
export interface EditorLevelGlob {
  readonly glob: string;
  readonly layers: string;
}

export interface EditorConfig {
  readonly modules: EditorModules;
  /**
   * Globs for level files, relative to the Vite root. A bare string is a glob
   * whose levels declare no layers, which leaves every placement on the
   * `default` layer — what a level could say before layers were authorable.
   */
  readonly levels: readonly (string | EditorLevelGlob)[];
  /**
   * Globs for the project files the asset picker offers, matched against where
   * a file sits on disk relative to the Vite root —
   * `["public/sprites/**\/*.png"]`. They are the whole filter: the editor
   * cannot tell which files a given parameter would accept, so what these
   * patterns match is what the picker lists.
   *
   * The picker offers the path the browser fetches, which is what a level
   * stores. Vite serves the contents of `publicDir` at the server root, so the
   * glob above lists `sprites/hero.png` — one segment shorter than the glob
   * that matched it.
   *
   * Without any globs the picker says nothing matched, and the field is still
   * typed by hand.
   */
  readonly assets?: readonly string[] | undefined;
  /**
   * The page that runs the game, as a root-relative URL. Run saves the level
   * and opens this page with the level's path in a `level` query parameter,
   * so the page reads that file like any other static asset and needs no
   * editor code. Without it the editor has no Run control.
   *
   * It needs a page of its own: the editor answers the server root, the
   * `index.html` under it, and its own play page, so naming any of those is
   * refused.
   */
  readonly gamePage?: string | undefined;
}

/**
 * Declare a project's editor configuration in `editor/config.ts`.
 *
 * It carries paths and patterns, never imported game objects: the CLI reads
 * this file in Node, and a config that imported an entity class would evaluate
 * Pixi and WASM before the server started.
 *
 * ```ts
 * export default defineEditorConfig({
 *   modules: { project: "../src/levelProject.ts", harness: "../lab/harness.ts" },
 *   levels: [
 *     { glob: "src/levels/forest/*.yage-level.json", layers: "../src/forestLayers.ts" },
 *     "src/levels/menu/*.yage-level.json",
 *   ],
 *   assets: ["public/sprites/**\/*.png"],
 *   gamePage: "/game.html",
 * });
 * ```
 */
export function defineEditorConfig(config: EditorConfig): EditorConfig {
  return config;
}

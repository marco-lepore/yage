/** Where the project declares what a level can place. */
export const LEVEL_PROJECT_FILE = "src/levelProject.ts";

/**
 * The line every generated file opens with, so a reader knows it is theirs to
 * edit and where it came from.
 */
export const WRITTEN_BY = "// Written by `yage-editor init`. Edit freely.";

/** The default the config gets when the project holds no level files yet. */
export const DEFAULT_LEVEL_GLOB = "levels/*.yage-level.json";

/** What `init` found in the project, and writes the config from. */
export interface EditorConfigFacts {
  /** Level globs, relative to the Vite root. Never empty. */
  readonly levels: readonly string[];
  /**
   * The layers module every entry names, relative to the config file, when the
   * project has one. Absent leaves every placement on the `default` layer.
   */
  readonly layers?: string | undefined;
  /** Asset globs the picker offers, relative to the Vite root. */
  readonly assets: readonly string[];
}

/**
 * The `editor/config.ts` source for a project.
 *
 * What `init` cannot read off the project is written as a comment naming the
 * option rather than guessed: a `gamePage` pointing at a page that does not
 * exist would fail at startup, and asset globs matching nothing would make the
 * picker look broken.
 */
export function renderEditorConfig(facts: EditorConfigFacts): string {
  return `${WRITTEN_BY}
import { defineEditorConfig } from "@yagejs-tools/editor";

export default defineEditorConfig({
  modules: {
    project: "../${LEVEL_PROJECT_FILE}",
    harness: "./harness.ts",
  },
${renderLevels(facts)}${renderAssets(facts.assets)}  // Add \`gamePage: "/game.html"\` to get a Run control that saves the level
  // and opens your game on the file.
});
`;
}

function renderLevels(facts: EditorConfigFacts): string {
  const entries = facts.levels
    .map((glob) =>
      facts.layers === undefined
        ? `    ${JSON.stringify(glob)},`
        : `    { glob: ${JSON.stringify(glob)}, layers: ${JSON.stringify(facts.layers)} },`,
    )
    .join("\n");
  const note =
    facts.layers === undefined
      ? `  // Pair a glob with the layers its levels are authored against —
  // { glob: "levels/*.yage-level.json", layers: "../src/layers.ts" } — where
  // the module default-exports the same LayerDef[] your scene spreads.
`
      : "";
  return `${note}  levels: [
${entries}
  ],
`;
}

function renderAssets(assets: readonly string[]): string {
  if (assets.length === 0) {
    return `  // Add \`assets: ["sprites/**/*.png"]\` to let the asset picker list your
  // project's files. Without it an asset path is typed by hand.
`;
  }
  return `  assets: [${assets.map((glob) => JSON.stringify(glob)).join(", ")}],\n`;
}

/**
 * The `src/levelProject.ts` source. The entity list is left empty: the editor
 * has no way to tell which of a project's classes are meant to be placeable.
 */
export const LEVEL_PROJECT_SOURCE = `${WRITTEN_BY}
import { defineLevelProject } from "@yagejs/level";

/**
 * Everything a level can place. Import your entity classes and list them here —
 * the editor and the game build the same catalog from this one declaration.
 */
export default defineLevelProject({ entities: [] });
`;

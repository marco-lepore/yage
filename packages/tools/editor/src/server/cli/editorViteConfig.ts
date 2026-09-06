import path from "node:path";
import { mergeConfig, type ConfigEnv, type InlineConfig } from "vite";
import {
  loadEditorConfig,
  type ResolvedEditorConfig,
} from "../config/index.js";
import { yageEditor } from "../vite/index.js";
import { resolveViteRoot } from "./project.js";

export interface EditorViteConfigOptions {
  /** The project directory. Its Vite config and editor config are read here. */
  readonly cwd: string;
  readonly env: ConfigEnv;
  /** An explicit editor config file, overriding the probe. */
  readonly configFile?: string | undefined;
}

export interface EditorViteConfig {
  readonly editor: ResolvedEditorConfig;
  /** The project's Vite config file, or `undefined` when it has none. */
  readonly projectConfigFile: string | undefined;
  readonly config: InlineConfig;
}

/**
 * Build the Vite config the editor runs on: the project's own, plus the editor
 * plugin.
 *
 * The order matters. The project's config decides the Vite root, and every path
 * in the editor config is resolved against that root, so the project config is
 * read first and the editor config second.
 */
export async function createEditorViteConfig(
  options: EditorViteConfigOptions,
): Promise<EditorViteConfig> {
  const {
    file: projectConfigFile,
    config: project,
    root,
  } = await resolveViteRoot(options.cwd, options.env);
  const editor = await loadEditorConfig({
    cwd: options.cwd,
    root,
    configFile: options.configFile,
  });

  const config = mergeConfig(project, {
    // Without this the server re-reads the config file that was just merged.
    configFile: false,
    root,
    // Its own, because the editor's config hash differs from the game's and a
    // shared directory makes both re-optimise on every switch between them.
    cacheDir: path.join(root, "node_modules/.yage-editor"),
    // The project's own pages are served, so the editor's Run control can open
    // one. No SPA fallback: the editor's middleware answers `/` with the
    // generated editor page, and every other path is the project's.
    appType: "mpa",
    plugins: [yageEditor({ config: editor })],
  }) as InlineConfig;

  return { editor, projectConfigFile, config };
}

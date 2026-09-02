/** Root-absolute URLs of the project modules the generated entry imports. */
export interface ResolvedEditorModules {
  readonly project: string;
  readonly harness: string;
}

/**
 * One level glob, with the root-absolute URL of the layers module its levels
 * are authored against when the config named one.
 */
export interface ResolvedLevelGlob {
  readonly glob: string;
  readonly layers?: string | undefined;
}

/**
 * The editor config after the CLI has read it: every path resolved against the
 * Vite root and checked to stay inside it.
 */
export interface ResolvedEditorConfig {
  /** The Vite root, and the one root the file service will write inside. */
  readonly root: string;
  /** Absolute path of the config file, for error messages. */
  readonly configFile: string;
  /** The project's package name, or the root directory's name. */
  readonly projectId: string;
  readonly modules: ResolvedEditorModules;
  /** Level globs, relative to the root, in the order the config listed them. */
  readonly levels: readonly ResolvedLevelGlob[];
  /** Asset globs, relative to the root. Empty when the project named none. */
  readonly assets: readonly string[];
  /** Root-relative URL of the game page, when the project named one. */
  readonly gamePage?: string | undefined;
}

import path from "node:path";
import { mergeConfig, type ConfigEnv, type InlineConfig } from "vite";
import { yageLab } from "../vite/labPlugin.js";
import { DEFAULT_SCENARIO_GLOBS } from "../vite/scenarioGlobs.js";
import {
  findViteConfig,
  loadProjectConfig,
  readProjectScenarios,
} from "./project.js";

export interface LabConfigOptions {
  /** The project directory. Its package.json and Vite config are read from here. */
  cwd: string;
  env: ConfigEnv;
  /** Patterns from `--scenarios`, taking precedence over package.json. */
  scenarios?: readonly string[] | undefined;
}

export interface LabConfig {
  /** The Vite root — the project's own when its config declares one. */
  root: string;
  /** The project's Vite config file, or `undefined` when it has none. */
  configFile: string | undefined;
  /** The patterns in effect, for the CLI to report. */
  scenarios: readonly string[];
  config: InlineConfig;
}

/**
 * Builds the Vite config the lab runs on: the project's own, plus the lab
 * plugin.
 *
 * Extending rather than replacing is what makes a scenario behave like the
 * game. A game's config is where `vite-plugin-wasm` (physics), legacy decorator
 * support (`@serializable`) and `keepNames` (save/load) live, and a lab running
 * on a fresh config would break all three in ways that only show up at runtime.
 */
export async function createLabConfig(
  opts: LabConfigOptions,
): Promise<LabConfig> {
  const configFile = findViteConfig(opts.cwd);
  const project = configFile
    ? await loadProjectConfig(configFile, opts.env, opts.cwd)
    : {};

  // Resolved rather than passed through: Vite resolves a relative root against
  // the working directory, and the harness and glob paths below are resolved
  // against this value.
  const root = path.resolve(opts.cwd, project.root ?? ".");
  const scenarios =
    opts.scenarios ?? readProjectScenarios(opts.cwd) ?? DEFAULT_SCENARIO_GLOBS;

  const config = mergeConfig(project, {
    // Without this the server re-reads the config file that was just merged.
    configFile: false,
    root,
    // Its own, because the lab's config hash differs from the game's and a
    // shared directory makes both re-optimise their dependencies on every
    // switch between them.
    cacheDir: path.join(root, "node_modules/.yage-lab"),
    plugins: [yageLab({ scenarios })],
  }) as InlineConfig;

  return { root, configFile, scenarios, config };
}

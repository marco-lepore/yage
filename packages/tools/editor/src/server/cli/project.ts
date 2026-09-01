import { existsSync } from "node:fs";
import path from "node:path";
import { loadConfigFromFile, type ConfigEnv, type UserConfig } from "vite";

/** Config file names Vite itself looks for, in the same order. */
const VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
];

/** The project's Vite config file, or `undefined` when it has none. */
export function findViteConfig(dir: string): string | undefined {
  for (const name of VITE_CONFIG_NAMES) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Load the project's own Vite config.
 *
 * The editor extends it rather than replacing it, so the preview runs the game's
 * transforms: Rapier's WASM plugin, decorator support for `@trait`, and
 * whatever aliases the project resolves through. A project with no config is
 * ordinary. A config that exists and fails to load is not — starting without it
 * would drop exactly those transforms and fail later as a runtime error nobody
 * can trace back to here.
 */
export async function loadProjectViteConfig(
  file: string,
  env: ConfigEnv,
  root: string,
): Promise<UserConfig> {
  let loaded;
  try {
    loaded = await loadConfigFromFile(env, file, root);
  } catch (error) {
    throw new Error(
      `Failed to load ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!loaded) throw new Error(`Failed to load ${file}.`);
  return loaded.config;
}

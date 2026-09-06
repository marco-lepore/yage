import { existsSync, readFileSync } from "node:fs";
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
function findViteConfig(dir: string): string | undefined {
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
async function loadProjectViteConfig(
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

/** The project's own Vite config, and the directory it serves from. */
export interface ProjectViteConfig {
  /** The config file, or `undefined` when the project has none. */
  readonly file: string | undefined;
  /** Its config, empty when there is no file. */
  readonly config: UserConfig;
  /** The directory it serves from, as an absolute path. */
  readonly root: string;
}

/**
 * Read the project's Vite config and resolve the root it serves from.
 *
 * Every path in an editor config is resolved against this root, and Vite
 * resolves a relative `root` against the working directory, so the value is
 * resolved here rather than passed through.
 */
export async function resolveViteRoot(
  cwd: string,
  env: ConfigEnv,
): Promise<ProjectViteConfig> {
  const file = findViteConfig(cwd);
  const config = file ? await loadProjectViteConfig(file, env, cwd) : {};
  return { file, config, root: path.resolve(cwd, config.root ?? ".") };
}

/**
 * Every `@yagejs/*` package the project declares, from any dependency field —
 * a game that pulls the engine in as a peer or a dev dependency still runs
 * against it. `undefined` when the directory holds no package.json.
 */
export function readEngineDependencies(
  dir: string,
): ReadonlySet<string> | undefined {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const fields = manifest as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const names = [
    ...Object.keys(fields.dependencies ?? {}),
    ...Object.keys(fields.devDependencies ?? {}),
    ...Object.keys(fields.peerDependencies ?? {}),
  ];
  return new Set(names.filter((name) => name.startsWith("@yagejs/")));
}

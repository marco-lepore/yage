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

/** Returns the project's Vite config file, or `undefined` when it has none. */
export function findViteConfig(dir: string): string | undefined {
  for (const name of VITE_CONFIG_NAMES) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Loads the project's own Vite config.
 *
 * A project with no config is legitimate — Vite's defaults are enough for a
 * game that needs no wasm or decorator setup. A config that exists but fails to
 * load is not: continuing without it drops exactly the transforms scenarios
 * depend on, and the failure would resurface later as a confusing runtime
 * error.
 */
export async function loadProjectConfig(
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

interface ProjectManifest {
  "yage-lab"?: { scenarios?: unknown };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Reads the project's package.json, or `undefined` when it has none. */
function readManifest(file: string): ProjectManifest | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProjectManifest;
  } catch (error) {
    throw new Error(
      `Failed to read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Every `@yagejs/*` package the project declares, from any dependency field —
 * a game that pulls the engine in as a peer or a dev dependency still runs
 * against it. `undefined` when the project has no package.json.
 */
export function readEngineDependencies(
  dir: string,
): ReadonlySet<string> | undefined {
  const file = path.join(dir, "package.json");
  const manifest = readManifest(file);
  if (!manifest) return undefined;
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ];
  return new Set(names.filter((name) => name.startsWith("@yagejs/")));
}

/**
 * Reads `"yage-lab": { "scenarios": [...] }` from the project's package.json.
 * A malformed entry is an error rather than a silent fallback, because the
 * fallback would quietly browse a different set of files than the project asked
 * for.
 */
export function readProjectScenarios(
  dir: string,
): readonly string[] | undefined {
  const file = path.join(dir, "package.json");
  const manifest = readManifest(file);
  if (!manifest) return undefined;
  const declared = manifest["yage-lab"]?.scenarios;
  if (declared === undefined) return undefined;
  if (
    !Array.isArray(declared) ||
    declared.length === 0 ||
    declared.some((pattern) => typeof pattern !== "string")
  ) {
    throw new Error(
      `"yage-lab".scenarios in ${file} must be a non-empty array of glob patterns.`,
    );
  }
  return declared as readonly string[];
}

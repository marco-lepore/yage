import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runnerImport } from "vite";
import type { EditorConfig } from "../../index.js";
import { OWN_PAGE_PATHS, shadowsOwnPage } from "../vite/pages.js";
import type { ResolvedEditorConfig, ResolvedEditorModules } from "./types.js";

/** Config file names, probed in this order. */
export const CONFIG_CANDIDATES = [
  "editor/config.ts",
  "editor/config.mts",
  "editor/config.js",
  "editor/config.mjs",
] as const;

export interface LoadEditorConfigOptions {
  /** The project directory. */
  readonly cwd: string;
  /** The Vite root, which the project's own Vite config may move. */
  readonly root: string;
  /** An explicit config file, overriding the probe. */
  readonly configFile?: string | undefined;
}

/**
 * Read `editor/config.ts` in Node and resolve everything in it.
 *
 * The file carries paths and globs, never imported game objects, so reading it
 * evaluates no entity class, no Pixi, and no WASM. That is what lets the server
 * start without the engine, and it is why this loader runs the file without the
 * project's own Vite plugins: nothing in a config of paths needs them.
 *
 * Every failure throws. The CLI has nowhere to degrade to — a server started on
 * a config it could not read would serve the wrong project.
 */
export async function loadEditorConfig(
  options: LoadEditorConfigOptions,
): Promise<ResolvedEditorConfig> {
  const configFile = findConfigFile(options.cwd, options.configFile);
  const root = path.resolve(options.root);

  const imported = await runnerImport<{ default?: unknown }>(configFile, {
    configFile: false,
    root,
  }).catch((error: unknown) => {
    throw new Error(`Failed to load ${configFile}: ${describe(error)}`, {
      cause: error,
    });
  });

  const config = asEditorConfig(imported.module.default, configFile);
  const configDir = path.dirname(configFile);

  return {
    root,
    configFile,
    projectId: readProjectId(options.cwd, root),
    modules: resolveModules(config.modules, configDir, root, configFile),
    levels: config.levels.map((glob) =>
      checkPattern(glob, "levels", configFile),
    ),
    assets: config.assets.map((glob) =>
      checkPattern(glob, "assets", configFile),
    ),
    ...(config.gamePage === undefined ? {} : { gamePage: config.gamePage }),
  };
}

function findConfigFile(cwd: string, declared: string | undefined): string {
  if (declared !== undefined) {
    const file = path.resolve(cwd, declared);
    if (!existsSync(file)) throw new Error(`No editor config at ${file}.`);
    return file;
  }
  for (const candidate of CONFIG_CANDIDATES) {
    const file = path.join(cwd, candidate);
    if (existsSync(file)) return file;
  }
  throw new Error(
    `No editor config found. Expected one of ` +
      `${CONFIG_CANDIDATES.join(", ")} in ${cwd}.`,
  );
}

/**
 * A validated config with the optional pattern list settled, so everything
 * after this reads one shape. A project that named no assets gets an empty
 * list rather than an absent field.
 */
type CheckedEditorConfig = Omit<EditorConfig, "assets"> & {
  readonly assets: readonly string[];
};

function asEditorConfig(
  value: unknown,
  configFile: string,
): CheckedEditorConfig {
  if (!isObject(value)) {
    throw new Error(`${configFile} must default-export an editor config.`);
  }
  const modules: unknown = value["modules"];
  if (!isObject(modules)) {
    throw new Error(`${configFile}: "modules" must be an object.`);
  }
  const project = asModulePath(modules["project"], "project", configFile);
  const harness = asModulePath(modules["harness"], "harness", configFile);
  const gamePage = asGamePage(value["gamePage"], configFile);

  return {
    modules: { project, harness },
    levels: asPatternList(value["levels"], "levels", configFile),
    assets:
      value["assets"] === undefined
        ? []
        : asPatternList(value["assets"], "assets", configFile),
    ...(gamePage === undefined ? {} : { gamePage }),
  };
}

/** Stands in for the editor's own origin while a game page URL is checked. */
const PLACEHOLDER_ORIGIN = "http://editor.invalid";

/**
 * The game page is a URL the editor opens, not a file it reads, so it is
 * checked for shape rather than for existence.
 *
 * Two things make a value unusable, and both fail silently at run time:
 *
 * It must address this server, because the page is opened with the editor's
 * token and asks for a draft revision. Resolving it catches the forms that
 * pass a `startsWith("/")` test and still name another host —
 * `//example.com/game` and `/\example.com/game` both do.
 *
 * It must not be a path the editor answers itself. The editor serves its own
 * page at the project's root and at the `index.html` there, ahead of every
 * Vite middleware, so a project page at either is shadowed: Run would open a
 * second editor and nothing would say why. The comparison is base-less on both
 * sides — a `gamePage` names a page the way the project's own source does, and
 * the editor resolves it under whatever base the project configured.
 */
function asGamePage(value: unknown, configFile: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new Error(
      `${configFile}: "gamePage" must be a root-relative URL such as "/game.html".`,
    );
  }
  const resolved = new URL(value, PLACEHOLDER_ORIGIN);
  if (resolved.origin !== PLACEHOLDER_ORIGIN) {
    throw new Error(
      `${configFile}: "gamePage" must be a page this server serves, and ` +
        `"${value}" names another origin.`,
    );
  }
  if (shadowsOwnPage(resolved.pathname)) {
    throw new Error(
      `${configFile}: "gamePage" is "${value}", which is where the editor ` +
        `serves one of its own pages (${OWN_PAGE_PATHS.join(", ")}). Give ` +
        `the game its own page, such as "/game.html".`,
    );
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function asModulePath(value: unknown, key: string, configFile: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${configFile}: "modules.${key}" must be a path.`);
  }
  return value;
}

function asPatternList(
  value: unknown,
  field: string,
  configFile: string,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry === "")
  ) {
    throw new Error(
      `${configFile}: "${field}" must be a non-empty array of patterns.`,
    );
  }
  return value as readonly string[];
}

/**
 * A pattern that reaches outside the root would widen what the server may
 * write, so configuration cannot express one.
 */
function checkPattern(
  pattern: string,
  field: string,
  configFile: string,
): string {
  const normalized = pattern.replace(/^\.\//, "");
  const escapes =
    path.isAbsolute(normalized) ||
    normalized.includes("\\") ||
    normalized.split("/").includes("..");
  if (escapes) {
    throw new Error(
      `${configFile}: "${field}" pattern "${pattern}" reaches outside the ` +
        `project root.`,
    );
  }
  return normalized;
}

function resolveModules(
  modules: EditorConfig["modules"],
  configDir: string,
  root: string,
  configFile: string,
): ResolvedEditorModules {
  return {
    project: toRootUrl(modules.project, configDir, root, configFile),
    harness: toRootUrl(modules.harness, configDir, root, configFile),
  };
}

/**
 * A module path becomes the URL the generated entry imports. Vite serves a
 * module by its path under the root, so a module outside the root has no URL
 * the browser could ask for.
 */
function toRootUrl(
  modulePath: string,
  configDir: string,
  root: string,
  configFile: string,
): string {
  const absolute = path.resolve(configDir, modulePath);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(
      `${configFile}: module "${modulePath}" resolves to ${absolute}, ` +
        `outside the Vite root ${root}.`,
    );
  }
  if (!existsSync(absolute)) {
    throw new Error(`${configFile}: no module at ${absolute}.`);
  }
  return `/${relative}`;
}

function readProjectId(cwd: string, root: string): string {
  const manifest = path.join(cwd, "package.json");
  if (existsSync(manifest)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (isObject(parsed) && typeof parsed["name"] === "string") {
        return parsed["name"];
      }
    } catch {
      // A project without a readable manifest still has a directory name.
    }
  }
  return path.basename(root);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

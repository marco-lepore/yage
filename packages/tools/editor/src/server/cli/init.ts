import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CONFIG_CANDIDATES } from "../config/load.js";
import {
  DEFAULT_LEVEL_GLOB,
  LEVEL_PROJECT_FILE,
  LEVEL_PROJECT_SOURCE,
  renderEditorConfig,
} from "./configTemplate.js";
import {
  HARNESS_FILE,
  planHarness,
  renderHarnessReexport,
  type HarnessPlan,
} from "./harnessTemplate.js";
import { readEditorScript, withEditorScript } from "./manifestScript.js";
import { readEngineDependencies, resolveViteRoot } from "./project.js";

/** The config file `init` writes, and the first path the CLI probes for one. */
const CONFIG_FILE = CONFIG_CANDIDATES[0];

/**
 * Harness files the scenario lab writes, in the order its own lookup probes
 * them. Copied rather than imported: the two tools set the same project up and
 * neither depends on the other.
 */
const LAB_HARNESS_CANDIDATES = [
  "lab/harness.ts",
  "lab/harness.mts",
  "lab/harness.js",
  "lab/harness.mjs",
] as const;

/** The packages a project needs before the editor can draw anything. */
const REQUIRED = ["@yagejs/core", "@yagejs/renderer"] as const;

/** What `src/levelProject.ts` imports from. */
const LEVEL_PACKAGE = "@yagejs/level";

/** Directories the level search does not descend into. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist"]);

const LEVEL_SUFFIX = ".yage-level.json";

/** The layers module a level entry names, when the project has one. */
const LAYERS_FILE = "src/layers.ts";

/** Where Vite serves static files from, by default. */
const PUBLIC_DIRECTORY = "public";

export interface InitOptions {
  cwd: string;
  /** Rewrite the files that already exist instead of keeping them. */
  force: boolean;
}

/** What happened to one file. */
type Outcome = "wrote" | "kept";

interface FileResult {
  /** Path relative to the directory the command ran in. */
  readonly file: string;
  readonly outcome: Outcome;
}

/**
 * Set a project up for the editor: `editor/config.ts`, `editor/harness.ts`,
 * `src/levelProject.ts`, and an `editor` script.
 *
 * What the project already has decides everything that can be read off it —
 * its `@yagejs/*` dependencies decide the harness plugins, the directories
 * already holding level files decide the globs, and an existing scenario-lab
 * harness is re-exported rather than copied. Nothing else is guessed: a
 * `gamePage` naming a page that does not exist would fail at startup, so the
 * config carries a comment instead.
 *
 * A file that is already there is kept and named in the report, so running
 * this in a project set up by hand fills in what is missing and touches
 * nothing else.
 */
export async function runInit(options: InitOptions): Promise<void> {
  const dependencies = readEngineDependencies(options.cwd);
  if (dependencies === undefined) {
    throw new Error(
      `No package.json in ${options.cwd}. Run this from the project root.`,
    );
  }
  for (const required of REQUIRED) {
    if (!dependencies.has(required)) {
      throw new Error(
        `${required} is not a dependency of this project. The editor builds ` +
          `every placement in a real engine and renders it into a canvas, so ` +
          `it needs the packages the game itself runs on.`,
      );
    }
  }

  // package.json sits where the command runs. Every module the config names
  // has to sit inside the Vite root, which the project's own config may move,
  // so the written files follow the root and the script names the config when
  // the two differ.
  const { root } = await resolveViteRoot(options.cwd, {
    command: "serve",
    mode: "development",
  });

  // First, because it is the one step that can refuse: a manifest this cannot
  // edit leaves the project as it was rather than half set up.
  const command = editorCommand(options.cwd, root);
  const script = addScript(options.cwd, command, options.force);

  const levels = findLevelGlobs(root);
  const layers = existsSync(path.join(root, LAYERS_FILE))
    ? `../${LAYERS_FILE}`
    : undefined;
  const assets = existsSync(path.join(root, PUBLIC_DIRECTORY))
    ? [`${PUBLIC_DIRECTORY}/**/*.png`]
    : [];

  const labHarness = LAB_HARNESS_CANDIDATES.map((candidate) =>
    path.join(root, candidate),
  ).find((file) => existsSync(file));
  const plan = planHarness(dependencies);

  const config = path.join(root, CONFIG_FILE);
  const harness = path.join(root, HARNESS_FILE);
  const levelProject = path.join(root, LEVEL_PROJECT_FILE);
  const configOutcome = write(
    config,
    renderEditorConfig({ levels, layers, assets }),
    options.force,
    CONFIG_CANDIDATES.map((candidate) => path.join(root, candidate)),
  );
  const results: FileResult[] = [
    { file: shown(options.cwd, config), outcome: configOutcome },
  ];
  // The config that is already there names the harness the editor loads, which
  // need be neither this path nor this shape.
  const writesHarness = configOutcome === "wrote";
  if (writesHarness) {
    results.push({
      file: shown(options.cwd, harness),
      outcome: write(
        harness,
        labHarness === undefined
          ? plan.source
          : renderHarnessReexport(importSpecifier(harness, labHarness)),
        options.force,
      ),
    });
  }
  results.push({
    file: shown(options.cwd, levelProject),
    outcome: write(levelProject, LEVEL_PROJECT_SOURCE, options.force),
  });

  report({
    results,
    dependencies,
    levels,
    layers,
    harness: writesHarness
      ? {
          labHarness:
            labHarness === undefined
              ? undefined
              : shown(options.cwd, labHarness),
          plan,
        }
      : undefined,
    configFile: shown(options.cwd, config),
    command,
    script,
    force: options.force,
  });
}

/** A path as the report names it: relative to where the command ran. */
function shown(cwd: string, file: string): string {
  return path.relative(cwd, file) || file;
}

/**
 * Write `source` unless a file is already there, in which case it is left
 * alone. `guards` names the other paths that count as already there — the
 * config is probed under four extensions, so writing the `.ts` would shadow a
 * hand-written `.mjs`.
 */
function write(
  file: string,
  source: string,
  force: boolean,
  guards: readonly string[] = [file],
): Outcome {
  if (!force && guards.some((candidate) => existsSync(candidate)))
    return "kept";
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
  return "wrote";
}

/**
 * The specifier `editor/harness.ts` imports the lab's harness by. TypeScript
 * resolves a `.js` specifier to the `.ts` beside it, and `.mjs` to `.mts`, so
 * the extension is mapped rather than dropped.
 */
function importSpecifier(from: string, target: string): string {
  const relative = path
    .relative(path.dirname(from), target)
    .split(path.sep)
    .join("/");
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  return specifier.replace(/\.mts$/, ".mjs").replace(/\.ts$/, ".js");
}

/**
 * Every directory under the Vite root already holding level files, as one glob
 * each in path order. A project with none gets the default, which is where the
 * editor's New control offers to put its first level.
 */
function findLevelGlobs(root: string): readonly string[] {
  const directories = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith(LEVEL_SUFFIX)) {
        directories.add(path.relative(root, dir).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  if (directories.size === 0) return [DEFAULT_LEVEL_GLOB];
  return [...directories]
    .sort()
    .map((dir) =>
      dir === "" ? `*${LEVEL_SUFFIX}` : `${dir}/*${LEVEL_SUFFIX}`,
    );
}

/**
 * The command the script runs. The CLI probes for a config beside the
 * directory it runs in, so a project whose Vite root is elsewhere — where the
 * config had to go — names it.
 */
function editorCommand(cwd: string, root: string): string {
  if (path.resolve(root) === path.resolve(cwd)) return "yage-editor";
  const config = path
    .relative(cwd, path.join(root, CONFIG_FILE))
    .split(path.sep)
    .join("/");
  return `yage-editor --config ${config}`;
}

/** What `addScript` did, for the report. */
type ScriptResult =
  | { readonly outcome: "wrote" }
  | { readonly outcome: "kept"; readonly existing: string };

function addScript(cwd: string, command: string, force: boolean): ScriptResult {
  const file = path.join(cwd, "package.json");
  const source = readFileSync(file, "utf8");
  const existing = readEditorScript(source);
  if (existing === command) return { outcome: "kept", existing };
  if (existing !== undefined && !force) return { outcome: "kept", existing };
  writeFileSync(file, withEditorScript(source, command), "utf8");
  return { outcome: "wrote" };
}

/** What went into the harness, absent when none was written. */
interface HarnessReport {
  /** The scenario lab harness it re-exports, when there is one. */
  readonly labHarness: string | undefined;
  readonly plan: HarnessPlan;
}

interface InitReport {
  readonly results: readonly FileResult[];
  /** The project's `@yagejs/*` packages, for the notes that name one. */
  readonly dependencies: ReadonlySet<string>;
  readonly levels: readonly string[];
  readonly layers: string | undefined;
  readonly harness: HarnessReport | undefined;
  /** The config file, for the line that says it decides the harness. */
  readonly configFile: string;
  readonly command: string;
  readonly script: ScriptResult;
  readonly force: boolean;
}

function report(summary: InitReport): void {
  const lines = [`\n  yage-editor init\n\n`];
  const row = (label: string, text: string): void => {
    lines.push(`  ${label.padEnd(10)} ${text}\n`);
  };

  for (const result of summary.results) row(result.outcome, result.file);
  row(
    summary.script.outcome,
    summary.script.outcome === "wrote"
      ? `package.json — "editor": "${summary.command}"`
      : `package.json — "editor" is already "${summary.script.existing}"`,
  );

  if (summary.harness === undefined) {
    row(
      "harness",
      `not written — ${summary.configFile} names the one it loads`,
    );
  } else {
    if (summary.harness.labHarness !== undefined) {
      row(
        "adopted",
        `${summary.harness.labHarness} — the harness re-exports it`,
      );
    }
    row("plugins", summary.harness.plan.plugins.join(", "));
    // A harness that silently omits a plugin the project installed looks like
    // the tool missing it, so name the package that would bring it in.
    for (const { className, missing } of summary.harness.plan.skipped) {
      row("skipped", `${className} — install ${missing.join(" and ")}`);
    }
  }
  row("levels", summary.levels.join(", "));
  if (summary.layers === undefined) {
    row("layers", "none declared — every placement draws on the default layer");
  }
  // Installing the editor pulls its peers in without declaring them, so a
  // project can be missing the package the generated declaration imports.
  if (!summary.dependencies.has(LEVEL_PACKAGE)) {
    row(
      "note",
      `${LEVEL_PACKAGE} is not a dependency, and ${LEVEL_PROJECT_FILE} ` +
        `imports it. Add it to package.json.`,
    );
  }

  const kept =
    summary.results.some((result) => result.outcome === "kept") ||
    summary.script.outcome === "kept";
  if (kept && !summary.force) {
    lines.push(`\n  Kept files are left as they are. --force rewrites them.\n`);
  }
  lines.push(
    `\n  List your entity classes in ${LEVEL_PROJECT_FILE}, then run ` +
      `npm run editor.\n\n`,
  );
  process.stdout.write(lines.join(""));
}

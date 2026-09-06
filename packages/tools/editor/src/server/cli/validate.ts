import type * as LevelApi from "@yagejs/level";
import type { LevelCatalog } from "@yagejs/level";
import {
  createServer,
  mergeConfig,
  type InlineConfig,
  type ViteDevServer,
} from "vite";
import { assembleProject } from "../../shared/project/index.js";
import type { ResolvedEditorConfig } from "../config/index.js";
import { createLevelFileService } from "../files/index.js";
import type { LevelFileService } from "../files/index.js";
import { createEditorViteConfig } from "./editorViteConfig.js";

export interface ValidateOptions {
  readonly cwd: string;
  /** An explicit editor config file, overriding the probe. */
  readonly configFile?: string | undefined;
}

/** One thing wrong, in the columns the report prints. */
export interface LevelProblem {
  /** The placement it belongs to, or the entity type a catalog problem names. */
  readonly subject: string;
  /**
   * The parameter path, joined with dots. A structural problem carries the
   * JSON path of the value instead, which is the same column.
   */
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface LevelFileReport {
  /** Root-relative path, as the level globs matched it. */
  readonly file: string;
  readonly problems: readonly LevelProblem[];
}

/** Everything one run found, and what it takes to describe it. */
export interface ValidationReport {
  /** The configured globs, for the line that says none matched. */
  readonly levels: readonly string[];
  /** The project module, which is where a catalog problem is. */
  readonly projectModule: string;
  /**
   * Catalog problems. A catalog is all-or-nothing, so any of these means no
   * level was checked.
   */
  readonly catalog: readonly LevelProblem[];
  readonly files: readonly LevelFileReport[];
}

/** The package the catalog and the check come from, loaded through Vite. */
const LEVEL_PACKAGE = "@yagejs/level";

/** A problem with the document itself rather than with what it says. */
const STRUCTURAL = "structural";

/** A problem with the project's entity declarations. */
const CATALOG = "catalog";

/** A file the globs matched that could not be read back. */
const UNREADABLE = "unreadable";

/** What an absent column prints as, so the columns stay readable. */
const ABSENT = "-";

/**
 * Check every level file the project's globs match against the catalog its
 * entity declarations build, and report what is wrong with each one. Returns
 * the exit code: non-zero is what makes the command a gate.
 *
 * The project module is imported through the project's own Vite config, so a
 * declaration written with decorators or resolved through an alias loads the
 * way it does in the editor. Nothing is rendered and no `setup()` runs — the
 * check is what `validateLevel` finds.
 */
export async function runValidate(options: ValidateOptions): Promise<number> {
  const editor = await createEditorViteConfig({
    cwd: options.cwd,
    env: { command: "serve", mode: "development" },
    configFile: options.configFile,
  });

  const server = await createServer(
    mergeConfig(editor.config, {
      // No page is served and no browser connects: the server is here to load
      // one module the way the editor would.
      appType: "custom",
      logLevel: "warn",
      server: { middlewareMode: true },
      // The client dependency optimizer prebundles for a browser, and no
      // browser joins this run. Left on, it writes a cache directory into the
      // project that nothing reads.
      optimizeDeps: { noDiscovery: true, include: [] },
      // Vite transforms the engine packages rather than handing them to Node.
      // `@dimforge/rapier2d`, which `@yagejs/physics` imports, declares only
      // `module` in its manifest, so Node's resolver finds no entry point for
      // it; Vite resolves it through that field. Both this file's
      // `@yagejs/level` and the project module's take the inlined copy, which
      // is what keeps parameter kinds comparable by identity.
      environments: {
        ssr: { resolve: { noExternal: [/^@yagejs\//, "@dimforge/rapier2d"] } },
      },
    } satisfies InlineConfig),
  );

  let report: ValidationReport;
  try {
    report = await collect(server, editor.editor);
  } finally {
    await server.close();
  }

  process.stdout.write(describeValidation(report));
  return failed(report) ? 1 : 0;
}

/** Whether the run found anything. This is the exit code's only input. */
function failed(report: ValidationReport): boolean {
  return (
    report.catalog.length > 0 ||
    report.files.some((file) => file.problems.length > 0)
  );
}

async function collect(
  server: ViteDevServer,
  config: ResolvedEditorConfig,
): Promise<ValidationReport> {
  const levels = config.levels.map((level) => level.glob);
  const projectModule = config.modules.project;
  // Through the same graph as the project module, so the two share one copy of
  // the package. A parameter kind is checked by identity against the `param.*`
  // that made it, and a second copy of `@yagejs/level` would reject every
  // declaration the project wrote.
  const api = (await server.ssrLoadModule(LEVEL_PACKAGE)) as typeof LevelApi;
  // No contribution is loaded: the packages a project gets placeable types
  // from are discovered by the editor's Vite plugin, which serves the editor
  // page. A successful assembly therefore has nothing to report.
  const assembled = assembleProject({
    project: await importProject(server, projectModule),
    contributions: [],
  });
  if (!assembled.ok) {
    return {
      levels,
      projectModule,
      catalog: assembled.diagnostics.map((diagnostic) => ({
        subject: ABSENT,
        path: ABSENT,
        code: diagnostic.code,
        message: diagnostic.message,
      })),
      files: [],
    };
  }

  const built = api.buildLevelCatalog(
    api.defineLevelProject(assembled.project),
  );
  if (!built.ok) {
    return {
      levels,
      projectModule,
      catalog: built.errors.map((error) => ({
        subject: error.entityId ?? ABSENT,
        path: ABSENT,
        code: CATALOG,
        message: error.message,
      })),
      files: [],
    };
  }

  return {
    levels,
    projectModule,
    catalog: [],
    files: await checkFiles(api, config, built.catalog),
  };
}

async function checkFiles(
  api: typeof LevelApi,
  config: ResolvedEditorConfig,
  catalog: LevelCatalog,
): Promise<readonly LevelFileReport[]> {
  const files = await createLevelFileService({
    root: config.root,
    levels: config.levels.map((level) => ({ glob: level.glob })),
    // Nothing here lists assets; a placement's asset path is a parameter like
    // any other, and the catalog decides whether it is one the type accepts.
    assets: [],
  });

  const reports: LevelFileReport[] = [];
  for (const summary of await files.listLevels()) {
    reports.push({
      file: summary.path,
      problems: await checkFile(api, files, summary.path, catalog),
    });
  }
  return reports;
}

async function checkFile(
  api: typeof LevelApi,
  files: LevelFileService,
  path: string,
  catalog: LevelCatalog,
): Promise<readonly LevelProblem[]> {
  const result = await files.readLevel(path);
  if (!result.ok) {
    return [
      {
        subject: ABSENT,
        path: ABSENT,
        code: UNREADABLE,
        message: `The file could not be read (${result.reason}).`,
      },
    ];
  }
  if (!result.structural.ok) {
    return result.structural.errors.map((error) => ({
      subject: ABSENT,
      path: error.path,
      code: STRUCTURAL,
      message: error.message,
    }));
  }
  return api
    .validateLevel(result.structural.document, catalog)
    .map((diagnostic) => ({
      subject: diagnostic.placementId,
      path: diagnostic.path.join(".") || ABSENT,
      code: diagnostic.code,
      message: diagnostic.message,
    }));
}

async function importProject(
  server: ViteDevServer,
  modulePath: string,
): Promise<unknown> {
  try {
    const module = await server.ssrLoadModule(modulePath);
    return module["default"];
  } catch (error) {
    const reason = firstLine(error);
    throw new Error(
      `Failed to import ${modulePath}: ${reason}${browserHint(reason)}`,
      { cause: error },
    );
  }
}

/**
 * What to do about an import that reached for a browser. Nothing in this
 * command runs in one, so the module has to stop needing it at import time.
 */
function browserHint(reason: string): string {
  if (!/\b(?:document|window) is not defined\b/.test(reason)) return "";
  // The reason is a bare clause more often than a sentence, and the hint reads
  // as a second sentence after it.
  const stop = /[.!?]$/.test(reason) ? "" : ".";
  return (
    `${stop} The project module reached code that needs a browser at import` +
    " time. Move that import out of the entity modules, or import it where" +
    " it is used."
  );
}

/**
 * The first line of an error. An import failure carries the whole transform
 * stack, and the line that says what went wrong is the first one.
 */
function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0] ?? text;
}

/** The report as the command prints it. */
export function describeValidation(report: ValidationReport): string {
  const lines = [`\n  yage-editor validate\n\n`];

  if (report.catalog.length > 0) {
    lines.push(...group(report.projectModule, report.catalog));
    lines.push(
      `  ${count(report.catalog.length, "problem")} in ` +
        `${report.projectModule}. No level was checked.\n\n`,
    );
    return lines.join("");
  }

  if (report.files.length === 0) {
    lines.push(`  No level file matched ${report.levels.join(", ")}.\n\n`);
    return lines.join("");
  }

  const problems = report.files.flatMap((file) => file.problems);
  if (problems.length === 0) {
    lines.push(
      `  ${count(report.files.length, "level file")} checked, no problems.\n\n`,
    );
    return lines.join("");
  }

  const widths = columnWidths(problems);
  for (const file of report.files) {
    if (file.problems.length === 0) continue;
    lines.push(...group(file.file, file.problems, widths));
  }
  const bad = report.files.filter((file) => file.problems.length > 0).length;
  lines.push(
    `  ${count(problems.length, "problem")} in ${String(bad)} of ` +
      `${count(report.files.length, "level file")}.\n\n`,
  );
  return lines.join("");
}

/** The width of each column that is padded, over every row printed. */
interface ColumnWidths {
  readonly subject: number;
  readonly path: number;
  readonly code: number;
}

function columnWidths(problems: readonly LevelProblem[]): ColumnWidths {
  const widest = (read: (problem: LevelProblem) => string): number =>
    problems.reduce(
      (width, problem) => Math.max(width, read(problem).length),
      0,
    );
  return {
    subject: widest((problem) => problem.subject),
    path: widest((problem) => problem.path),
    code: widest((problem) => problem.code),
  };
}

/** One heading and the rows under it, each line ending in a newline. */
function group(
  heading: string,
  problems: readonly LevelProblem[],
  widths: ColumnWidths = columnWidths(problems),
): readonly string[] {
  return [
    `  ${heading}\n`,
    ...problems.map(
      (problem) =>
        `    ${problem.subject.padEnd(widths.subject)}  ` +
        `${problem.path.padEnd(widths.path)}  ` +
        `${problem.code.padEnd(widths.code)}  ${problem.message}\n`,
    ),
    `\n`,
  ];
}

function count(amount: number, noun: string): string {
  return `${String(amount)} ${noun}${amount === 1 ? "" : "s"}`;
}

import { isScenario, type AnyScenario } from "../grammar/scenario.js";

export interface ScenarioEntry {
  /** Stable identifier. Names it to `show(id)`, a URL and `--scenarios`. */
  readonly id: string;
  /** The module path the scenario came from. */
  readonly path: string;
  /** The export it came from. `"default"` for a file's unnamed scenario. */
  readonly exportName: string;
  /** Where the list nests it, outermost first. Empty for a top-level entry. */
  readonly groups: readonly string[];
  /** The list entry's own label, under the last group. */
  readonly label: string;
  /** {@link groups} and {@link label} as one line, for the header and sorting. */
  readonly title: string;
  readonly scenario: AnyScenario;
  /**
   * Whether the scenario declares a `drive`. On the entry so that the panel's
   * Run button and a driver listing the scenarios read one definition of it
   * rather than each testing `scenario.drive` for itself.
   */
  readonly hasDrive: boolean;
}

export interface RegistryProblem {
  readonly path: string;
  readonly message: string;
}

export interface ScenarioRegistry {
  readonly scenarios: readonly ScenarioEntry[];
  /** Modules that could not be used, with the reason. */
  readonly problems: readonly RegistryProblem[];
  find(id: string): ScenarioEntry | undefined;
}

export interface RegistryOptions {
  /**
   * The glob root. Stripped from each module path before the id is derived, so
   * `/src/lab` turns `/src/lab/enemies/slime.scenario.ts` into `enemies/slime`.
   */
  root?: string | undefined;
}

const SCENARIO_SUFFIX = /\.scenario\.[cm]?[jt]sx?$/;
const DEFAULT_EXPORT = "default";

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Derives a scenario file's id from its module path.
 *
 * The whole path is kept, not the basename: two files both named
 * `jump.scenario.ts` in different folders must not become the same scenario.
 */
export function scenarioIdFromPath(path: string, root?: string): string {
  let id = normalize(path);
  if (root) {
    const prefix = normalize(root).replace(/\/+$/, "");
    if (prefix && (id === prefix || id.startsWith(`${prefix}/`))) {
      id = id.slice(prefix.length).replace(/^\/+/, "");
    }
  }
  return id.replace(SCENARIO_SUFFIX, "");
}

/**
 * A file's unnamed scenario is the file itself, so it keeps the file's id and
 * sits where the file sits. Named ones nest under it.
 */
function scenarioId(fileId: string, exportName: string): string {
  return exportName === DEFAULT_EXPORT ? fileId : `${fileId}/${exportName}`;
}

/** Splits a `/`-separated path, dropping empty segments and trimming the rest. */
function splitPath(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

/**
 * Where the list puts a scenario: its file's location by default, or the path
 * an explicit `title` names instead. The last segment is the entry's label
 * unless the scenario names itself.
 */
function placement(
  id: string,
  scenario: AnyScenario,
): { groups: string[]; label: string } {
  const segments = splitPath(scenario.title ?? id);
  // `defineScenario` rejects a title with no segment, and an id always has
  // one, so the path is never empty here.
  const last = segments.pop() as string;
  return { groups: segments, label: scenario.name ?? last };
}

interface ScenarioExport {
  readonly exportName: string;
  readonly value: unknown;
}

/**
 * The exports a module offers as scenarios, default first.
 *
 * A module namespace lists its keys in code-unit order, so a file's scenarios
 * cannot be shown in declaration order — the list sorts them by title instead.
 */
function scenarioExports(mod: unknown): ScenarioExport[] {
  if (typeof mod !== "object" || mod === null) return [];
  const record = mod as Record<string, unknown>;
  return Object.keys(record)
    .sort((a, b) =>
      a === DEFAULT_EXPORT ? -1 : b === DEFAULT_EXPORT ? 1 : a.localeCompare(b),
    )
    .filter((name) => isScenario(record[name]))
    .map((name) => ({ exportName: name, value: record[name] }));
}

/**
 * Turns the module map produced by `import.meta.glob` into a sorted, unique
 * list of scenarios. A module that is not a usable scenario becomes a problem
 * rather than an exception, so one bad file does not take the tool down with
 * it.
 */
export function buildRegistry(
  modules: Record<string, unknown>,
  opts: RegistryOptions = {},
): ScenarioRegistry {
  const scenarios: ScenarioEntry[] = [];
  const problems: RegistryProblem[] = [];
  const byId = new Map<string, ScenarioEntry>();

  for (const path of Object.keys(modules).sort()) {
    const exports = scenarioExports(modules[path]);
    if (exports.length === 0) {
      problems.push({
        path,
        message:
          "no scenarios — a scenario file must export what `defineScenario({...})` returns.",
      });
      continue;
    }
    // A default scenario is the file, and a named one nests under it. A file
    // doing both would show its own name as a leaf and as a group beside it.
    if (exports.length > 1 && exports[0]?.exportName === DEFAULT_EXPORT) {
      problems.push({
        path,
        message:
          "exports a default scenario and named ones — use one or the other.",
      });
      continue;
    }

    const fileId = scenarioIdFromPath(path, opts.root);
    for (const { exportName, value } of exports) {
      // `defineScenario` validated it before marking it, so a marked export is
      // a usable scenario and only its id can still be wrong.
      const scenario = value as AnyScenario;
      const id = scenarioId(fileId, exportName);
      const clash = byId.get(id);
      if (clash) {
        // Which export produced the id, since a file's named exports and a
        // file one directory down can both land on it.
        const source =
          exportName === DEFAULT_EXPORT ? "" : ` (export \`${exportName}\`)`;
        problems.push({
          path,
          message: `id "${id}"${source} is already used by ${clash.path}.`,
        });
        continue;
      }
      const { groups, label } = placement(id, scenario);
      const entry: ScenarioEntry = {
        id,
        path,
        exportName,
        groups,
        label,
        title: [...groups, label].join(" / "),
        scenario,
        hasDrive: typeof scenario.drive === "function",
      };
      byId.set(id, entry);
      scenarios.push(entry);
    }
  }

  scenarios.sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );

  return {
    scenarios,
    problems,
    find: (id) => byId.get(id),
  };
}

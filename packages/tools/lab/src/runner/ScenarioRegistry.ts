import {
  describeScenarioProblem,
  type AnyScenario,
} from "../grammar/scenario.js";

export interface ScenarioEntry {
  /** Stable identifier, derived from the module path. Names it to `show(id)`. */
  readonly id: string;
  /** The module path the scenario came from. */
  readonly path: string;
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

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * Derives a scenario id from its module path.
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

interface ScenarioModule {
  default?: unknown;
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
    const mod = modules[path] as ScenarioModule | undefined;
    const def = mod?.default;
    if (def === undefined) {
      problems.push({
        path,
        message:
          "no default export — a scenario file must `export default defineScenario({...})`.",
      });
      continue;
    }
    const problem = describeScenarioProblem(def);
    if (problem) {
      problems.push({ path, message: problem });
      continue;
    }
    const scenario = def as AnyScenario;
    const id = scenarioIdFromPath(path, opts.root);
    const clash = byId.get(id);
    if (clash) {
      problems.push({
        path,
        message: `id "${id}" is already used by ${clash.path}.`,
      });
      continue;
    }
    const entry: ScenarioEntry = {
      id,
      path,
      title: scenario.title,
      scenario,
      hasDrive: typeof scenario.drive === "function",
    };
    byId.set(id, entry);
    scenarios.push(entry);
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

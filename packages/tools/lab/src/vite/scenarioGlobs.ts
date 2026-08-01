/**
 * Scenario discovery patterns, and the directory scenario ids are derived
 * against.
 */

/** Used when neither the CLI nor the project names its own patterns. */
export const DEFAULT_SCENARIO_GLOBS: readonly string[] = ["**/*.scenario.ts"];

/**
 * `import.meta.glob` skips `node_modules` on its own but not build output, and
 * a stale `dist` full of compiled scenarios would show up as duplicates.
 */
const DEFAULT_IGNORES: readonly string[] = [
  "!**/node_modules/**",
  "!**/dist/**",
];

const MAGIC = /[*?[\]{}]/;

export interface ResolvedGlobs {
  /**
   * Root-absolute patterns, ready to write into `import.meta.glob`. A generated
   * module has no directory of its own, so a relative pattern has no base there.
   */
  readonly patterns: readonly string[];
  /**
   * The longest directory every positive pattern shares, root-absolute. The
   * runner strips it from each module path to derive a scenario id.
   */
  readonly root: string;
}

/** A leading `./` and no leading slash at all mean the same directory. */
function toRootAbsolute(pattern: string): string {
  const negated = pattern.startsWith("!");
  const body = (negated ? pattern.slice(1) : pattern)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  return `${negated ? "!" : ""}/${body}`;
}

/**
 * The leading run of literal segments, which is `/src/lab` for a pattern
 * matching scenario files under `/src/lab`.
 *
 * A pattern with no wildcard at all names one file, so its last segment is
 * dropped. A directory whose own name carries a dot is kept: only the pattern
 * that ran out of segments before any wildcard ended on a filename.
 */
function staticPrefix(pattern: string): string[] {
  const all = pattern.split("/").slice(1);
  const segments: string[] = [];
  for (const segment of all) {
    if (MAGIC.test(segment)) return segments;
    segments.push(segment);
  }
  segments.pop();
  return segments;
}

function commonPrefix(all: string[][]): string[] {
  const first = all[0];
  if (!first) return [];
  const shared: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const segment = first[i];
    if (!all.every((segments) => segments[i] === segment)) break;
    shared.push(segment as string);
  }
  return shared;
}

/**
 * Normalises the patterns a project declares and reports the directory ids are
 * derived against.
 *
 * Both halves have to come from one place: an id is the module path relative to
 * that directory, so a root that does not match the patterns renames every
 * scenario, and an id is how a scenario is addressed from outside the page.
 */
export function resolveScenarioGlobs(
  patterns: readonly string[],
): ResolvedGlobs {
  const declared = patterns.map(toRootAbsolute);
  const positive = declared.filter((pattern) => !pattern.startsWith("!"));
  if (positive.length === 0) {
    throw new Error(
      "No scenario patterns to search: every pattern given is an exclusion.",
    );
  }
  const shared = commonPrefix(positive.map(staticPrefix));
  return {
    patterns: [...declared, ...DEFAULT_IGNORES],
    root: `/${shared.join("/")}`.replace(/\/$/, "") || "/",
  };
}

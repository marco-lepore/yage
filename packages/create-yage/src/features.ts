/**
 * Optional feature add-ons that `--features` can layer onto a scaffolded
 * project. Each feature appends to `package.json` dependencies (and, where
 * needed, devDependencies and scripts), may toggle `tsconfig.json` compiler
 * options, and may add lines to the next steps the CLI prints.
 *
 * Adding a new feature: append an entry to `FEATURES`, list it in
 * `FEATURE_IDS`, and add coverage in `features.test.ts`. The `--features`
 * CLI flag accepts a comma-separated list of these ids.
 */

export type FeatureId = "ui" | "save" | "effects" | "editor";

/** Range used for `@yagejs/*` deps the features add. Mirrors the templates. */
export const YAGE_RANGE = "^0.10.4";

/**
 * Range used for `@yagejs-tools/editor`. The tools packages are versioned
 * apart from the engine, so `scripts/sync-template-versions.mjs` — which
 * rewrites `YAGE_RANGE` and the template deps from `@yagejs/core`'s version —
 * leaves this one alone. It spans every 0.x release from the first one.
 */
export const EDITOR_RANGE = ">=0.1.0 <1.0.0";

/** React versions used by the `ui` feature. Matches `@yagejs/ui-react`. */
const REACT_RANGE = "^19.0.0";
const REACT_DOM_RANGE = "^19.0.0";
const REACT_TYPES_RANGE = "^19.0.0";

export interface FeatureSpec {
  id: FeatureId;
  /** Production deps added to package.json. */
  dependencies: Readonly<Record<string, string>>;
  /** Dev deps added to package.json. */
  devDependencies?: Readonly<Record<string, string>>;
  /** Entries added to the package.json `scripts` block. */
  scripts?: Readonly<Record<string, string>>;
  /** Compiler options applied to tsconfig.json. */
  tsconfigOptions?: Readonly<Record<string, unknown>>;
  /** Commands to print under "Next steps" once the scaffold is written. */
  nextSteps?: readonly string[];
}

export const FEATURES: Readonly<Record<FeatureId, FeatureSpec>> = {
  ui: {
    id: "ui",
    dependencies: {
      "@yagejs/ui": YAGE_RANGE,
      "@yagejs/ui-react": YAGE_RANGE,
      react: REACT_RANGE,
      "react-dom": REACT_DOM_RANGE,
    },
    devDependencies: {
      "@types/react": REACT_TYPES_RANGE,
    },
    tsconfigOptions: {
      jsx: "react-jsx",
    },
  },
  save: {
    id: "save",
    dependencies: { "@yagejs/save": YAGE_RANGE },
  },
  effects: {
    id: "effects",
    dependencies: { "@yagejs/effects": YAGE_RANGE },
  },
  editor: {
    id: "editor",
    // `@yagejs/level` is a runtime dep: the entity declarations the editor
    // places import `defineLevelEntity` from it, and so does the scene that
    // loads the saved file.
    dependencies: { "@yagejs/level": YAGE_RANGE },
    devDependencies: { "@yagejs-tools/editor": EDITOR_RANGE },
    scripts: { editor: "yage-editor" },
    nextSteps: ["npx yage-editor init"],
  },
};

/** Derived from `FEATURES` so adding a feature there auto-extends the CLI. */
export const FEATURE_IDS: readonly FeatureId[] = Object.freeze(
  Object.keys(FEATURES) as FeatureId[],
);

export function isFeatureId(value: string): value is FeatureId {
  return (FEATURE_IDS as readonly string[]).includes(value);
}

/**
 * Parses a comma-separated list of feature ids. Returns `{ error }` on
 * the first unknown id (or an empty list, which is almost always a typo
 * — `--features=` with no value); whitespace around items is trimmed and
 * empty segments are ignored.
 */
export function parseFeatureList(
  raw: string,
): { features: FeatureId[] } | { error: string } {
  const out: FeatureId[] = [];
  for (const segment of raw.split(",")) {
    const id = segment.trim();
    if (id === "") continue;
    if (!isFeatureId(id)) {
      return {
        error: `Unknown feature: ${id}. Valid options: ${FEATURE_IDS.join(", ")}`,
      };
    }
    if (!out.includes(id)) out.push(id);
  }
  if (out.length === 0) {
    return {
      error: `No features specified. Valid options: ${FEATURE_IDS.join(", ")}`,
    };
  }
  return { features: out };
}

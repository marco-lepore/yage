import type {
  LevelEntityClass,
  LevelProject,
  PackageContribution,
} from "@yagejs/level";
import type { EditorDiagnostic } from "../diagnostics/index.js";

/** What an import gave back: the project module and each contribution module. */
export interface EditorProjectModules {
  /** The `LevelProject` a game's own scenes use. */
  readonly project: unknown;
  /** One `PackageContribution` per dependency that declared level entities. */
  readonly contributions: readonly unknown[];
}

export type AssembledProject =
  /**
   * The project's entities composed with every usable contribution, ready for
   * `buildLevelCatalog`. `diagnostics` is not always empty: a contribution
   * module that is not a contribution is skipped and named, because the
   * alternative is a package's entity types missing with no reason given.
   */
  | {
      readonly ok: true;
      readonly project: LevelProject;
      readonly diagnostics: readonly EditorDiagnostic[];
    }
  /** The project module is not a project, so there is nothing to build. */
  | { readonly ok: false; readonly diagnostics: readonly EditorDiagnostic[] };

/**
 * Check what an import gave back and compose it into one project.
 *
 * The modules arrive from a graph resolved at run time, where a missing or
 * renamed export is `undefined` with no type error, so what enters is checked
 * rather than trusted. Nothing throws: the editor lists the diagnostics and
 * stays open, and the CLI prints them and exits non-zero.
 */
export function assembleProject(
  modules: EditorProjectModules,
): AssembledProject {
  const diagnostics: EditorDiagnostic[] = [];
  const project = asLevelProject(modules.project, diagnostics);
  const contributions = modules.contributions
    .map((value, index) => asContribution(value, index, diagnostics))
    .filter((value): value is PackageContribution => value !== undefined);
  if (!project) return { ok: false, diagnostics };

  return {
    ok: true,
    project: {
      entities: project.entities,
      contributions: merge(project.contributions, contributions),
    },
    diagnostics,
  };
}

/**
 * A package listed by the project and discovered from its manifest is one
 * contribution, not two. Composing both would declare every one of its
 * entities twice, which the catalog reports as duplicate type ids.
 */
function merge(
  declared: readonly PackageContribution[],
  discovered: readonly PackageContribution[],
): readonly PackageContribution[] {
  const names = new Set(declared.map((entry) => entry.packageName));
  return [
    ...declared,
    ...discovered.filter((entry) => !names.has(entry.packageName)),
  ];
}

function asLevelProject(
  value: unknown,
  diagnostics: EditorDiagnostic[],
): LevelProject | undefined {
  if (!isObject(value) || !Array.isArray(value.entities)) {
    diagnostics.push(
      catalogDiagnostic(
        "The project module's default export is not a level project. " +
          "Export defineLevelProject({ entities: [...] }) from it.",
      ),
    );
    return undefined;
  }
  const contributions = Array.isArray(value.contributions)
    ? (value.contributions as readonly PackageContribution[])
    : [];
  return {
    entities: value.entities as readonly LevelEntityClass[],
    contributions,
  };
}

function asContribution(
  value: unknown,
  index: number,
  diagnostics: EditorDiagnostic[],
): PackageContribution | undefined {
  if (
    !isObject(value) ||
    typeof value.packageName !== "string" ||
    !Array.isArray(value.entities)
  ) {
    diagnostics.push(
      catalogDiagnostic(
        `Package contribution ${String(index)} is not a level contribution. ` +
          "Its module must default-export { packageName, entities }.",
      ),
    );
    return undefined;
  }
  return {
    packageName: value.packageName,
    entities: value.entities as readonly LevelEntityClass[],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function catalogDiagnostic(message: string): EditorDiagnostic {
  return {
    code: "catalog-invalid",
    severity: "error",
    source: "catalog",
    message,
    revision: 0,
  };
}

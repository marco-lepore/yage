import {
  buildLevelCatalog,
  defineLevelProject,
  describeParams,
  type LevelCatalog,
  type LevelEntityClass,
  type LevelEntityDeclaration,
  type LevelProject,
  type PackageContribution,
  type ParamFieldDescription,
} from "@yagejs/level";
import type { EditorDiagnostic } from "../../shared/diagnostics/index.js";

/** What the generated entry imported: the project module and each contribution. */
export interface EditorProjectModules {
  /** The `LevelProject` a game's own scenes use. */
  readonly project: unknown;
  /** One `PackageContribution` per dependency that declared level entities. */
  readonly contributions: readonly unknown[];
}

/**
 * The asset kind whose default path the Actors panel shows as a picture. It is
 * the `kind` a project gives `defineLevelAsset` for its renderer textures, and
 * the name both documentation surfaces teach.
 */
const TEXTURE_ASSET_KIND = "texture";

/**
 * One entry the Actors panel lists. It is a view of a catalog entry rather than
 * the entry itself: the shell renders it, and a catalog entry carries the
 * entity class, which no component may hold.
 */
export interface PlaceableType {
  readonly typeId: string;
  readonly source: "project" | "package";
  /** The contributing package, when `source` is `"package"`. */
  readonly packageName?: string;
  /**
   * The default path of the type's first texture parameter, absent when it
   * declares none. It is the address the browser fetches, the same string the
   * running level hands to the texture loader, so the panel shows it with an
   * `<img>` and no engine involved.
   */
  readonly thumbnail?: string;
}

/**
 * What the inspector renders for one type: its declared parameter fields as
 * plain data — name, kind, and default — in declaration order. Like
 * {@link PlaceableType}, it is a view rather than the catalog entry, which
 * carries the schema, its callbacks, and the entity class that no component
 * may hold.
 */
export interface InspectableType {
  readonly typeId: string;
  readonly fields: readonly ParamFieldDescription[];
}

export type ProjectResult =
  /**
   * A catalog built. `diagnostics` is not always empty: a contribution module
   * that is not a contribution is skipped and named, because the alternative
   * is a package's entity types missing from the panel with no reason given.
   */
  | {
      readonly ok: true;
      readonly catalog: LevelCatalog;
      readonly diagnostics: readonly EditorDiagnostic[];
    }
  /** No catalog. The editor stays open, reports why, and refuses edits. */
  | { readonly ok: false; readonly diagnostics: readonly EditorDiagnostic[] };

/**
 * Owns the project's entity declarations as a resource: validate what the
 * generated entry imported, compose it with the packages' contributions, and
 * build the catalog everything downstream reads.
 *
 * Declaring never throws in `@yagejs/level` — every problem comes back as a
 * catalog error — so a project with a broken declaration leaves the editor
 * open and reporting rather than blank.
 */
export class ProjectCoordinator {
  private catalog: LevelCatalog | undefined;
  /**
   * Built once per catalog. The Actors panel reads this on each of its own
   * renders, and a getter that mapped the entries again would allocate the
   * whole list each time.
   */
  private types: readonly PlaceableType[] = [];

  /** The catalog in force. Undefined until one builds. */
  get current(): { readonly catalog: LevelCatalog | undefined } {
    return { catalog: this.catalog };
  }

  /**
   * What the Actors panel can place, in catalog order. Empty until a catalog
   * builds, which is also when there is nothing to place into.
   */
  get placeables(): readonly PlaceableType[] {
    return this.types;
  }

  /**
   * The inspector's view of one type. Undefined for a type the catalog does
   * not have, and before a catalog builds — which is when there is nothing
   * to inspect a placement of that type against.
   */
  inspectable(typeId: string): InspectableType | undefined {
    const entry = this.catalog?.get(typeId);
    if (!entry) return undefined;
    const schema = entry.declaration.params;
    return {
      typeId: entry.id,
      fields: schema === undefined ? [] : describeParams(schema),
    };
  }

  initialize(modules: EditorProjectModules): ProjectResult {
    const diagnostics: EditorDiagnostic[] = [];
    const project = asLevelProject(modules.project, diagnostics);
    const contributions = modules.contributions
      .map((value, index) => asContribution(value, index, diagnostics))
      .filter((value): value is PackageContribution => value !== undefined);
    if (!project) return { ok: false, diagnostics };

    const result = buildLevelCatalog(
      defineLevelProject({
        entities: project.entities,
        contributions: merge(project.contributions, contributions),
      }),
    );
    if (!result.ok) {
      return {
        ok: false,
        diagnostics: [
          ...diagnostics,
          ...result.errors.map((error) => catalogDiagnostic(error.message)),
        ],
      };
    }
    this.catalog = result.catalog;
    this.types = result.catalog.entries.map((entry) => {
      const thumbnail = firstTexturePath(entry.declaration.params);
      return {
        typeId: entry.id,
        source: entry.source,
        ...(entry.packageName === undefined
          ? {}
          : { packageName: entry.packageName }),
        ...(thumbnail === undefined ? {} : { thumbnail }),
      };
    });
    return { ok: true, catalog: result.catalog, diagnostics };
  }
}

/**
 * The default path of the first texture parameter a type declares, in
 * declaration order.
 *
 * First rather than chosen: nothing marks which parameter is the art, and a
 * type that declares two textures has no rule the editor could read. A type
 * that declares none has no picture.
 */
function firstTexturePath(
  params: LevelEntityDeclaration["params"],
): string | undefined {
  if (params === undefined) return undefined;
  const field = describeParams(params).find(
    (description) => description.assetKind === TEXTURE_ASSET_KIND,
  );
  return field?.defaultValue;
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

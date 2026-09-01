import type { ParamFields } from "../params/types.js";
import type {
  LevelEntityDeclaration,
  LevelProject,
  LevelProjectOptions,
  PackageContribution,
  ParamsMigration,
} from "./types.js";

/**
 * Declare an entity class as placeable in a level.
 *
 * ```ts
 * export class Crate extends Entity {
 *   static readonly level = defineLevelEntity({
 *     id: "game.crate",
 *     version: 1,
 *     params: CrateParams,
 *   });
 *
 *   setup(params: ParamsOf<typeof CrateParams>): void {}
 * }
 * ```
 *
 * The declaration is frozen, so a mutation after a catalog is built cannot
 * change what that catalog reports.
 *
 * Declaring never throws. `buildLevelCatalog()` is what reports an id,
 * version, migration key, or parameter default that cannot work, because a
 * throw here would surface as a failed import of the entity module, which
 * locks editing rather than producing a diagnostic the editor can show.
 */
export function defineLevelEntity<F extends ParamFields>(
  declaration: LevelEntityDeclaration<F>,
): LevelEntityDeclaration<F> {
  const { id, version, params, migrations } = declaration;
  return Object.freeze({
    id,
    version,
    ...(params !== undefined ? { params } : {}),
    ...(migrations !== undefined
      ? { migrations: freezeMigrations(migrations) }
      : {}),
  });
}

/**
 * Compose a project's placeable content.
 *
 * A game passes its own entity classes. The editor's generated entry composes
 * the same project with the contributions it discovered from the project's
 * direct dependencies, which is why the result is spreadable back into this
 * call.
 */
export function defineLevelProject(options: LevelProjectOptions): LevelProject {
  const contributions = (options.contributions ?? []).map(freezeContribution);
  return Object.freeze({
    entities: Object.freeze([...options.entities]),
    contributions: Object.freeze(contributions),
  });
}

/**
 * Copied key by key, so a key the author wrote in a form that will never be
 * looked up — `"01"`, `"1.0"` — stays visible for the catalog to report
 * instead of being normalized into a different migration or dropped.
 */
function freezeMigrations(
  migrations: Readonly<Record<number, ParamsMigration>>,
): Readonly<Record<number, ParamsMigration>> {
  const frozen = Object.create(null) as Record<string, ParamsMigration>;
  for (const [key, migration] of Object.entries(migrations)) {
    frozen[key] = migration;
  }
  return Object.freeze(frozen) as Readonly<Record<number, ParamsMigration>>;
}

/**
 * A contribution is a package's own module constant. It is copied rather than
 * frozen in place, so composing a project neither depends on the package
 * having frozen it nor freezes an object the package still owns.
 *
 * A contribution that is not the shape it claims passes through untouched, for
 * `buildLevelCatalog()` to report. Composition runs while the generated entry
 * module is evaluated, where a throw would lock editing instead.
 */
function freezeContribution(
  contribution: PackageContribution,
): PackageContribution {
  if (typeof contribution !== "object" || contribution === null) {
    return contribution;
  }
  return Object.freeze({
    packageName: contribution.packageName,
    entities: Array.isArray(contribution.entities)
      ? Object.freeze([...contribution.entities])
      : contribution.entities,
  });
}

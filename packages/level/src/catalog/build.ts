import { typeName } from "../internal/describe.js";
import { referenceFields, schemaDefaultProblems } from "../params/schema.js";
import type {
  CatalogError,
  CatalogResult,
  LevelCatalogEntry,
  LevelEntityClass,
  LevelEntityDeclaration,
  LevelProject,
} from "./types.js";

/**
 * Build a project's catalog of placeable entity types.
 *
 * Every problem is collected rather than thrown: the editor lists them and
 * keeps the catalog it already had, and a game reaches its exception through
 * the strict loader instead. Project entities come first, then each package
 * contribution in the order the project composed them.
 *
 * The entities arrive from an imported module graph, where a missing export is
 * `undefined` with no type error, so what enters is checked rather than
 * trusted.
 */
export function buildLevelCatalog(project: LevelProject): CatalogResult {
  const errors: CatalogError[] = [];
  const byId = new Map<string, LevelCatalogEntry>();
  const entries: LevelCatalogEntry[] = [];

  const add = (
    candidate: LevelEntityClass,
    position: string,
    source: "project" | "package",
    packageName?: string,
  ): void => {
    if (typeof candidate !== "function") {
      errors.push({
        entityId: null,
        message: `${position} is ${typeName(candidate)}, not an entity class.`,
      });
      return;
    }
    // An own declaration, not an inherited one: `class Boss extends Slime {}`
    // reads `Slime.level` and would enter the catalog under Slime's id.
    if (!Object.hasOwn(candidate, "level")) {
      errors.push({
        entityId: null,
        message: `Entity class "${className(candidate)}" has no level declaration of its own.`,
      });
      return;
    }
    const declaration = candidate.level;
    const shape = declarationProblem(declaration);
    if (shape) {
      errors.push({
        entityId: null,
        message: `Entity class "${className(candidate)}" ${shape}`,
      });
      return;
    }
    const problems = declarationContentProblems(declaration);
    if (problems.length > 0) {
      for (const message of problems) {
        errors.push({ entityId: declaration.id, message });
      }
      return;
    }
    const existing = byId.get(declaration.id);
    if (existing) {
      errors.push({
        entityId: declaration.id,
        message: `Entity type "${declaration.id}" is declared by both ${describeEntry(existing.EntityClass, existing.packageName)} and ${describeEntry(candidate, packageName)}.`,
      });
      return;
    }
    const entry = Object.freeze({
      id: declaration.id,
      declaration,
      EntityClass: candidate,
      source,
      ...(packageName !== undefined ? { packageName } : {}),
    });
    byId.set(entry.id, entry);
    entries.push(entry);
  };

  project.entities.forEach((EntityClass, index) => {
    add(EntityClass, `Project entity ${index}`, "project");
  });
  for (const [index, contribution] of project.contributions.entries()) {
    if (typeof contribution !== "object" || contribution === null) {
      errors.push({
        entityId: null,
        message: `Contribution ${index} is ${typeName(contribution)}, not a package contribution.`,
      });
      continue;
    }
    const { packageName } = contribution;
    if (typeof packageName !== "string" || packageName === "") {
      errors.push({
        entityId: null,
        message: `Contribution ${index} does not name the package it comes from.`,
      });
      continue;
    }
    if (!Array.isArray(contribution.entities)) {
      errors.push({
        entityId: null,
        message: `Contribution "${packageName}" does not list its entities.`,
      });
      continue;
    }
    contribution.entities.forEach((EntityClass, position) => {
      add(
        EntityClass,
        `Entity ${position} contributed by "${packageName}"`,
        "package",
        packageName,
      );
    });
  }

  // A second pass, because a reference may name a type declared further down
  // `entities` or contributed by a package composed later.
  for (const entry of entries) {
    const schema = entry.declaration.params;
    if (schema === undefined) continue;
    for (const field of referenceFields(schema)) {
      if (field.types.length === 0) {
        errors.push({
          entityId: entry.id,
          message: `Entity type "${entry.id}" parameter "${field.name}" accepts no types, so nothing can be chosen for it.`,
        });
        continue;
      }
      for (const typeId of field.types) {
        if (byId.has(typeId)) continue;
        errors.push({
          entityId: entry.id,
          message: `Entity type "${entry.id}" parameter "${field.name}" accepts entity type "${typeId}", which this project does not declare.`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    catalog: Object.freeze({
      entries: Object.freeze(entries),
      contributions: Object.freeze([...project.contributions]),
      // A Map, so a placement typed "toString" or "__proto__" resolves as
      // unknown rather than reaching an inherited object member.
      get: (typeId: string) => byId.get(typeId),
    }),
  };
}

/**
 * The declaration's shape, which decides whether it can even be named in a
 * later message. Nothing makes a class declare through `defineLevelEntity()` —
 * `static level = { … }` type-checks — and a contributed class is another
 * package's data, so what arrives is checked rather than trusted.
 */
function declarationProblem(
  declaration: LevelEntityDeclaration,
): string | undefined {
  if (typeof declaration !== "object" || declaration === null) {
    return `has a level declaration that is ${typeName(declaration)}, not an object.`;
  }
  if (typeof declaration.id !== "string" || declaration.id === "") {
    return "has a level declaration with no id.";
  }
  return undefined;
}

/**
 * Everything else the declaration promises, collected together so one bad
 * declaration reports all of its problems at once.
 */
function declarationContentProblems(
  declaration: LevelEntityDeclaration,
): readonly string[] {
  const problems: string[] = [];
  const { id, version, params, migrations } = declaration;

  if (!Number.isInteger(version) || version < 1) {
    problems.push(
      `Entity type "${id}" needs a positive integer version, not ${JSON.stringify(version)}.`,
    );
  }
  if (migrations !== undefined && !isObject(migrations)) {
    problems.push(
      `Entity type "${id}" declares migrations as ${typeName(migrations)}, not an object.`,
    );
  } else if (migrations !== undefined) {
    for (const key of Object.keys(migrations)) {
      // A migration keyed by N rewrites version N into N + 1, so the keys run
      // from 1 to one below the current version. A key outside that range, or
      // written in a form no lookup produces, never runs.
      const from = Number(key);
      if (
        String(from) !== key ||
        !Number.isInteger(from) ||
        from < 1 ||
        (Number.isInteger(version) && from >= version)
      ) {
        problems.push(
          `Entity type "${id}" declares a migration keyed ${JSON.stringify(key)}, which never runs; keys are the integers 1 to ${Number.isInteger(version) ? version - 1 : "one below the version"}.`,
        );
      } else if (typeof Reflect.get(migrations, key) !== "function") {
        problems.push(
          `Entity type "${id}" declares the migration from version ${key} as ${typeName(Reflect.get(migrations, key))}, not a function.`,
        );
      }
    }
  }
  if (params !== undefined && !isObject(params._fields)) {
    problems.push(
      `Entity type "${id}" declares params that did not come from defineParams().`,
    );
  } else if (params !== undefined) {
    for (const error of schemaDefaultProblems(params)) {
      problems.push(
        `Entity type "${id}" parameter "${error.path.join(".")}" ${error.message}.`,
      );
    }
  }
  return problems;
}

function className(EntityClass: LevelEntityClass): string {
  return EntityClass.name === "" ? "(anonymous)" : EntityClass.name;
}

function describeEntry(
  EntityClass: LevelEntityClass,
  packageName: string | undefined,
): string {
  return packageName === undefined
    ? className(EntityClass)
    : `${className(EntityClass)} (${packageName})`;
}

function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

import { ErrorBoundaryKey, Transform } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import type {
  LevelPlacement,
  LevelPoint,
  LevelTransform,
} from "../document/types.js";
import { describeError } from "../internal/describe.js";
import { ParamDecodeError, decodeParams } from "../params/schema.js";
import type { ParamFields, ParamsSchema } from "../params/types.js";
import type {
  LevelDiagnostic,
  PreparedLevel,
  PreparedPlacement,
} from "../prepare/types.js";
import { LevelLoadError } from "./errors.js";
import { applyPlacementLayer } from "./layer.js";
import { LevelInstance } from "./LevelInstance.js";
import type {
  InstantiateLevelOptions,
  LevelInstanceTransform,
} from "./types.js";

/**
 * How the batch's typed `setup` slot has to see an entity that takes
 * parameters. A catalog holds classes as `new () => Entity`, which erases each
 * one's real `setup()` signature, and `Entity` declares `setup?` optionally —
 * which resolves its parameter tuple to `never` and closes the slot entirely.
 * The declaration's schema is what says a value belongs there.
 */
type ParameterizedEntity = Entity & { setup(params: unknown): void };

/**
 * Put a prepared level's entities in a scene, all at once or not at all.
 *
 * ```ts
 * export class ForestScene extends Scene {
 *   readonly preload = levelAssets(forest);
 *   private level?: LevelInstance;
 *
 *   onEnter(): void {
 *     this.level = instantiateLevel(this, forest, { namespace: "forest" });
 *   }
 * }
 * ```
 *
 * Loading is strict: a prepared level carrying any diagnostic is refused
 * outright, and a failure while building throws {@link LevelLoadError} with
 * the scene untouched. Nothing partial is ever left behind — a construction
 * failure rolls the spawn batch back before it publishes, and an activation
 * failure disposes the instance it had already committed.
 *
 * Every entity is reserved before any `setup()` runs, so a setup parameter can
 * hold a handle to a placement further down the document, and the authored
 * parent links exist before setup can read them.
 */
export function instantiateLevel(
  scene: Scene,
  prepared: PreparedLevel,
  options: InstantiateLevelOptions,
): LevelInstance {
  const documentId = prepared.document.id;
  if (prepared.diagnostics.length > 0) {
    throw refusal(documentId, prepared.diagnostics);
  }
  const namespace = checkNamespace(options.namespace, documentId);
  const root = resolveInstanceTransform(options.transform, documentId);
  const ordered = parentFirst(prepared.placements);

  const instance = build(scene, prepared, ordered, namespace, root);
  if (options.activation !== "deferred") instance.activate();
  return instance;
}

function build(
  scene: Scene,
  prepared: PreparedLevel,
  ordered: readonly PreparedPlacement[],
  namespace: string,
  root: LevelTransform,
): LevelInstance {
  const documentId = prepared.document.id;
  // Which placement the batch is on, so a throw from developer code can be
  // attributed to it rather than to whatever frame it escaped through.
  let building: PreparedPlacement | undefined;

  try {
    return scene.spawnBatch((batch) => {
      const byPlacementId = new Map<string, Entity>();

      for (const entry of prepared.placements) {
        building = entry;
        const placement = entry.placement;
        byPlacementId.set(
          placement.id,
          batch.reserve(entry.entry.EntityClass, {
            key: `${namespace}/${placement.key ?? placement.id}`,
            active: false,
          }),
        );
      }

      for (const entry of ordered) {
        const parent = entry.placement.parent;
        if (parent === undefined) continue;
        building = entry;
        batch.addChild(
          reserved(byPlacementId, parent),
          entry.placement.id,
          reserved(byPlacementId, entry.placement.id),
        );
      }

      // Where each placement ends up in the world, which a point parameter
      // converts its authored value through. `ordered` is parent-first, so
      // the pose above is always in hand by the time it is needed.
      const worldPoses = new Map<string, LevelTransform>();

      for (const entry of ordered) {
        building = entry;
        const entity = reserved(byPlacementId, entry.placement.id);
        const parent = entry.placement.parent;
        const above = parent === undefined ? root : worldPoses.get(parent);
        if (above === undefined) {
          throw new Error(
            `Placement "${parent}" was not composed before its child.`,
          );
        }
        const worldPose = compose(above, entry.placement.transform);
        worldPoses.set(entry.placement.id, worldPose);
        const schema = entry.entry.declaration.params;
        if (schema === undefined) {
          batch.setup(entity);
        } else {
          batch.setup(
            entity as ParameterizedEntity,
            decode(scene, entity, schema, entry, byPlacementId, worldPose),
          );
        }
        const layer = entry.placement.layer;
        if (layer !== undefined) applyPlacementLayer(entity, layer);
        place(entity, entry.placement, worldPose);
      }

      building = undefined;
      return new LevelInstance(scene, documentId, ordered, byPlacementId);
    });
  } catch (error) {
    // Everything is rewrapped, including a `LevelLoadError` from a level a
    // `setup()` loaded itself: the caller asked this document to load, and an
    // inner document's identity in its place would name the wrong level.
    throw new LevelLoadError(
      building === undefined
        ? `Loading level "${documentId}" failed: ${describeError(error)}`
        : `Loading placement "${building.placement.id}" of level "${documentId}" failed: ${describeError(error)}`,
      {
        documentId,
        placementId: building?.placement.id,
        typeId: building?.entry.id,
        path: error instanceof ParamDecodeError ? error.path : undefined,
        cause: error,
      },
    );
  }
}

/**
 * Turn authored parameters into the values `setup()` receives.
 *
 * A parameter kind's `decode` runs a function the game registered — the one a
 * `defineLevelAsset()` descriptor carries — so it goes through the engine's
 * `ErrorBoundary`, which records the culprit and rethrows. Without it a
 * throwing codec is attributed to whatever caller the throw escaped through
 * and never reaches `Inspector.getErrors().callbackErrors`.
 */
function decode(
  scene: Scene,
  entity: Entity,
  schema: ParamsSchema<ParamFields>,
  entry: PreparedPlacement,
  byPlacementId: Map<string, Entity>,
  worldPose: LevelTransform,
): unknown {
  const boundary = scene.context?.tryResolve(ErrorBoundaryKey);
  let decoded: unknown;
  const run = (): void => {
    decoded = decodeParams(schema, entry.placement.params, {
      // Every placement is reserved before this loop starts, so a reference
      // to a placement further down the document resolves, and so does a
      // cycle. A reserved entity is neither destroyed nor pooled, so the
      // handle it hands out is live.
      resolveEntityRef: (id) => reserved(byPlacementId, id).handle(),
      worldPose,
    });
  };
  if (boundary) {
    boundary.wrapCallback(run, {
      // What a codec failure has to name: the type here, and the scene key —
      // which carries both the namespace and the placement — where an entity
      // name would only repeat the class. The parameter itself is named by the
      // message `ParamDecodeError` builds.
      kind: `Level parameter codec for "${entry.entry.id}"`,
      entity: entity.requireKey(),
      scene: scene.name,
    });
  } else {
    run();
  }
  return decoded;
}

/**
 * Apply a placement's authored transform. A top-level placement is put at the
 * world pose the level composed for it; a child's authored transform is
 * already relative to its parent, and the scene graph composes it.
 */
function place(
  entity: Entity,
  placement: LevelPlacement,
  worldPose: LevelTransform,
): void {
  const transform = entity.tryGet(Transform);
  if (!transform) {
    throw new Error(
      `Entity "${entity.name}" has no Transform, so a level cannot place it. ` +
        `Add one in setup().`,
    );
  }
  const pose = placement.parent === undefined ? worldPose : placement.transform;
  transform.setPosition(pose.position.x, pose.position.y);
  transform.setRotation(pose.rotation);
  transform.setScale(pose.scale.x, pose.scale.y);
}

/** `local` expressed in the space `parent` sits in. */
function compose(
  parent: LevelTransform,
  local: LevelTransform,
): LevelTransform {
  const scaled = {
    x: local.position.x * parent.scale.x,
    y: local.position.y * parent.scale.y,
  };
  const sin = Math.sin(parent.rotation);
  const cos = Math.cos(parent.rotation);
  return {
    position: {
      x: parent.position.x + scaled.x * cos - scaled.y * sin,
      y: parent.position.y + scaled.x * sin + scaled.y * cos,
    },
    rotation: parent.rotation + local.rotation,
    scale: {
      x: parent.scale.x * local.scale.x,
      y: parent.scale.y * local.scale.y,
    },
  };
}

/**
 * Placements with every parent ahead of its children, and placements at one
 * depth in the order the document listed them.
 *
 * This is setup order, activation order, and reversed, disposal order, and
 * same-layer draw order in YAGE is add order — so two overlapping placements
 * stack the way the document reads. Sorting by depth is what keeps that:
 * grouping each placement under its parent instead would let a child listed
 * before its parent drag that parent ahead of everything above it.
 */
function parentFirst(
  placements: readonly PreparedPlacement[],
): readonly PreparedPlacement[] {
  const byId = new Map(placements.map((entry) => [entry.placement.id, entry]));
  const depths = new Map<string, number>();

  const depthOf = (entry: PreparedPlacement): number => {
    const cached = depths.get(entry.placement.id);
    if (cached !== undefined) return cached;
    let depth = 0;
    let current = entry;
    // Bounded: a parsed document's hierarchy is a tree, but one built by hand
    // can close a cycle, and rejecting that is the batch's job, not this walk's.
    while (depth <= placements.length) {
      const parentId = current.placement.parent;
      if (parentId === undefined) break;
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      current = parent;
      depth++;
    }
    depths.set(entry.placement.id, depth);
    return depth;
  };

  // A parent is always shallower than its children, and Array.sort is stable.
  return [...placements].sort((a, b) => depthOf(a) - depthOf(b));
}

function reserved(byPlacementId: Map<string, Entity>, id: string): Entity {
  const entity = byPlacementId.get(id);
  if (!entity) {
    throw new Error(
      `Placement "${id}" is referenced but is not in this level.`,
    );
  }
  return entity;
}

function checkNamespace(namespace: string, documentId: string): string {
  if (namespace === "" || namespace.includes("/")) {
    throw new LevelLoadError(
      `A level namespace must be a non-empty string without "/", and "${namespace}" is not. ` +
        `It prefixes every scene key this load derives.`,
      { documentId },
    );
  }
  return namespace;
}

function resolveInstanceTransform(
  transform: LevelInstanceTransform | undefined,
  documentId: string,
): LevelTransform {
  const resolved: LevelTransform = {
    position: transform?.position ?? { x: 0, y: 0 },
    rotation: transform?.rotation ?? 0,
    scale: transform?.scale ?? { x: 1, y: 1 },
  };
  const bad = badComponent(resolved);
  if (bad) {
    throw new LevelLoadError(
      `The instance transform's ${bad} is not usable, so the level cannot be placed.`,
      { documentId },
    );
  }
  return resolved;
}

function badComponent(transform: LevelTransform): string | undefined {
  if (!Number.isFinite(transform.rotation)) return "rotation";
  const position = pointProblem(transform.position);
  if (position) return `position ${position}`;
  // A zero scale is a value here too: the whole level is placed at no size,
  // which is what an instance tweened up from nothing starts at. Whether that
  // is useful is the caller's to decide.
  const scale = pointProblem(transform.scale);
  if (scale) return `scale ${scale}`;
  return undefined;
}

function pointProblem(point: LevelPoint): string | undefined {
  for (const axis of ["x", "y"] as const) {
    if (!Number.isFinite(point[axis])) return axis;
  }
  return undefined;
}

function refusal(
  documentId: string,
  diagnostics: readonly LevelDiagnostic[],
): LevelLoadError {
  const listed = diagnostics
    .slice(0, 3)
    .map((diagnostic) => `${diagnostic.placementId}: ${diagnostic.message}`)
    .join(" ");
  const hidden = diagnostics.length - Math.min(3, diagnostics.length);
  const first = diagnostics[0];
  return new LevelLoadError(
    `Level "${documentId}" has ${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"} ` +
      `and is not loaded. ${listed}${hidden > 0 ? ` And ${hidden} more.` : ""}`,
    {
      documentId,
      placementId: first?.placementId,
      path: first?.path,
      diagnostics,
    },
  );
}

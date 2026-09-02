import { Transform, type Engine } from "@yagejs/core";
import { SpriteComponent } from "@yagejs/renderer";
import { Crate } from "./Crate.js";
import { Switch } from "./Switch.js";

/** The namespace the extension registers under, on both pages. */
export const LEVEL_FACTS = "levelFixture";

/** What a test can read about one placement the page loaded. */
export interface PlacementFact {
  /**
   * What the level file names this entity in a scene: the placement's `key`
   * when it authored one, and its `id` when it did not.
   */
  readonly sceneId: string;
  /** The asset path the placement's parameters carry. */
  readonly sprite: string;
  /**
   * The render layer the crate's sprite is actually parented to, read off the
   * display tree rather than off what the component recorded.
   */
  readonly layer: string;
  /** The runtime parent's scene id, absent for a top-level placement. */
  readonly parent?: string;
  /** Where the entity ended up, after the parent chain is applied. */
  readonly world: { readonly x: number; readonly y: number };
  /** How far it ended up turned, in radians, after the parent chain. */
  readonly rotation: number;
  /** How far it ended up scaled, after the parent chain. */
  readonly scale: { readonly x: number; readonly y: number };
}

/** What a test can read about one switch and the placements it points at. */
export interface SwitchFact {
  readonly sceneId: string;
  /**
   * The scene id of the entity the `door` handle resolves to, and `null` once
   * that entity is gone. This is the only check that a reference parameter
   * reached the right entity rather than merely a live one.
   */
  readonly door: string | null;
  /** The same for the optional `chime`, and `null` when none was chosen. */
  readonly chime: string | null;
}

/** The read-only API {@link exposeLevelFacts} registers. */
export interface LevelFacts {
  /** Every loaded placement, in the order the scene created them. */
  placements(): PlacementFact[];
  /** Every loaded switch and what its two reference parameters resolved to. */
  switches(): SwitchFact[];
}

/**
 * Let a test tell three crates apart.
 *
 * `getEntities()` reports every crate under one name and with its local
 * transform, which says nothing about which placement it came from, what it
 * was authored with, or where the parent chain put it. Reading it is what this
 * adds; it changes nothing, and both the editor's preview and the game page
 * register it so one test can compare them.
 *
 * The pose is reported in world space because that is what a gizmo gesture is
 * judged by: a turn applied to a parent has to reach the child, and a child's
 * own stored transform does not say whether it did.
 */
export function exposeLevelFacts(engine: Engine): void {
  const facts: LevelFacts = {
    placements: () => {
      const scene = engine.scenes.active;
      if (!scene) return [];
      const placements: PlacementFact[] = [];
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed || !(entity instanceof Crate)) continue;
        const sceneId = sceneIdOf(entity.key);
        if (sceneId === undefined) continue;
        const transform = entity.get(Transform);
        const world = transform.worldPosition;
        const scale = transform.worldScale;
        const parent = sceneIdOf(entity.parent?.key);
        placements.push({
          sceneId,
          sprite: entity.sprite,
          layer: String(
            entity.get(SpriteComponent).renderObject.parent?.label ?? "",
          ),
          ...(parent === undefined ? {} : { parent }),
          world: { x: world.x, y: world.y },
          rotation: transform.worldRotation,
          scale: { x: scale.x, y: scale.y },
        });
      }
      return placements;
    },
    switches: () => {
      const scene = engine.scenes.active;
      if (!scene) return [];
      const facts: SwitchFact[] = [];
      for (const entity of scene.getEntities()) {
        if (entity.isDestroyed || !(entity instanceof Switch)) continue;
        const sceneId = sceneIdOf(entity.key);
        if (sceneId === undefined) continue;
        facts.push({
          sceneId,
          door: sceneIdOf(entity.door?.current?.key) ?? null,
          chime: sceneIdOf(entity.chime?.current?.key) ?? null,
        });
      }
      return facts;
    },
  };
  engine.inspector.addExtension(LEVEL_FACTS, facts);
}

/**
 * What a level named this entity, inside its scene key. `instantiateLevel`
 * derives every key as `<namespace>/<placement key or id>`, and the editor's
 * preview picks a new namespace on each rebuild, so the part after the first
 * separator is what stays the same across a rebuild and across the two pages.
 */
function sceneIdOf(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const separator = key.indexOf("/");
  return separator === -1 ? undefined : key.slice(separator + 1);
}

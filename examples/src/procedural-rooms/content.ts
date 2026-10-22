import { Entity, Transform } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import {
  buildLevelCatalog,
  defineLevelEntity,
  defineLevelProject,
  defineParams,
  param,
  prepareLevel,
} from "@yagejs/level";
import type { LevelDocument, ParamsOf, PreparedLevel } from "@yagejs/level";
import { CONTENT_LAYER, TILE } from "./constants.js";
import { TEMPLATES } from "./rooms.js";

// ---------------------------------------------------------------------------
// Authored room content, one level document per template
// ---------------------------------------------------------------------------

const BeaconParams = defineParams({
  color: param.color("#93c5fd"),
});

/** Stands in for a room's authored content: enemies, rewards or interactions. */
export class Beacon extends Entity {
  static readonly level = defineLevelEntity({
    id: "procedural-rooms.beacon",
    version: 1,
    params: BeaconParams,
  });
  setup(params: ParamsOf<typeof BeaconParams>): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: CONTENT_LAYER }).draw((g) => {
        g.circle(0, 0, 5).stroke({ color: params.color, width: 2 });
      }),
    );
  }
}

/**
 * Prepared content keyed by template id. `MapState` hands each room its
 * template's level through `instantiateRoomLayout`'s `levelFor`.
 * Positions are room-local pixels; the loader adds each room's offset.
 */
export function prepareRoomContent(): Readonly<Record<string, PreparedLevel>> {
  const catalog = buildLevelCatalog(defineLevelProject({ entities: [Beacon] }));
  if (!catalog.ok) throw new Error("Room content catalog is invalid");
  return Object.fromEntries(
    TEMPLATES.map((template) => {
      const document: LevelDocument = {
        format: "yage-level",
        version: 1,
        id: template.id,
        metadata: {},
        extensions: {},
        entities: [
          {
            id: "beacon",
            type: "procedural-rooms.beacon",
            typeVersion: 1,
            active: true,
            transform: {
              position: {
                x: (template.size.width / 2) * TILE,
                y: (template.size.height / 2) * TILE,
              },
              rotation: 0,
              scale: { x: 1, y: 1 },
            },
            params: { color: template.id === "boss" ? "#fbbf24" : "#93c5fd" },
            extensions: {},
          },
        ],
      };
      return [template.id, prepareLevel(document, catalog.catalog)];
    }),
  );
}

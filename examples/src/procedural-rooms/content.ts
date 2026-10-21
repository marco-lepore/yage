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
import { TEMPLATES } from "./rooms.js";
import { ROOM_CENTER } from "./constants.js";

const BeaconParams = defineParams({
  color: param.color("#93c5fd"),
});
/** Game-owned authored content: replace this entity with enemies, rewards or interactions. */
class Beacon extends Entity {
  static readonly level = defineLevelEntity({
    id: "room-lab.beacon",
    version: 1,
    params: BeaconParams,
  });
  setup(params: ParamsOf<typeof BeaconParams>): void {
    this.add(new Transform());
    this.add(
      new GraphicsComponent({ layer: "content" }).draw((g) => {
        g.circle(0, 0, 5).stroke({ color: params.color, width: 2 });
      }),
    );
  }
}
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
            type: "room-lab.beacon",
            typeVersion: 1,
            active: true,
            transform: {
              position: { ...ROOM_CENTER },
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

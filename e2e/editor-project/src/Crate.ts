import { Entity, Transform, Vec2 } from "@yagejs/core";
import {
  defineLevelAsset,
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";
import { SpriteComponent, texture } from "@yagejs/renderer";

const textureAsset = defineLevelAsset({ kind: "texture", create: texture });

const CrateParams = defineParams({
  sprite: param.asset(textureAsset, "assets/player_idle.png"),
});

/** The placeable type most cases measure: one whole picture, drawn centred. */
export class Crate extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.crate",
    version: 1,
    params: CrateParams,
  });

  /**
   * The asset path this crate was set up with. The sprite holds the loaded
   * texture; this is the path the placement authored, which is what the
   * Inspector extension reports.
   */
  sprite = "";

  setup(params: ParamsOf<typeof CrateParams>): void {
    this.sprite = params.sprite.path;
    this.add(new Transform({ position: new Vec2(0, 0) }));
    // Centred, so the placement's authored position is the middle of what the
    // editor draws and what a click selects.
    this.add(
      new SpriteComponent({
        texture: params.sprite,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

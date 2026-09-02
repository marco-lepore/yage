import { Entity, Transform, Vec2 } from "@yagejs/core";
import {
  defineLevelAsset,
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";
import { AnimatedSpriteComponent, texture } from "@yagejs/renderer";

const textureAsset = defineLevelAsset({ kind: "texture", create: texture });

/**
 * The grid the torch's sheet is cut on, stated once: the parameter carries it
 * to the editor's thumbnail, and `setup()` spreads it into the frame source.
 */
const TORCH_FRAMES = { frameWidth: 48 };

const TorchParams = defineParams({
  sprite: param.asset(textureAsset, "assets/player_walk.png", TORCH_FRAMES),
});

/** A placeable type whose art is a sprite sheet rather than one picture. */
export class Torch extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.torch",
    version: 1,
    params: TorchParams,
  });

  setup(params: ParamsOf<typeof TorchParams>): void {
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(
      new AnimatedSpriteComponent({
        source: { sheet: params.sprite.path, ...TORCH_FRAMES },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

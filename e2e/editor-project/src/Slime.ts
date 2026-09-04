import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import {
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";

const SlimeParams = defineParams({
  speed: param.number(40, { min: 5, max: 200, step: 5 }),
  coins: param.integer(3, { min: 0 }),
  awake: param.boolean(true),
  title: param.string("Slime"),
  notes: param.string("", { multiline: true, optional: true }),
  facing: param.select("left", ["left", "right"]),
  mood: param.select("calm", ["calm", "angry"], { optional: true }),
});

/** The one component a slime has, so a press in the viewport finds it. */
class SlimeBody extends Component {}

/** A placeable type declaring one parameter of every plain kind. */
export class Slime extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.slime",
    version: 1,
    params: SlimeParams,
  });

  /** What the placement was set up with, held for a check that reads it. */
  params: ParamsOf<typeof SlimeParams> | undefined;

  setup(params: ParamsOf<typeof SlimeParams>): void {
    this.params = params;
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(new SlimeBody());
  }
}

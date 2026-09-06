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
  drift: param.vec2({ x: 0, y: -12 }),
  patrolEnd: param.point({ x: 120, y: 0 }, { relative: true }),
  home: param.point({ x: 0, y: 0 }, { optional: true }),
  loot: param.object({
    item: param.string("coin"),
    count: param.integer(1, { min: 1 }),
  }),
  spawns: param.array(
    param.object({
      type: param.select("slime", ["slime", "bat"]),
      delay: param.number(1, { min: 0 }),
    }),
  ),
  noise: param.json({ default: { seed: 1 } }),
  tint: param.color("#88ff88"),
  pace: param.custom<number>({
    default: "slow",
    decode: (value) => (value === "fast" ? 120 : 40),
    editor: { kind: "select", options: ["slow", "fast"] },
  }),
});

/** The one component a slime has, so a press in the viewport finds it. */
class SlimeBody extends Component {}

/** A placeable type declaring one parameter of every kind but `asset` and `entityRef`. */
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

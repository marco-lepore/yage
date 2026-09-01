import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { defineLevelEntity } from "@yagejs/level";

/**
 * What the chime is: a component with no picture, standing in for the lights,
 * emitters and panels a real project places.
 */
class ChimeSource extends Component {}

/** A placeable type that draws nothing at all. */
export class Chime extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.chime",
    version: 1,
  });

  setup(): void {
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(new ChimeSource());
  }
}

import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import type { EntityHandle } from "@yagejs/core";
import {
  defineLevelEntity,
  defineParams,
  param,
  type ParamsOf,
} from "@yagejs/level";
import { Chime } from "./Chime.js";
import { Crate } from "./Crate.js";

const SwitchParams = defineParams({
  door: param.entityRef<Crate>({ types: ["game.crate"] }),
  chime: param.entityRef<Chime>({ types: ["game.chime"], optional: true }),
});

/**
 * The one component a switch has of its own, so the placement is clickable in
 * the viewport: it draws nothing, and a component mark is what a press finds.
 */
class SwitchMechanism extends Component {}

/** A placeable type whose parameters point at other placements. */
export class Switch extends Entity {
  static readonly level = defineLevelEntity({
    id: "game.switch",
    version: 1,
    params: SwitchParams,
  });

  /** Held from `setup()`, read once the level is running. */
  door: EntityHandle<Crate> | undefined;
  chime: EntityHandle<Chime> | undefined;

  setup(params: ParamsOf<typeof SwitchParams>): void {
    this.door = params.door;
    this.chime = params.chime;
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(new SwitchMechanism());
  }
}

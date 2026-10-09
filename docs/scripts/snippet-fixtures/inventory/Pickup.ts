import { Entity } from "@yagejs/core";
import type { Vec2 } from "@yagejs/core";
export declare class Pickup extends Entity {
  setup(params: { itemId: string; position: Vec2 }): void;
}

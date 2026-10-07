import { Entity } from "@yagejs/core";
import type { Vec2 } from "@yagejs/core";
export declare class Bullet extends Entity {
  setup(params: { position: Vec2; target: Vec2 }): void;
}

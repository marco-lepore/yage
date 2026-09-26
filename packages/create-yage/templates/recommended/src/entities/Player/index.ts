import { Entity, Transform, Vec2 } from "@yagejs/core";
import {
  AnimatedSpriteComponent,
  AnimationController,
  type CameraEntity,
} from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import {
  PLAYER_FRAME_SIZE,
  playerIdleTex,
  playerWalkTex,
  playerJumpTex,
} from "../../assets";
import { PlayerController } from "./PlayerController";
import { PlayerRespawn } from "./PlayerRespawn";
import {
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_COIN,
  LAYER_HAZARD,
} from "../../layers";

export type PlayerAnim = "idle" | "walk" | "jump";

/**
 * Player entity with an animated sprite, a physics body, an input controller,
 * and a respawn when something hostile touches it.
 */
export class Player extends Entity {
  readonly name = "player";

  setup(params: { x: number; y: number; camera: CameraEntity }): void {
    const spawnPoint = new Vec2(params.x, params.y);
    this.add(new Transform({ position: spawnPoint }));

    const idleSource = {
      sheet: playerIdleTex,
      frameWidth: PLAYER_FRAME_SIZE,
    };
    const sprite = new AnimatedSpriteComponent({
      source: idleSource,
      layer: "player",
      anchor: { x: 0.5, y: 0.5 },
    });
    this.add(sprite);

    this.add(
      new AnimationController<PlayerAnim>({
        idle: { source: idleSource, speed: 0.12 },
        walk: {
          source: { sheet: playerWalkTex, frameWidth: PLAYER_FRAME_SIZE },
          speed: 0.2,
        },
        jump: {
          source: { sheet: playerJumpTex, frameWidth: PLAYER_FRAME_SIZE },
          speed: 0.12,
          loop: false,
        },
      }),
    );

    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "box", width: 22, height: 32 },
        friction: 0,
        layers: LAYER_PLAYER,
        mask: LAYER_PLATFORM | LAYER_COIN | LAYER_HAZARD,
      }),
    );

    this.add(new PlayerController());
    this.add(new PlayerRespawn({ camera: params.camera, spawnPoint }));

    // The camera eases after the player, starting on it.
    params.camera.follow(this, { smoothing: 0.12, snap: true });
  }
}

import { Entity, Transform, Vec2 } from "@yage/core";
import { AnimatedSpriteComponent, AnimationController } from "@yage/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yage/physics";
import { AudioManagerKey } from "@yage/audio";
import {
  PLAYER_FRAME_SIZE,
  PlayerHit,
  hurtSfx,
  playerIdleTex,
  playerWalkTex,
  playerJumpTex,
} from "../../scenes/GameScene";
import { PlayerController } from "./PlayerController";
import {
  LAYER_PLAYER,
  LAYER_PLATFORM,
  LAYER_COIN,
  LAYER_HAZARD,
} from "../../layers";
import { Hostile } from "../../traits";

export type PlayerAnim = "idle" | "walk" | "jump";

/** Player entity with an animated sprite, physics body, and input controller. */
export class Player extends Entity {
  readonly name = "player";

  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y) }));

    const idleSource = { sheet: playerIdleTex.path, frameWidth: PLAYER_FRAME_SIZE };
    const sprite = new AnimatedSpriteComponent({
      source: idleSource,
      layer: "player",
    });
    this.add(sprite);
    sprite.animatedSprite.anchor.set(0.5, 0.5);

    this.add(
      new AnimationController<PlayerAnim>({
        idle: { source: idleSource, speed: 0.12 },
        walk: {
          source: { sheet: playerWalkTex.path, frameWidth: PLAYER_FRAME_SIZE },
          speed: 0.2,
        },
        jump: {
          source: { sheet: playerJumpTex.path, frameWidth: PLAYER_FRAME_SIZE },
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
    const collider = new ColliderComponent({
      shape: { type: "box", width: 22, height: 32 },
      friction: 0,
      layers: LAYER_PLAYER,
      mask: LAYER_PLATFORM | LAYER_COIN | LAYER_HAZARD,
    });
    this.add(collider);

    // Trait-based hostile detection — any entity with @trait(Hostile)
    // (Hazard, Slime, or your own) triggers a respawn via the PlayerHit event.
    const audio = this.scene!.context.resolve(AudioManagerKey);
    collider.onCollision((ev) => {
      if (ev.started && ev.other.hasTrait(Hostile)) {
        audio.play(hurtSfx.path, { channel: "sfx" });
        this.emit(PlayerHit);
      }
    });

    this.add(new PlayerController());
  }
}

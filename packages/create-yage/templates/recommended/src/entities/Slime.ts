import { Component, Entity, Transform, Vec2, trait } from "@yage/core";
import { AnimatedSpriteComponent } from "@yage/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yage/physics";
import { SLIME_FRAME_SIZE, slimeTex } from "../scenes/GameScene.js";
import { LAYER_HAZARD, LAYER_PLAYER } from "../layers.js";
import { Hostile } from "../traits.js";

/** Ground enemy that chases the player horizontally. Shares `Hostile` trait with `Hazard`. */
@trait(Hostile)
export class Slime extends Entity {
  private spawnX = 0;
  private spawnY = 0;

  setup(params: { x: number; y: number }): void {
    this.spawnX = params.x;
    this.spawnY = params.y;
    this.add(new Transform({ position: new Vec2(params.x, params.y), scale: new Vec2(2, 2) }));

    const sprite = new AnimatedSpriteComponent({
      source: {
        sheet: slimeTex.path,
        frameWidth: SLIME_FRAME_SIZE,
        frameHeight: SLIME_FRAME_SIZE,
      },
      layer: "world",
    });
    this.add(sprite);
    sprite.animatedSprite.anchor.set(0.5, 0.5);
    sprite.play({ speed: 0.1, loop: true });

    this.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        gravityScale: 0,
      }),
    );
    this.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 20 },
        sensor: true,
        layers: LAYER_HAZARD,
        mask: LAYER_PLAYER,
      }),
    );
    this.add(new SlimeAI());
  }

  resetPosition(): void {
    this.get(RigidBodyComponent).setVelocity(Vec2.ZERO);
    this.get(RigidBodyComponent).setPosition(this.spawnX, this.spawnY);
    this.get(Transform).setPosition(this.spawnX, this.spawnY);
  }
}

class SlimeAI extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly body = this.sibling(RigidBodyComponent);

  private static readonly SPEED = 50;

  update(): void {
    const player = this.scene?.findEntity("player");
    if (!player) return;

    const playerX = player.get(Transform).position.x;
    const dx = playerX - this.transform.position.x;
    const dir = dx > 0 ? 1 : -1;

    this.body.setVelocity(new Vec2(dir * SlimeAI.SPEED, 0));

    const scale = this.transform.scale;
    const absX = Math.abs(scale.x);
    this.transform.setScale(dir > 0 ? absX : -absX, scale.y);
  }
}

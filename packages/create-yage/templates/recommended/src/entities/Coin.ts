import { Entity, Transform, Vec2 } from "@yagejs/core";
import { AnimatedSpriteComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { Oscillate } from "../components/Oscillate";
import { COIN_FRAME_SIZE, coinTex } from "../scenes/GameScene";
import { LAYER_COIN, LAYER_PLAYER } from "../layers";

/** Collectible coin. Bobs in place and destroys itself on contact. */
export class Coin extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(new Transform({ position: new Vec2(params.x, params.y), scale: new Vec2(2, 2) }));

    const sprite = new AnimatedSpriteComponent({
      source: { sheet: coinTex.path, frameWidth: COIN_FRAME_SIZE },
      layer: "world",
    });
    this.add(sprite);
    sprite.animatedSprite.anchor.set(0.5, 0.5);
    sprite.play({ speed: 0.2, loop: true });

    this.add(
      new RigidBodyComponent({ type: "kinematic", fixedRotation: true }),
    );
    const collider = new ColliderComponent({
      shape: { type: "circle", radius: 16 },
      sensor: true,
      layers: LAYER_COIN,
      mask: LAYER_PLAYER,
    });
    this.add(collider);
    this.add(new Oscillate({ axis: "y", amplitude: 4, period: 1.2 }));

    collider.onTrigger((ev) => {
      if (ev.entered) {
        console.log("coin collected");
        this.destroy();
      }
    });
  }
}

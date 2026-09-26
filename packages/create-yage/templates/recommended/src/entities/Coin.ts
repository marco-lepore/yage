import { Entity, Transform, Vec2 } from "@yagejs/core";
import { AnimatedSpriteComponent } from "@yagejs/renderer";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { Oscillate } from "../components/Oscillate";
import { COIN_FRAME_SIZE, coinTex } from "../assets";
import { CoinCollected } from "../events";
import { LAYER_COIN, LAYER_PLAYER } from "../layers";

/**
 * Collectible coin. Bobs in place; on contact it emits `CoinCollected` and
 * destroys itself. The HUD's `CoinCounter` does the counting.
 */
export class Coin extends Entity {
  setup(params: { x: number; y: number }): void {
    this.add(
      new Transform({
        position: new Vec2(params.x, params.y),
        scale: new Vec2(2, 2),
      }),
    );

    const sprite = new AnimatedSpriteComponent({
      source: { sheet: coinTex, frameWidth: COIN_FRAME_SIZE },
      layer: "world",
      anchor: { x: 0.5, y: 0.5 },
    });
    this.add(sprite);
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
        this.emit(CoinCollected);
        this.destroy();
      }
    });
  }
}

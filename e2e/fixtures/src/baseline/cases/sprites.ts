import { Entity, Transform, Vec2 } from "@yagejs/core";
import type { AssetHandle } from "@yagejs/core";
import { GraphicsComponent, SpriteComponent, texture } from "@yagejs/renderer";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

const Logo = texture("assets/yage.png");

/** The assets this case needs loaded before it mounts. */
export const assets: readonly AssetHandle<unknown>[] = [Logo];

/** What the sprites case reports. */
export interface SpritesReading extends CaseReading {
  textureWidth: number;
  textureHeight: number;
  visible: boolean;
}

/** Reads the loaded texture's size off the sprite the entity shows. */
export class SpritesProbe extends CaseProbe {
  private readonly sprite = this.sibling(SpriteComponent);

  get settled(): boolean {
    return this.sprite.renderObject.texture.width > 0;
  }

  reading(): SpritesReading {
    const { texture: loaded } = this.sprite.renderObject;
    return {
      textureWidth: loaded.width,
      textureHeight: loaded.height,
      visible: this.sprite.visible,
    };
  }
}

/** A loaded texture drawn beside a filled rectangle. */
export class SpritesCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(120, 180) }));
    this.add(
      new SpriteComponent({ texture: Logo, anchor: { x: 0.5, y: 0.5 } }),
    );
    this.add(
      new GraphicsComponent().draw((g) => {
        g.rect(-80, -40, 60, 80).fill({ color: 0x4ade80 });
      }),
    );
    this.add(new SpritesProbe());
  }
}

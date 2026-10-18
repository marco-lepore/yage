import { Entity, Transform, Vec2 } from "@yagejs/core";
import type { AssetHandle } from "@yagejs/core";
import { SpriteComponent, rectMask, texture } from "@yagejs/renderer";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

const Logo = texture("assets/yage.png");

/** The assets this case needs loaded before it mounts. */
export const assets: readonly AssetHandle<unknown>[] = [Logo];

/** What the masks case reports. */
export interface MasksReading extends CaseReading {
  maskAttached: boolean;
  frames: number;
}

/** Reports whether the sprite kept its mask through a drawn frame. */
export class MasksProbe extends CaseProbe {
  private readonly sprite = this.sibling(SpriteComponent);
  private frames = 0;

  update(): void {
    this.frames += 1;
  }

  get settled(): boolean {
    return this.frames >= 1;
  }

  reading(): MasksReading {
    return {
      maskAttached: this.sprite.sprite.mask !== null,
      frames: this.frames,
    };
  }
}

/** A sprite clipped to a rectangle. */
export class MasksCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(240, 180) }));
    const sprite = this.add(
      new SpriteComponent({ texture: Logo, anchor: { x: 0.5, y: 0.5 } }),
    );
    sprite.setMask(rectMask({ x: -40, y: -20, width: 80, height: 40 }));
    this.add(new MasksProbe());
  }
}

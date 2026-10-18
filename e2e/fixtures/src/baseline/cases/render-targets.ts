import { Entity, Transform, Vec2 } from "@yagejs/core";
import { Container, Graphics } from "pixi.js";
import {
  RendererKey,
  SpriteComponent,
  registerTexture,
  unregisterTexture,
} from "@yagejs/renderer";
import type { RenderTargetHandle, TextureResource } from "@yagejs/renderer";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 64;
/** The key the drawn buffer is shown under. */
const TARGET_TEXTURE = "baseline:render-target";
/** The key the baked drawing is shown under. */
const BAKED_TEXTURE = "baseline:baked-texture";
/** The key the buffer that follows the pixel ratio is shown under. */
const FOLLOWING_TEXTURE = "baseline:following-target";
/** Side of the baked square and of the following buffer, in pixels. */
const SMALL_SIDE = 32;
/** Where the case stands, in world pixels. */
const CASE_AT = new Vec2(480, 300);
/** Where the baked drawing sits, relative to the case. */
const BAKED_OFFSET = new Vec2(-120, 0);
/** Where the buffer that follows the pixel ratio sits, relative to it. */
const FOLLOWING_OFFSET = new Vec2(-70, 0);

/** What the render-targets case reports. */
export interface RenderTargetsReading extends CaseReading {
  width: number;
  height: number;
  resolution: number;
  rendererResolution: number;
  /** Texel density of the buffer that follows the renderer's. */
  followingResolution: number;
  drawn: boolean;
}

/**
 * Owns an offscreen buffer and draws into it once, so the entity's sprite can
 * show it. The buffer, its source and the registration are freed on destroy.
 */
export class RenderTargetsProbe extends CaseProbe {
  private readonly renderer = this.service(RendererKey);
  private readonly source = new Container();
  private readonly followingSource = new Container();
  private buffer: RenderTargetHandle | undefined;
  private following: RenderTargetHandle | undefined;
  private baked: TextureResource | undefined;
  private drawn = false;

  onAdd(): void {
    const art = new Graphics();
    art
      .rect(0, 0, TARGET_WIDTH, TARGET_HEIGHT)
      .fill({ color: 0x1d4ed8 })
      .circle(TARGET_WIDTH / 2, TARGET_HEIGHT / 2, 24)
      .fill({ color: 0xfacc15 });
    this.source.addChild(art);
    const buffer = this.renderer.createRenderTarget(this.source, {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      clearColor: 0x000000,
      label: "baseline-render-target",
    });
    buffer.render();
    this.buffer = buffer;
    this.drawn = !buffer.needsRender;
    registerTexture(TARGET_TEXTURE, buffer.texture);

    const baked = this.renderer.createTexture(
      (graphics) => {
        graphics.rect(0, 0, SMALL_SIDE, SMALL_SIDE).fill({ color: 0x22c55e });
      },
      { width: SMALL_SIDE, height: SMALL_SIDE },
    );
    this.baked = baked;
    registerTexture(BAKED_TEXTURE, baked);

    const followingArt = new Graphics();
    followingArt.rect(0, 0, SMALL_SIDE, SMALL_SIDE).fill({ color: 0xff00ff });
    this.followingSource.addChild(followingArt);
    const following = this.renderer.createRenderTarget(this.followingSource, {
      width: SMALL_SIDE,
      height: SMALL_SIDE,
      clearColor: 0x000000,
      label: "baseline-following-target",
      followResolution: true,
    });
    following.render();
    this.following = following;
    registerTexture(FOLLOWING_TEXTURE, following.texture);
  }

  onDestroy(): void {
    unregisterTexture(TARGET_TEXTURE);
    unregisterTexture(BAKED_TEXTURE);
    unregisterTexture(FOLLOWING_TEXTURE);
    this.buffer?.destroy();
    this.following?.destroy();
    this.baked?.destroy();
    this.source.destroy({ children: true });
    this.followingSource.destroy({ children: true });
  }

  get settled(): boolean {
    return this.drawn;
  }

  reading(): RenderTargetsReading {
    const buffer = this.buffer;
    return {
      width: buffer?.width ?? 0,
      height: buffer?.height ?? 0,
      resolution: buffer?.resolution ?? 0,
      rendererResolution: this.renderer.application.renderer.resolution,
      followingResolution: this.following?.resolution ?? 0,
      drawn: this.drawn,
    };
  }
}

/** The drawing the renderer baked, shown beside the buffer. */
class BakedTextureSprite extends Entity {
  setup(): void {
    this.add(new Transform({ position: BAKED_OFFSET }));
    this.add(
      new SpriteComponent({
        texture: BAKED_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

/** The buffer that keeps the canvas texel density, shown beside the others. */
class FollowingTargetSprite extends Entity {
  setup(): void {
    this.add(new Transform({ position: FOLLOWING_OFFSET }));
    this.add(
      new SpriteComponent({
        texture: FOLLOWING_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

/** Sprites showing a buffer, a baked drawing and a following buffer. */
export class RenderTargetsCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: CASE_AT }));
    // The probe registers each texture under the key a sprite reads, so it is
    // added first.
    this.add(new RenderTargetsProbe());
    this.add(
      new SpriteComponent({
        texture: TARGET_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.spawnChild("baked", BakedTextureSprite);
    this.spawnChild("following", FollowingTargetSprite);
  }
}

import { Entity, Transform, Vec2 } from "@yagejs/core";
import { Container, Graphics } from "pixi.js";
import {
  RendererKey,
  SpriteComponent,
  registerTexture,
  unregisterTexture,
} from "@yagejs/renderer";
import type { RenderTargetHandle } from "@yagejs/renderer";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

const TARGET_WIDTH = 128;
const TARGET_HEIGHT = 64;
/** The key the drawn buffer is shown under. */
const TARGET_TEXTURE = "baseline:render-target";

/** What the render-targets case reports. */
export interface RenderTargetsReading extends CaseReading {
  width: number;
  height: number;
  resolution: number;
  rendererResolution: number;
  drawn: boolean;
}

/**
 * Owns an offscreen buffer and draws into it once, so the entity's sprite can
 * show it. The buffer, its source and the registration are freed on destroy.
 */
export class RenderTargetsProbe extends CaseProbe {
  private readonly renderer = this.service(RendererKey);
  private readonly source = new Container();
  private buffer: RenderTargetHandle | undefined;
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
  }

  onDestroy(): void {
    unregisterTexture(TARGET_TEXTURE);
    this.buffer?.destroy();
    this.source.destroy({ children: true });
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
      drawn: this.drawn,
    };
  }
}

/** A sprite showing a buffer the case drew into. */
export class RenderTargetsCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(480, 300) }));
    // The probe registers the buffer's texture under the key the sprite reads,
    // so it is added first.
    this.add(new RenderTargetsProbe());
    this.add(
      new SpriteComponent({
        texture: TARGET_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

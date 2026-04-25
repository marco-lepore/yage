import { AssetHandle, Component, serializable } from "@yagejs/core";
import { AnimatedSprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
import type { TextureInput, TextureResource } from "./public-types.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import { EffectStack } from "./effects/EffectStack.js";
import { makeEntityProcessHost } from "./effects/hosts/EntityProcessHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";

/** Options for creating an AnimatedSpriteComponent. */
export interface AnimatedSpriteComponentOptions {
  /** Serializable frame source (sprite strip or atlas). */
  source?: FrameSource;
  /** Raw texture array (not serializable, backward compat). */
  textures?: readonly TextureInput[];
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Serializable snapshot of an AnimatedSpriteComponent. */
export interface AnimatedSpriteData {
  source: FrameSource;
  layer: string;
}

/** Component that displays a PixiJS AnimatedSprite. */
@serializable
export class AnimatedSpriteComponent extends Component {
  readonly animatedSprite: AnimatedSprite;
  readonly layerName: string;
  private readonly _source: FrameSource | null;
  private _effects?: EffectStack;

  constructor(options: AnimatedSpriteComponentOptions) {
    super();
    this.layerName = options.layer ?? "default";

    if (options.source) {
      this._source = options.source;
      this.animatedSprite = new AnimatedSprite(resolveFrames(options.source));
    } else if (options.textures) {
      this._source = null;
      const textures: TextureResource[] = options.textures.some(
        (texture) =>
          typeof texture === "string" || texture instanceof AssetHandle,
      )
        ? options.textures.map(resolveTextureInput)
        : (options.textures as TextureResource[]);
      this.animatedSprite = new AnimatedSprite(textures);
    } else {
      throw new Error(
        "AnimatedSpriteComponent requires either `source` or `textures`.",
      );
    }
  }

  /** Play the animation. */
  play(options?: {
    speed?: number;
    loop?: boolean;
    onComplete?: () => void;
  }): void {
    if (options?.speed !== undefined) {
      this.animatedSprite.animationSpeed = options.speed;
    }
    if (options?.loop !== undefined) {
      this.animatedSprite.loop = options.loop;
    }
    if (options?.onComplete) {
      this.animatedSprite.onComplete = options.onComplete;
    }
    this.animatedSprite.play();
  }

  /** Stop the animation. */
  stop(): void {
    this.animatedSprite.stop();
  }

  /** Whether the animation is currently playing. */
  get isPlaying(): boolean {
    return this.animatedSprite.playing;
  }

  serialize(): AnimatedSpriteData | null {
    if (!this._source) {
      console.warn(
        `AnimatedSpriteComponent on "${this.entity?.name}": created with raw textures. ` +
          `Use { source } for save/load support.`,
      );
      return null;
    }
    return { source: this._source, layer: this.layerName };
  }

  static fromSnapshot(data: AnimatedSpriteData): AnimatedSpriteComponent {
    return new AnimatedSpriteComponent(data);
  }

  /** Attach a visual effect to this animated sprite. See {@link SpriteComponent.addEffect}. */
  addEffect<H extends EffectHandle>(factory: EffectFactory<H>): H {
    this._effects ??= new EffectStack(
      this.animatedSprite,
      makeEntityProcessHost(this.entity),
      "component",
    );
    return this._effects.add(factory);
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.animatedSprite);
  }

  onDestroy(): void {
    this._effects?.destroy();
    this.animatedSprite.removeFromParent();
    this.animatedSprite.destroy();
  }
}

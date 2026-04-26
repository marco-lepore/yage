import { AssetHandle, Component, serializable } from "@yagejs/core";
import { AnimatedSprite } from "pixi.js";
import { resolveTextureInput } from "./assets.js";
import type { TextureInput, TextureResource } from "./public-types.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import { EffectStack } from "./effects/EffectStack.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { makeEntityProcessHost } from "./effects/hosts/EntityProcessHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";

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
  effects?: EffectStackSnapshot;
  mask?: MaskSnapshot;
}

/** Component that displays a PixiJS AnimatedSprite. */
@serializable
export class AnimatedSpriteComponent extends Component {
  readonly animatedSprite: AnimatedSprite;
  readonly layerName: string;
  private readonly _source: FrameSource | null;
  private _effects?: EffectStack;
  private _mask: MaskHandle | undefined;

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
    const data: AnimatedSpriteData = {
      source: this._source,
      layer: this.layerName,
    };
    const effects = this._effects?.serialize();
    if (effects && effects.entries.length > 0) data.effects = effects;
    const mask = this._mask?.serialize();
    if (mask) data.mask = mask;
    return data;
  }

  static fromSnapshot(data: AnimatedSpriteData): AnimatedSpriteComponent {
    return new AnimatedSpriteComponent(data);
  }

  /** Restore effects and mask after the animated sprite is parented. */
  afterRestore(data: AnimatedSpriteData): void {
    if (data.effects) {
      this._effects ??= new EffectStack(
        this.animatedSprite,
        makeEntityProcessHost(this.entity),
        "component",
      );
      this._effects.restoreFrom(data.effects);
    }
    if (data.mask) {
      this._mask?.remove();
      const handle = restoreMask(this.animatedSprite, data.mask);
      if (handle) this._mask = handle;
    }
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

  /** Attach a mask to this animated sprite. See {@link SpriteComponent.setMask}. */
  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.animatedSprite, factory);
    return this._mask;
  }

  /** Detach and destroy the current mask, if any. */
  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /**
   * The currently attached mask handle, if any. Useful after save/load to
   * recover a handle whose caller-side reference went stale.
   */
  get mask(): MaskHandle | undefined {
    return this._mask;
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.animatedSprite);
  }

  onDestroy(): void {
    this._effects?.destroy();
    this._mask?.remove();
    this.animatedSprite.removeFromParent();
    this.animatedSprite.destroy();
  }
}

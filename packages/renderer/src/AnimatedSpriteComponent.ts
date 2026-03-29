import { Component } from "@yage/core";
import { AnimatedSprite } from "pixi.js";
import type { Texture } from "pixi.js";
import { RenderLayerManagerKey } from "./types.js";

/** Options for creating an AnimatedSpriteComponent. */
export interface AnimatedSpriteComponentOptions {
  /** Array of textures for the animation frames. */
  textures: Texture[];
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Component that displays a PixiJS AnimatedSprite. */
export class AnimatedSpriteComponent extends Component {
  readonly animatedSprite: AnimatedSprite;
  readonly layerName: string;

  constructor(options: AnimatedSpriteComponentOptions) {
    super();
    this.animatedSprite = new AnimatedSprite(options.textures);
    this.layerName = options.layer ?? "default";
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

  /**
   * Serialise to a plain object for save/load.
   * Returns only the layer name — textures are not serializable.
   * Entities must reconstruct this component in their afterRestore().
   */
  serialize(): { layer: string } {
    return { layer: this.layerName };
  }

  onAdd(): void {
    const layers = this.use(RenderLayerManagerKey);
    const layer = layers.get(this.layerName);
    layer.container.addChild(this.animatedSprite);
  }

  onDestroy(): void {
    this.animatedSprite.removeFromParent();
    this.animatedSprite.destroy();
  }
}

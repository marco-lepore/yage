import type { Vec2Like } from "@yagejs/core";
import { AnimatedSprite, Ticker } from "pixi.js";
import type { DisplayAnimatedSprite } from "./public-types.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import {
  VisualComponent,
  type VisualComponentOptions,
} from "./VisualComponent.js";

let animationTicker: Ticker | undefined;

/** Options for creating an AnimatedSpriteComponent. */
export interface AnimatedSpriteComponentOptions extends VisualComponentOptions {
  /** Frame source (sheet grid or atlas animation). */
  source: FrameSource;
  /**
   * Default sprite anchor (0,0 = top-left, 0.5,0.5 = center, 1,1 = bottom-right).
   * Per-{@link AnimationController} `AnimationDef.anchor` overrides this when set.
   */
  anchor?: Vec2Like;
}

/** Component that displays a PixiJS AnimatedSprite. */
export class AnimatedSpriteComponent extends VisualComponent {
  readonly animatedSprite: DisplayAnimatedSprite;

  constructor(options: AnimatedSpriteComponentOptions) {
    super(options.layer);
    this.animatedSprite = new AnimatedSprite(
      resolveFrames(options.source),
      false,
    );

    if (options.anchor) {
      this.animatedSprite.anchor.set(options.anchor.x, options.anchor.y);
    }
    this.applyVisualOptions(options);
  }

  /** The underlying Pixi display object. */
  get renderObject(): DisplayAnimatedSprite {
    return this.animatedSprite;
  }

  /** Resumes from the current frame; `fromStart: true` restarts at frame 0. */
  play(options?: {
    speed?: number;
    loop?: boolean;
    onComplete?: () => void;
    fromStart?: boolean;
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
    if (options?.fromStart) {
      this.animatedSprite.gotoAndPlay(0);
    } else {
      this.animatedSprite.play();
    }
  }

  /** Stop the animation. */
  stop(): void {
    this.animatedSprite.stop();
  }

  /** Stop playback and hold `index` as a static pose. */
  gotoFrame(index: number): void {
    const last = this.animatedSprite.textures.length - 1;
    if (index < 0 || index > last) {
      throw new Error(
        `AnimatedSpriteComponent.gotoFrame: frame ${index} is out of range (0-${last})`,
      );
    }
    this.animatedSprite.gotoAndStop(index);
  }

  /** Current frame index of the underlying AnimatedSprite. */
  get frame(): number {
    return this.animatedSprite.currentFrame;
  }

  /** Whether the animation is currently playing. */
  get isPlaying(): boolean {
    return this.animatedSprite.playing;
  }

  /** Advance playback using engine-scaled time. */
  update(dt: number): void {
    if (dt === 0) return;
    const ticker = (animationTicker ??= new Ticker());
    ticker.deltaTime = dt * 1000 * Ticker.targetFPMS;
    this.animatedSprite.update(ticker);
  }
}

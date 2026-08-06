import { serializable } from "@yagejs/core";
import type { Vec2Like } from "@yagejs/core";
import { AnimatedSprite, Ticker } from "pixi.js";
import type { DisplayAnimatedSprite } from "./public-types.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import {
  VisualComponent,
  type VisualComponentData,
  type VisualComponentOptions,
} from "./VisualComponent.js";

let animationTicker: Ticker | undefined;

/** Options for creating an AnimatedSpriteComponent. */
export interface AnimatedSpriteComponentOptions extends VisualComponentOptions {
  /** Serializable frame source (sheet grid or atlas animation). */
  source: FrameSource;
  /**
   * Default sprite anchor (0,0 = top-left, 0.5,0.5 = center, 1,1 = bottom-right).
   * Per-{@link AnimationController} `AnimationDef.anchor` overrides this when set.
   */
  anchor?: Vec2Like;
}

/** Serializable snapshot of an AnimatedSpriteComponent. */
export interface AnimatedSpriteData extends VisualComponentData {
  source: FrameSource;
  /** Persisted component-level anchor; an active animation's anchor may still override at runtime. */
  anchor?: { x: number; y: number };
}

/** Component that displays a PixiJS AnimatedSprite. */
@serializable
export class AnimatedSpriteComponent extends VisualComponent {
  readonly animatedSprite: DisplayAnimatedSprite;
  private readonly _source: FrameSource;

  constructor(options: AnimatedSpriteComponentOptions) {
    super(options.layer);
    this._source = options.source;
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

  serialize(): AnimatedSpriteData {
    return {
      ...this.serializeVisual(),
      source: this._source,
      anchor: { x: this.animatedSprite.anchor.x, y: this.animatedSprite.anchor.y },
    };
  }

  static fromSnapshot(data: AnimatedSpriteData): AnimatedSpriteComponent {
    return new AnimatedSpriteComponent(data);
  }

  /** Restore effects and mask after the animated sprite is parented. */
  afterRestore(data: AnimatedSpriteData): void {
    this.restoreVisual(data);
  }
}

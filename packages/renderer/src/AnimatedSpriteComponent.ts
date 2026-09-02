import type { Vec2Like } from "@yagejs/core";
import { AnimatedSprite, Ticker } from "pixi.js";
import type { DisplayAnimatedSprite } from "./public-types.js";
import { resolveFrames } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import { runAttributed } from "./internal/attribution.js";
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

  private readonly _frameListeners: ((frame: number) => void)[] = [];

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

  /**
   * Resumes from the current frame; `fromStart: true` restarts at frame 0.
   *
   * `speed` and `loop` are sticky — the next play keeps whatever this one set.
   * `onComplete` is not: a play owns its completion callback, so a play
   * without one clears the callback the previous play installed.
   */
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
    const onComplete = options?.onComplete;
    if (onComplete) {
      this.animatedSprite.onComplete = () =>
        runAttributed(this, "Animation onComplete", onComplete);
    } else {
      delete this.animatedSprite.onComplete;
    }
    if (options?.fromStart) {
      this.animatedSprite.gotoAndPlay(0);
    } else {
      this.animatedSprite.play();
    }
  }

  /**
   * Subscribe to frame changes on the underlying sprite. Returns an
   * unsubscribe function, so `this.addCleanup(sprite.onFrameChange(fn))`
   * drops the listener with the subscribing component.
   *
   * Pixi delivers a frame change on `play`, on a frame advance, and on the
   * frame reset an animation switch performs, so a listener sees controller
   * switches too. Assigning `animatedSprite.onFrameChange` directly replaces
   * the dispatcher this installs and silences every subscriber.
   */
  onFrameChange(listener: (frame: number) => void): () => void {
    if (this._frameListeners.length === 0) {
      this.animatedSprite.onFrameChange = (frame: number) => {
        // Copy: a listener that unsubscribes itself mid-dispatch would
        // otherwise shift the next one past the iterator.
        for (const l of [...this._frameListeners]) {
          runAttributed(this, "Animation frame listener", () => l(frame));
        }
      };
    }
    this._frameListeners.push(listener);
    return () => {
      const idx = this._frameListeners.indexOf(listener);
      if (idx !== -1) this._frameListeners.splice(idx, 1);
    };
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

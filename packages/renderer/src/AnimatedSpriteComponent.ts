import { MaterialVisualComponent } from "./materials/MaterialVisualComponent.js";
import type { ResolvedSpriteSource } from "./materials/ResolvedSpriteSource.js";
import type { SpriteMaterial } from "./materials.js";
import type { Vec2Like } from "@yagejs/core";
import { AnimatedSprite, Ticker } from "pixi.js";
import type { DisplayAnimatedSprite } from "./public-types.js";
import { resolveSpriteSource } from "./spritesheet.js";
import type { FrameSource } from "./spritesheet.js";
import { runAttributed } from "./internal/attribution.js";
import { assertFiniteNumber } from "./internal/validate.js";
import { type VisualComponentOptions } from "./VisualComponent.js";

let animationTicker: Ticker | undefined;

/** Options for creating an AnimatedSpriteComponent. */
export interface AnimatedSpriteComponentOptions extends VisualComponentOptions {
  /** Frame source (sheet grid or atlas animation). */
  source: FrameSource;
  /**
   * Reusable shading settings; companion maps belong to `source`. Omit to
   * follow the scene: lit on a world layer of a `surfaceLighting()` scene,
   * ordinary drawing everywhere else.
   */
  material?: SpriteMaterial;
  /**
   * Default sprite anchor (0,0 = top-left, 0.5,0.5 = center, 1,1 = bottom-right).
   * Per-{@link AnimationController} `AnimationDef.anchor` overrides this when set.
   */
  anchor?: Vec2Like;
  /**
   * Playback rate applied at construction: frames advanced per tick at 60 fps.
   * Default `1`. `play({ speed })` and the
   * {@link AnimatedSpriteComponent.speed} property retime the clip afterwards,
   * and an {@link AnimationController} writes the rate at every animation
   * switch.
   */
  speed?: number;
}

/** Component that displays a PixiJS AnimatedSprite. */
export class AnimatedSpriteComponent extends MaterialVisualComponent {
  private source: ResolvedSpriteSource;
  private readonly _animatedSprite: DisplayAnimatedSprite;

  private readonly _frameListeners: ((frame: number) => void)[] = [];

  constructor(options: AnimatedSpriteComponentOptions) {
    super(options.layer);
    this.source = resolveSpriteSource(options.source);
    this._animatedSprite = new AnimatedSprite(this.source.frames, false);
    this.initializeMaterial(this.source.maps, options.material);

    if (options.anchor) {
      this._animatedSprite.anchor.set(options.anchor.x, options.anchor.y);
    }
    if (options.speed !== undefined) {
      assertFiniteNumber(
        "AnimatedSpriteComponent.constructor",
        "speed",
        options.speed,
      );
      this._animatedSprite.animationSpeed = options.speed;
    }
    this.applyVisualOptions(options);
  }

  /**
   * The Pixi object this component draws with. Change the visual through the
   * component; see `VisualComponent.renderObject`.
   */
  get renderObject(): DisplayAnimatedSprite {
    return this._animatedSprite;
  }

  /**
   * Replace frames and maps together, stop at frame zero, and clear the
   * completion callback. Omitted maps are cleared.
   */
  setSource(source: FrameSource): void {
    this.binding.assertMaps(source.maps);
    const resolved = resolveSpriteSource(source);
    this._installSource(resolved);
    resolved.release();
  }

  /** @internal Throw if this sprite's scene cannot draw a source's maps. */
  _assertMaps(source: ResolvedSpriteSource): void {
    this.binding.assertMaps(source.maps.refs);
  }

  /** @internal Controllers use the same installation path with their retained source. */
  _installSource(source: ResolvedSpriteSource): void {
    this.binding.setMaps(source.maps, this.layerName);
    source.retain();
    const previous = this.source;
    this.source = source;
    delete this._animatedSprite.onComplete;
    this._animatedSprite.textures = source.frames;
    previous.release();
  }

  override onDestroy(): void {
    super.onDestroy();
    this.source.release();
  }

  override inspectRender() {
    const facet = super.inspectRender();
    return this.binding.material ? { ...facet, frameIndex: this.frame } : facet;
  }

  /**
   * Resumes from the current frame; `fromStart: true` restarts at frame 0.
   *
   * `speed` and `loop` are sticky — the next play keeps whatever this one set.
   * `onComplete` is not: a play owns its completion callback, so a play
   * without one clears the callback the previous play installed.
   *
   * Use the {@link AnimatedSpriteComponent.speed} property to retime a clip
   * that is already running.
   */
  play(options?: {
    speed?: number;
    loop?: boolean;
    onComplete?: () => void;
    fromStart?: boolean;
  }): void {
    if (options?.speed !== undefined) {
      assertFiniteNumber(
        "AnimatedSpriteComponent.play",
        "speed",
        options.speed,
      );
      this._animatedSprite.animationSpeed = options.speed;
    }
    if (options?.loop !== undefined) {
      this._animatedSprite.loop = options.loop;
    }
    const onComplete = options?.onComplete;
    if (onComplete) {
      this._animatedSprite.onComplete = () =>
        runAttributed(this, "Animation onComplete", onComplete);
    } else {
      delete this._animatedSprite.onComplete;
    }
    if (options?.fromStart) {
      this._animatedSprite.gotoAndPlay(0);
    } else {
      this._animatedSprite.play();
    }
  }

  /**
   * Subscribe to frame changes on the underlying sprite. Returns an
   * unsubscribe function, so `this.addCleanup(sprite.onFrameChange(fn))`
   * drops the listener with the subscribing component.
   *
   * Pixi delivers a frame change on `play`, on a frame advance, and on the
   * frame reset an animation switch performs, so a listener sees controller
   * switches too. Assigning `renderObject.onFrameChange` directly replaces
   * the dispatcher this installs and silences every subscriber.
   */
  onFrameChange(listener: (frame: number) => void): () => void {
    if (this._frameListeners.length === 0) {
      this._animatedSprite.onFrameChange = (frame: number) => {
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
    this._animatedSprite.stop();
  }

  /** Stop playback and hold `index` as a static pose. */
  gotoFrame(index: number): void {
    const last = this._animatedSprite.textures.length - 1;
    if (index < 0 || index > last) {
      throw new Error(
        `AnimatedSpriteComponent.gotoFrame: frame ${index} is out of range (0-${last})`,
      );
    }
    this._animatedSprite.gotoAndStop(index);
  }

  /** Current frame index of the underlying AnimatedSprite. */
  get frame(): number {
    return this._animatedSprite.currentFrame;
  }

  /** Whether the animation is currently playing. */
  get isPlaying(): boolean {
    return this._animatedSprite.playing;
  }

  /**
   * Playback rate of the underlying sprite: frames advanced per tick at 60
   * fps, so `0.15` moves on about every seventh tick and `1` on every tick.
   * Defaults to `1`. Writing it retimes the clip that is already running,
   * without restarting it, and reads back the same number `play({ speed })`
   * writes.
   *
   * `0` holds the current frame while {@link isPlaying} stays `true`, and a
   * negative value plays backwards. Scene and entity `timeScale` multiply
   * this. A non-finite value throws.
   *
   * With an {@link AnimationController} on the entity this reads the rate the
   * sprite is actually running at: the animation definition's `speed`, times
   * the controller's `speed`, times the `playOneShot({ speed })` factor. The
   * controller writes it again at its next animation switch and whenever its
   * own `speed` is written. Set `AnimationController.speed` to retime every
   * animation; set this to retime only the clip on screen. Writing this does
   * not retime a running one-shot's lock: the lock keeps the duration computed
   * when the one-shot started, so the clip and the lock can end at different
   * times.
   */
  get speed(): number {
    return this._animatedSprite.animationSpeed;
  }

  set speed(value: number) {
    assertFiniteNumber("AnimatedSpriteComponent.speed", "speed", value);
    this._animatedSprite.animationSpeed = value;
  }

  /** Advance playback using engine-scaled time. */
  update(dt: number): void {
    if (dt === 0) return;
    const ticker = (animationTicker ??= new Ticker());
    ticker.deltaTime = dt * 1000 * Ticker.targetFPMS;
    this._animatedSprite.update(ticker);
  }
}

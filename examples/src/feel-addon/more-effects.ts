import {
  Component,
  Entity,
  KeyframeAnimator,
  ProcessComponent,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  SceneRenderTreeKey,
  TextComponent,
} from "@yagejs/renderer";
import {
  Feel,
  feelCall,
  feelDelay,
  feelKeyframeAnimation,
  feelParallel,
  feelRepeat,
  feelSequence,
  feelSlowMotion,
  feelTargetFreeze,
} from "@yagejs-addons/feel";
import {
  feelBlink,
  feelBounce,
  feelFloatingText,
  feelHitFlash,
  feelImpactRing,
  feelOpacity,
  feelPositionSpring,
  feelRecoil,
  feelRotationSpring,
  feelScalePunch,
  feelScaleSpring,
  feelShockwave,
} from "@yagejs-addons/feel/renderer";
import { FeelDemo, GalleryText } from "./gallery.js";

// ---------------------------------------------------------------------------
// 1  Recoil + springs
// ---------------------------------------------------------------------------

export class PunchDemo extends FeelDemo {
  readonly label = "recoil + springs";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-42, -34, 84, 68, 12).fill({ color: 0xf97316 });
        g.poly([10, -15, 34, 0, 10, 15]).fill({ color: 0xffedd5 });
      }),
    );
    this.add(
      new Feel({
        show: feelSequence(
          feelRecoil({
            target: visual,
            direction: { x: 1, y: 0 },
            distance: 34,
            duration: 0.3,
          }),
          feelParallel(
            feelPositionSpring({
              target: visual,
              offset: { x: 18, y: -24 },
              duration: 0.72,
              oscillations: 2.5,
              decay: 2,
            }),
            feelRotationSpring({
              target: visual,
              radians: 0.55,
              duration: 0.72,
              oscillations: 2.5,
              decay: 2,
            }),
            feelScaleSpring({
              target: visual,
              scale: 1.3,
              duration: 0.72,
              oscillations: 2.5,
              decay: 2,
            }),
          ),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 2  Fade + blink
// ---------------------------------------------------------------------------

export class VisibilityDemo extends FeelDemo {
  readonly label = "fade + blink";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.ellipse(0, 0, 54, 34).fill({ color: 0x22d3ee });
        g.circle(0, 0, 17).fill({ color: 0x164e63 });
        g.circle(0, 0, 7).fill({ color: 0xecfeff });
      }),
    );
    this.add(
      new Feel({
        show: feelSequence(
          feelOpacity({ target: visual, alpha: 0.08, duration: 0.55 }),
          feelBlink({ target: visual, duration: 0.48, interval: 0.06 }),
          feelHitFlash(visual.fx, { color: 0xffffff, duration: 0.16 }),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 3  Sequence + repeat
// ---------------------------------------------------------------------------

export class CompositionDemo extends FeelDemo {
  readonly label = "sequence + repeat";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        const colors = [0xf472b6, 0xc084fc, 0x818cf8];
        for (let index = 0; index < 3; index++) {
          g.circle((index - 1) * 30, 0, 13).fill({
            color: colors[index] ?? 0xffffff,
          });
        }
      }),
    );
    this.add(
      new Feel({
        show: feelSequence(
          feelScalePunch({ target: visual, scale: 1.35, duration: 0.3 }),
          feelDelay(0.12),
          feelRepeat(
            feelBounce({ target: visual, distance: 22, duration: 0.2 }),
            3,
            0.04,
          ),
          feelFloatingText({
            text: "DONE",
            style: { fill: 0xf0abfc },
            duration: 0.6,
            travel: { x: 0, y: -28 },
          }),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 4  Target time
// ---------------------------------------------------------------------------

/** Slides left and right around its starting position, on its entity's clock. */
class PingPongMotion extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly amplitude: number;
  private origin = Vec2.ZERO;
  private elapsed = 0;

  constructor(amplitude: number) {
    super();
    this.amplitude = amplitude;
  }

  onAdd(): void {
    this.origin = this.transform.position;
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setPosition(
      this.origin.x + Math.sin(this.elapsed * 4) * this.amplitude,
      this.origin.y,
    );
  }
}

/** A ball sliding along one rail of the target-time track. */
class TrackBall extends Entity {
  setup(params: {
    y: number;
    radius: number;
    color: number;
    coreRadius: number;
    coreColor: number;
  }): void {
    this.add(new Transform({ position: new Vec2(0, params.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, params.radius).fill({ color: params.color });
        g.circle(0, 0, params.coreRadius).fill({ color: params.coreColor });
      }),
    );
    this.add(new PingPongMotion(78));
  }
}

/**
 * Two balls on a track. The cue slows the green ball and then freezes it;
 * the blue ball keeps scene time for comparison.
 */
export class SlowMotionDemo extends FeelDemo {
  readonly label = "target time";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    this.add(
      new GraphicsComponent().draw((g) => {
        for (const y of [-18, 18]) {
          g.moveTo(-88, y).lineTo(88, y).stroke({ color: 0x475569, width: 3 });
          g.circle(-88, y, 4).fill({ color: 0x64748b });
          g.circle(88, y, 4).fill({ color: 0x64748b });
        }
      }),
    );
    const slowed = this.spawnChild("slowed-ball", TrackBall, {
      y: -18,
      radius: 18,
      color: 0x4ade80,
      coreRadius: 7,
      coreColor: 0xf0fdf4,
    });
    this.spawnChild("scene-time-ball", TrackBall, {
      y: 18,
      radius: 12,
      color: 0x38bdf8,
      coreRadius: 4,
      coreColor: 0xe0f2fe,
    });
    this.add(
      new Feel({
        show: feelParallel(
          feelSequence(
            feelSlowMotion({ target: slowed, scale: 0.12, duration: 0.6 }),
            feelDelay(
              0.65,
              feelTargetFreeze({ target: slowed, duration: 0.25 }),
            ),
          ),
          feelFloatingText({
            text: "GREEN: 0.12× → FREEZE",
            style: { fill: 0x86efac },
            duration: 0.9,
            // Starts on the lower rail, 19 px below the demo's centre. The
            // default offset would start it 16 px above the centre.
            offset: { x: 0, y: 19 },
            travel: { x: 0, y: -26 },
          }),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 5  Animation + callback
// ---------------------------------------------------------------------------

/** Counts the cue's callback and shows the count. */
class CallbackCounter extends Component {
  private readonly text: TextComponent;
  private _calls = 0;

  constructor(text: TextComponent) {
    super();
    this.text = text;
  }

  get calls(): number {
    return this._calls;
  }

  count(): void {
    this._calls += 1;
    this.text.setText(`CALLBACKS: ${this._calls}`);
  }
}

/**
 * A star that spins through a keyframe animation, then a callback that
 * counts the plays. The star is a child entity, so the count below it
 * stays upright while it spins.
 */
export class AnimationDemo extends FeelDemo {
  readonly label = "animation + callback";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const star = this.spawnChild("star");
    const starTransform = star.add(new Transform());
    star.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -38, 22, 24, -34, -14, 34, -14, -22, 24]).fill({
          color: 0xfacc15,
        });
      }),
    );
    const countText = this.spawnChild("callback-count", GalleryText, {
      position: new Vec2(0, 55),
      text: "CALLBACKS: 0",
      fontSize: 12,
      fill: 0xfde68a,
    }).get(TextComponent);

    this.add(new ProcessComponent());
    const animator = this.add(
      new KeyframeAnimator<"spin">({
        spin: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 0.35, data: Math.PI },
            { time: 0.7, data: Math.PI * 2 },
          ],
          setter: (rotation) => starTransform.setRotation(rotation as number),
        },
      }),
    );
    const counter = this.add(new CallbackCounter(countText));
    this.add(
      new Feel({
        show: feelSequence(
          feelKeyframeAnimation("spin", animator),
          feelDelay(0.7),
          feelCall(() => counter.count(), "showcase callback"),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 6  Scene shockwave
// ---------------------------------------------------------------------------

export class ShockwaveDemo extends FeelDemo {
  readonly label = "scene shockwave";

  setup(params: { position: Vec2 }): void {
    const { position } = params;
    this.add(new Transform({ position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 42).fill({ color: 0xe11d48 });
        g.circle(0, 0, 24).stroke({ color: 0xfda4af, width: 6 });
        g.circle(0, 0, 8).fill({ color: 0xfff1f2 });
      }),
    );
    const sceneEffects = this.scene.use(SceneRenderTreeKey).fx;
    this.add(
      new Feel({
        show: feelParallel(
          feelShockwave(sceneEffects, {
            center: position,
            amplitude: 22,
            wavelength: 100,
            radius: 190,
            duration: 0.85,
          }),
          feelImpactRing({
            radius: 24,
            expand: 58,
            color: 0xfb7185,
            duration: 0.55,
          }),
          feelScalePunch({ target: visual, scale: 1.35, duration: 0.42 }),
          feelHitFlash(visual.fx, { color: 0xffffff, duration: 0.16 }),
        ),
      }),
    );
  }
}

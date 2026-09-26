import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  type ProcessSlot,
  type Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  SpriteComponent,
  registerTexture,
  unregisterTexture,
  type CameraEntity,
  type TextureResource,
  type VisualTransformModifierHandle,
} from "@yagejs/renderer";
import {
  Feel,
  defineFeelEffect,
  feelHitStop,
  feelParallel,
  type FeelNode,
} from "@yagejs-addons/feel";
import {
  feelAfterimage,
  feelBounce,
  feelCameraRotation,
  feelCameraShake,
  feelCameraZoom,
  feelColorize,
  feelDamageNumber,
  feelFlightLines,
  feelFloatingText,
  feelGlow,
  feelHitFlash,
  feelImpactRing,
  feelMotionTrail,
  feelOutline,
  feelRotationShake,
  feelScalePunch,
  feelScaleShake,
  feelSquash,
  feelTransformShake,
} from "@yagejs-addons/feel/renderer";
import { FeelDemo, type ShowcaseDemo } from "./gallery.js";

const DASH_DURATION = 0.48;
const DASH_DISTANCE = 660;
const DASH_ARC_HEIGHT = 62;
const DASH_TEXTURE = "feel-addon:dash-runner";

// ---------------------------------------------------------------------------
// 1  Impact
// ---------------------------------------------------------------------------

/** The impact demo's damage roll: every third hit is a 42-point critical. */
class ImpactHits extends Component {
  private readonly feel = this.sibling(Feel);
  private hits = 0;
  private _damage = 18;
  private _critical = false;

  get damage(): number {
    return this._damage;
  }

  get critical(): boolean {
    return this._critical;
  }

  /** Roll the next hit, then play the impact cue that shows it. */
  strike(): void {
    this.hits += 1;
    this._critical = this.hits % 3 === 0;
    this._damage = this._critical ? 42 : 14 + (this.hits % 6) * 2;
    this.feel.play("impact");
  }
}

export class ImpactDemo extends Entity implements ShowcaseDemo {
  readonly label = "impact";

  setup(params: { position: Vec2; camera: CameraEntity }): void {
    const { camera } = params;
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -48, 42, -24, 42, 24, 0, 48, -42, 24, -42, -24]).fill({
          color: 0xef4444,
        });
        g.circle(0, 0, 18).fill({ color: 0x7f1d1d });
        g.circle(0, 0, 7).fill({ color: 0xfef2f2 });
      }),
    );
    const hits = this.add(new ImpactHits());
    this.add(
      new Feel({
        impact: feelParallel(
          feelTransformShake({ target: visual, amplitude: 7, duration: 0.24 }),
          feelRotationShake({ target: visual, radians: 0.12, duration: 0.22 }),
          feelScalePunch({ target: visual, scale: 1.22, duration: 0.25 }),
          feelHitFlash(visual.fx, { color: 0xffffff, duration: 0.14 }),
          feelDamageNumber({
            value: () => hits.damage,
            critical: () => hits.critical,
            criticalColor: 0xffd54a,
          }),
          feelImpactRing({ color: 0xffd54a, spikes: 10 }),
          feelCameraShake({ camera, intensity: 7, duration: 0.24 }),
          feelCameraZoom({ camera, scale: 1.045, duration: 0.28 }),
          feelCameraRotation({ camera, radians: 0.025, duration: 0.28 }),
          feelHitStop({ duration: 0.045 }),
        ),
      }),
    );
  }

  play(): void {
    this.get(ImpactHits).strike();
  }
}

// ---------------------------------------------------------------------------
// 2  Curved trail + afterimages
// ---------------------------------------------------------------------------

/** Draws the runner's texture and keeps it registered while the runner exists. */
class DashRunnerTexture extends Component {
  private texture: TextureResource | undefined;

  onAdd(): void {
    this.texture = this.use(RendererKey).createTexture((g) => {
      g.poly([60, 18, 10, 0, 22, 18, 10, 36]).fill({ color: 0x38bdf8 });
      g.circle(32, 18, 7).fill({ color: 0xe0f2fe });
    });
    registerTexture(DASH_TEXTURE, this.texture);
  }

  onDestroy(): void {
    unregisterTexture(DASH_TEXTURE);
    this.texture?.destroy();
  }
}

/** Moves the runner along a curved arc, facing its direction of travel. */
class DashMotion extends Component {
  private readonly transform = this.sibling(Transform);
  private readonly processes = this.sibling(ProcessComponent);
  private readonly feel = this.sibling(Feel);
  private readonly start: Vec2;
  /** Running while the runner is on its way along the arc. */
  private run!: ProcessSlot;

  constructor(start: Vec2) {
    super();
    this.start = start;
  }

  onAdd(): void {
    this.run = this.processes.slot({
      duration: DASH_DURATION,
      update: () => this.setPose(this.run.ratio),
    });
  }

  /** Start a dash from the left end of the arc, with its trail cue. */
  dash(): void {
    this.feel.stop("dash");
    this.setPose(0);
    this.run.restart();
    this.feel.play("dash");
  }

  private setPose(progress: number): void {
    const angle = progress * Math.PI;
    this.transform.setPosition(
      this.start.x + DASH_DISTANCE * progress,
      this.start.y - Math.sin(angle) * DASH_ARC_HEIGHT,
    );
    this.transform.setRotation(
      Math.atan2(-Math.cos(angle) * Math.PI * DASH_ARC_HEIGHT, DASH_DISTANCE),
    );
  }
}

export class DashDemo extends Entity implements ShowcaseDemo {
  readonly label = "curved dash + afterimages";

  setup(params: { start: Vec2 }): void {
    const transform = this.add(new Transform({ position: params.start }));
    this.add(new DashRunnerTexture());
    const visual = this.add(
      new SpriteComponent({
        texture: DASH_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.add(new ProcessComponent());
    this.add(
      new Feel({
        dash: feelParallel(
          feelFlightLines({
            direction: () => ({
              x: Math.cos(transform.rotation),
              y: Math.sin(transform.rotation),
            }),
            count: 14,
            length: [24, 62],
            spread: 110,
            depth: 120,
            travel: 46,
            color: 0x7dd3fc,
            duration: 0.42,
          }),
          feelMotionTrail({
            duration: DASH_DURATION,
            lifetime: 0.24,
            width: 9,
            minDistance: 6,
            color: 0x38bdf8,
            alpha: 0.78,
          }),
          feelAfterimage({
            target: visual,
            count: 5,
            interval: 0.065,
            lifetime: 0.28,
            tint: 0xa855f7,
            alpha: 0.62,
            endScale: 0.92,
          }),
          feelSquash({
            target: visual,
            axis: "x",
            amount: 0.28,
            duration: 0.3,
          }),
        ),
      }),
    );
    this.add(new DashMotion(params.start));
  }

  play(): void {
    this.get(DashMotion).dash();
  }
}

// ---------------------------------------------------------------------------
// 3  Outline + glow
// ---------------------------------------------------------------------------

export class HighlightDemo extends FeelDemo {
  readonly label = "highlight";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -52, 42, 0, 0, 52, -42, 0]).fill({ color: 0xa78bfa });
        g.poly([0, -34, 25, 0, 0, 34, -25, 0]).fill({ color: 0xddd6fe });
      }),
    );
    this.add(
      new Feel({
        show: feelParallel(
          feelOutline({
            target: visual,
            color: 0xffffff,
            thickness: 5,
            duration: 0.75,
          }),
          feelGlow({
            target: visual,
            color: 0xc4b5fd,
            distance: 16,
            outerStrength: 5,
            duration: 0.75,
          }),
          feelColorize({
            target: visual,
            color: 0xfef08a,
            strength: 0.7,
            duration: 0.55,
          }),
          feelBounce({ target: visual, distance: 18, duration: 0.45 }),
          feelScaleShake({ target: visual, amplitude: 0.08, duration: 0.5 }),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 4  Custom effect
// ---------------------------------------------------------------------------

export class CustomDemo extends FeelDemo {
  readonly label = "custom effect";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 44).fill({ color: 0x10b981 });
        g.circle(0, 0, 27).stroke({ color: 0xa7f3d0, width: 6 });
        g.circle(0, 0, 8).fill({ color: 0xecfdf5 });
      }),
    );
    this.add(
      new Feel({
        show: feelParallel(
          orbitAndPulse(visual),
          feelFloatingText({
            text: "defineFeelEffect",
            style: { fill: 0xa7f3d0 },
            duration: 0.8,
            sway: 8,
          }),
        ),
      }),
    );
  }
}

/** A game-specific effect: the visual circles its base pose and swells. */
function orbitAndPulse(target: GraphicsComponent): FeelNode {
  return defineFeelEffect(0.85, (context) => {
    let modifier: VisualTransformModifierHandle | undefined;
    return {
      label: "custom orbit and pulse",
      start: () => {
        modifier = target.modifiers.addTransform();
      },
      update: (progress) => {
        const envelope = Math.sin(progress * Math.PI) * context.intensity;
        const angle = progress * Math.PI * 2;
        modifier?.setPosition({
          x: Math.cos(angle) * 28 * envelope,
          y: Math.sin(angle) * 18 * envelope,
        });
        modifier?.setRotation(angle * 0.35 * envelope);
        modifier?.setScale(1 + 0.28 * envelope);
      },
      finish: () => modifier?.remove(),
    };
  });
}

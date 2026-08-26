/**
 * Feel addon showcase. Two scenes group related cues into readable pages and
 * use the scene transition API for page navigation.
 */

import {
  Component,
  Engine,
  KeyframeAnimator,
  ProcessComponent,
  Scene,
  SceneManagerKey,
  Transform,
  Vec2,
  type Entity,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererKey,
  RendererPlugin,
  SceneRenderTreeKey,
  SpriteComponent,
  TextComponent,
  registerTexture,
  slidePush,
  unregisterTexture,
  type TextureResource,
  type VisualTransformModifierHandle,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  Feel,
  defineFeelEffect,
  feelCall,
  feelDelay,
  feelHitStop,
  feelKeyframeAnimation,
  feelParallel,
  feelRepeat,
  feelSequence,
  feelSlowMotion,
  feelTargetFreeze,
  type FeelNode,
} from "@yagejs-addons/feel";
import {
  feelAfterimage,
  feelBlink,
  feelBounce,
  feelCameraRotation,
  feelCameraShake,
  feelCameraZoom,
  feelColorize,
  feelDamageNumber,
  feelFlightLines,
  feelGlow,
  feelHitFlash,
  feelImpactRing,
  feelMotionTrail,
  feelOpacity,
  feelOutline,
  feelPositionPunch,
  feelRecoil,
  feelRotationPunch,
  feelRotationShake,
  feelScalePunch,
  feelScaleShake,
  feelSquash,
  feelShockwave,
  feelTransformShake,
  feelFloatingText,
} from "@yagejs-addons/feel/renderer";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 900;
const HEIGHT = 560;
const DASH_START = new Vec2(120, 425);
const DASH_DURATION = 0.48;
const DASH_DISTANCE = 660;
const DASH_ARC_HEIGHT = 62;
const DASH_TEXTURE = "feel-addon:dash-runner";
const PAGE_COUNT = 2;
const galleryState = { autoplay: true };

interface ShowcaseCue {
  label: string;
  play(): void;
  update?(dt: number): void;
}

class ShowcaseController extends Component {
  private readonly input = this.service(InputManagerKey);
  private autoplay = galleryState.autoplay;
  private autoplayElapsed = 1.1;
  private autoplayIndex = 0;
  private lastCue = "waiting";

  constructor(
    private readonly page: number,
    private readonly status: TextComponent,
    private readonly cues: readonly ShowcaseCue[],
  ) {
    super();
  }

  update(dt: number): void {
    for (let index = 0; index < this.cues.length; index++) {
      if (this.input.isJustPressed(`cue${index + 1}`)) {
        this.trigger(index, false);
      }
    }
    if (this.input.isJustPressed("autoplay")) {
      this.autoplay = !this.autoplay;
      galleryState.autoplay = this.autoplay;
      this.autoplayElapsed = 0;
      this.renderStatus();
    }

    for (const cue of this.cues) cue.update?.(dt);

    if (!this.autoplay) return;
    this.autoplayElapsed += dt;
    if (this.autoplayElapsed < 1.7) return;
    this.autoplayElapsed = 0;
    this.trigger(this.autoplayIndex, true);
    this.autoplayIndex = (this.autoplayIndex + 1) % this.cues.length;
  }

  private trigger(index: number, fromAutoplay: boolean): void {
    if (!fromAutoplay) this.autoplayElapsed = 0;
    const cue = this.cues[index];
    if (!cue) return;
    cue.play();
    this.lastCue = cue.label;
    this.renderStatus();
  }

  private renderStatus(): void {
    this.status.setText(
      `Page ${this.page + 1}/${PAGE_COUNT}  ·  Autoplay: ${this.autoplay ? "on" : "off"}  ·  Last cue: ${this.lastCue}`,
    );
  }
}

class GalleryNavigation extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly scenes = this.service(SceneManagerKey);
  private armed = false;
  private navigating = false;

  constructor(private readonly page: number) {
    super();
  }

  update(): void {
    if (!this.armed) {
      this.armed = true;
      return;
    }
    if (this.navigating || this.scenes.isTransitioning) return;
    const direction = this.input.isJustPressed("nextPage")
      ? 1
      : this.input.isJustPressed("previousPage")
        ? -1
        : 0;
    if (direction === 0) return;

    this.navigating = true;
    const nextPage = (this.page + direction + PAGE_COUNT) % PAGE_COUNT;
    void this.scenes.replace(createShowcaseScene(nextPage), {
      transition: slidePush({
        duration: 0.45,
        direction: direction > 0 ? "left" : "right",
        reverseOnPop: false,
      }),
    });
  }
}

interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ESSENTIAL_PANELS: readonly PanelRect[] = [
  { x: 40, y: 100, width: 250, height: 190 },
  { x: 325, y: 100, width: 250, height: 190 },
  { x: 610, y: 100, width: 250, height: 190 },
  { x: 40, y: 320, width: 820, height: 190 },
];

const MORE_PANELS: readonly PanelRect[] = [
  { x: 40, y: 100, width: 250, height: 190 },
  { x: 325, y: 100, width: 250, height: 190 },
  { x: 610, y: 100, width: 250, height: 190 },
  { x: 40, y: 320, width: 250, height: 190 },
  { x: 325, y: 320, width: 250, height: 190 },
  { x: 610, y: 320, width: 250, height: 190 },
];

abstract class FeelGalleryScene extends Scene {
  protected installController(
    page: number,
    status: TextComponent,
    cues: readonly ShowcaseCue[],
  ): void {
    const controller = this.spawn("showcase-controller");
    controller.add(new Transform());
    controller.add(new ShowcaseController(page, status, cues));
    controller.add(new GalleryNavigation(page));
  }

  protected drawBackdrop(panels: readonly PanelRect[]): void {
    const backdrop = this.spawn("backdrop");
    backdrop.add(new Transform());
    backdrop.add(
      new GraphicsComponent().draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x0f172a });
        for (let x = 0; x <= WIDTH; x += 40) {
          g.moveTo(x, 0)
            .lineTo(x, HEIGHT)
            .stroke({ color: 0x1e293b, width: 1 });
        }
        for (let y = 0; y <= HEIGHT; y += 40) {
          g.moveTo(0, y).lineTo(WIDTH, y).stroke({ color: 0x1e293b, width: 1 });
        }
        for (const panel of panels) {
          g.roundRect(panel.x, panel.y, panel.width, panel.height, 12).fill({
            color: 0x111827,
            alpha: 0.88,
          });
          g.roundRect(panel.x, panel.y, panel.width, panel.height, 12).stroke({
            color: 0x334155,
            width: 2,
          });
        }
      }),
    );
    this.spawnText(
      "title",
      WIDTH / 2,
      28,
      "COMPOSABLE GAME FEEL",
      22,
      0xf8fafc,
    );
  }

  protected spawnLabel(x: number, y: number, text: string): void {
    this.spawnText(`label:${text}`, x, y, text, 14, 0x94a3b8);
  }

  protected spawnText(
    name: string,
    x: number,
    y: number,
    text: string,
    fontSize: number,
    fill: number,
  ): TextComponent {
    const entity = this.spawn(name);
    entity.add(new Transform({ position: new Vec2(x, y) }));
    return entity.add(
      new TextComponent({
        text,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize,
          fontWeight: "bold",
          fill,
          letterSpacing: 1,
        },
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

class EssentialsScene extends FeelGalleryScene {
  readonly name = "feel-addon-essentials";
  private dashTexture: TextureResource | undefined;

  onEnter(): void {
    const camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.drawBackdrop(ESSENTIAL_PANELS);

    const status = this.spawnText(
      "status",
      WIDTH / 2,
      62,
      `Page 1/2  ·  Autoplay: ${galleryState.autoplay ? "on" : "off"}  ·  Last cue: waiting`,
      15,
      0x94a3b8,
    );

    const impact = this.spawnImpactDemo(camera);
    const dash = this.spawnDashDemo();
    const highlight = this.spawnHighlightDemo();
    const custom = this.spawnCustomDemo();

    const dashTransform = dash.entity.get(Transform);
    let dashElapsed = DASH_DURATION;
    const setDashPose = (progress: number): void => {
      const angle = progress * Math.PI;
      dashTransform.setPosition(
        DASH_START.x + DASH_DISTANCE * progress,
        DASH_START.y - Math.sin(angle) * DASH_ARC_HEIGHT,
      );
      dashTransform.setRotation(
        Math.atan2(-Math.cos(angle) * Math.PI * DASH_ARC_HEIGHT, DASH_DISTANCE),
      );
    };
    this.installController(0, status, [
      {
        label: "impact",
        play: () => {
          impact.setValues();
          impact.feel.play("impact");
        },
      },
      {
        label: "curved dash + afterimages",
        play: () => {
          dash.feel.stop("dash");
          dashElapsed = 0;
          setDashPose(0);
          dash.feel.play("dash");
        },
        update: (dt) => {
          if (dashElapsed >= DASH_DURATION) return;
          dashElapsed = Math.min(DASH_DURATION, dashElapsed + dt);
          setDashPose(dashElapsed / DASH_DURATION);
        },
      },
      {
        label: "highlight",
        play: () => void highlight.feel.play("highlight"),
      },
      {
        label: "custom effect",
        play: () => void custom.feel.play("custom"),
      },
    ]);
  }

  onExit(): void {
    unregisterTexture(DASH_TEXTURE);
    this.dashTexture?.destroy();
    this.dashTexture = undefined;
  }

  private spawnImpactDemo(camera: CameraEntity): {
    feel: Feel;
    setValues: () => void;
  } {
    this.spawnLabel(165, 126, "1  IMPACT");
    const entity = this.spawn("impact-target");
    entity.add(new Transform({ position: new Vec2(165, 235) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -48, 42, -24, 42, 24, 0, 48, -42, 24, -42, -24]).fill({
          color: 0xef4444,
        });
        g.circle(0, 0, 18).fill({ color: 0x7f1d1d });
        g.circle(0, 0, 7).fill({ color: 0xfef2f2 });
      }),
    );
    let damage = 18;
    let critical = false;
    let hitCount = 0;
    const feel = entity.add(
      new Feel({
        impact: feelParallel(
          feelTransformShake({ target: visual, amplitude: 7, duration: 0.24 }),
          feelRotationShake({ target: visual, radians: 0.12, duration: 0.22 }),
          feelScalePunch({ target: visual, scale: 1.22, duration: 0.25 }),
          feelHitFlash(visual.fx, { color: 0xffffff, duration: 0.14 }),
          feelDamageNumber({
            value: () => damage,
            critical: () => critical,
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
    return {
      feel,
      setValues: () => {
        hitCount++;
        critical = hitCount % 3 === 0;
        damage = critical ? 42 : 14 + (hitCount % 6) * 2;
      },
    };
  }

  private spawnDashDemo(): { entity: Entity; feel: Feel } {
    this.spawnLabel(450, 342, "2  CURVED TRAIL + AFTERIMAGES");
    const entity = this.spawn("dash-runner");
    const transform = entity.add(new Transform({ position: DASH_START }));
    this.dashTexture = this.context.resolve(RendererKey).createTexture((g) => {
      g.poly([60, 18, 10, 0, 22, 18, 10, 36]).fill({ color: 0x38bdf8 });
      g.circle(32, 18, 7).fill({ color: 0xe0f2fe });
    });
    registerTexture(DASH_TEXTURE, this.dashTexture);
    const visual = entity.add(
      new SpriteComponent({
        texture: DASH_TEXTURE,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    const feel = entity.add(
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
    return { entity, feel };
  }

  private spawnHighlightDemo(): { feel: Feel } {
    this.spawnLabel(450, 126, "3  OUTLINE + GLOW");
    const entity = this.spawn("highlight-target");
    entity.add(new Transform({ position: new Vec2(450, 235) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -52, 42, 0, 0, 52, -42, 0]).fill({ color: 0xa78bfa });
        g.poly([0, -34, 25, 0, 0, 34, -25, 0]).fill({ color: 0xddd6fe });
      }),
    );
    const feel = entity.add(
      new Feel({
        highlight: feelParallel(
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
    return { feel };
  }

  private spawnCustomDemo(): { feel: Feel } {
    this.spawnLabel(735, 126, "4  CUSTOM EFFECT");
    const entity = this.spawn("custom-target");
    entity.add(new Transform({ position: new Vec2(735, 235) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 44).fill({ color: 0x10b981 });
        g.circle(0, 0, 27).stroke({ color: 0xa7f3d0, width: 6 });
        g.circle(0, 0, 8).fill({ color: 0xecfdf5 });
      }),
    );
    const feel = entity.add(
      new Feel({
        custom: feelParallel(
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
    return { feel };
  }
}

class PingPongMotion extends Component {
  private elapsed = 0;

  constructor(
    private readonly transform: Transform,
    private readonly centerX: number,
    private readonly amplitude: number,
    private readonly centerY = 435,
  ) {
    super();
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.transform.setPosition(
      this.centerX + Math.sin(this.elapsed * 4) * this.amplitude,
      this.centerY,
    );
  }
}

class MoreEffectsScene extends FeelGalleryScene {
  readonly name = "feel-addon-more-effects";

  onEnter(): void {
    this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.drawBackdrop(MORE_PANELS);
    const status = this.spawnText(
      "status",
      WIDTH / 2,
      62,
      `Page 2/2  ·  Autoplay: ${galleryState.autoplay ? "on" : "off"}  ·  Last cue: waiting`,
      15,
      0x94a3b8,
    );

    const punches = this.spawnPunchDemo();
    const visibility = this.spawnVisibilityDemo();
    const composition = this.spawnCompositionDemo();
    const slowMotion = this.spawnSlowMotionDemo();
    const animation = this.spawnAnimationDemo();
    const shockwave = this.spawnShockwaveDemo();

    this.installController(1, status, [
      { label: "punch + recoil", play: () => void punches.play("show") },
      { label: "fade + blink", play: () => void visibility.play("show") },
      {
        label: "sequence + repeat",
        play: () => void composition.play("show"),
      },
      { label: "target time", play: () => void slowMotion.play("show") },
      {
        label: "animation + callback",
        play: () => void animation.play("show"),
      },
      { label: "scene shockwave", play: () => void shockwave.play("show") },
    ]);
  }

  private spawnPunchDemo(): Feel {
    this.spawnLabel(165, 126, "1  PUNCH + RECOIL");
    const entity = this.spawn("punch-target");
    entity.add(new Transform({ position: new Vec2(165, 215) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-42, -34, 84, 68, 12).fill({ color: 0xf97316 });
        g.poly([10, -15, 34, 0, 10, 15]).fill({ color: 0xffedd5 });
      }),
    );
    return entity.add(
      new Feel({
        show: feelSequence(
          feelRecoil({
            target: visual,
            direction: { x: 1, y: 0 },
            distance: 34,
            duration: 0.3,
          }),
          feelParallel(
            feelPositionPunch({
              target: visual,
              offset: { x: 18, y: -24 },
              duration: 0.42,
            }),
            feelRotationPunch({
              target: visual,
              radians: 0.55,
              duration: 0.42,
            }),
            feelScalePunch({ target: visual, scale: 1.3, duration: 0.42 }),
          ),
        ),
      }),
    );
  }

  private spawnVisibilityDemo(): Feel {
    this.spawnLabel(450, 126, "2  FADE + BLINK");
    const entity = this.spawn("visibility-target");
    entity.add(new Transform({ position: new Vec2(450, 215) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.ellipse(0, 0, 54, 34).fill({ color: 0x22d3ee });
        g.circle(0, 0, 17).fill({ color: 0x164e63 });
        g.circle(0, 0, 7).fill({ color: 0xecfeff });
      }),
    );
    return entity.add(
      new Feel({
        show: feelSequence(
          feelOpacity({ target: visual, alpha: 0.08, duration: 0.55 }),
          feelBlink({ target: visual, duration: 0.48, interval: 0.06 }),
          feelHitFlash(visual.fx, { color: 0xffffff, duration: 0.16 }),
        ),
      }),
    );
  }

  private spawnCompositionDemo(): Feel {
    this.spawnLabel(735, 126, "3  SEQUENCE + REPEAT");
    const entity = this.spawn("composition-target");
    entity.add(new Transform({ position: new Vec2(735, 215) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        const colors = [0xf472b6, 0xc084fc, 0x818cf8];
        for (let index = 0; index < 3; index++) {
          g.circle((index - 1) * 30, 0, 13).fill({
            color: colors[index] ?? 0xffffff,
          });
        }
      }),
    );
    return entity.add(
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

  private spawnSlowMotionDemo(): Feel {
    this.spawnLabel(165, 346, "4  TARGET TIME");
    const track = this.spawn("slow-motion-track");
    track.add(new Transform({ position: new Vec2(165, 435) }));
    track.add(
      new GraphicsComponent().draw((g) => {
        for (const y of [-18, 18]) {
          g.moveTo(-88, y).lineTo(88, y).stroke({ color: 0x475569, width: 3 });
          g.circle(-88, y, 4).fill({ color: 0x64748b });
          g.circle(88, y, 4).fill({ color: 0x64748b });
        }
      }),
    );

    const mover = this.spawn("slow-motion-mover");
    const moverTransform = mover.add(
      new Transform({ position: new Vec2(165, 417) }),
    );
    mover.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 18).fill({ color: 0x4ade80 });
        g.circle(0, 0, 7).fill({ color: 0xf0fdf4 });
      }),
    );
    mover.add(new PingPongMotion(moverTransform, 165, 78, 417));

    const reference = this.spawn("normal-time-mover");
    const referenceTransform = reference.add(
      new Transform({ position: new Vec2(165, 453) }),
    );
    reference.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 12).fill({ color: 0x38bdf8 });
        g.circle(0, 0, 4).fill({ color: 0xe0f2fe });
      }),
    );
    reference.add(new PingPongMotion(referenceTransform, 165, 78, 453));

    const trigger = this.spawn("slow-motion-trigger");
    trigger.add(new Transform({ position: new Vec2(165, 470) }));
    return trigger.add(
      new Feel({
        show: feelParallel(
          feelSequence(
            feelSlowMotion({ target: mover, scale: 0.12, duration: 0.6 }),
            feelDelay(
              0.65,
              feelTargetFreeze({ target: mover, duration: 0.25 }),
            ),
          ),
          feelFloatingText({
            text: "GREEN: 0.12× → FREEZE",
            style: { fill: 0x86efac },
            duration: 0.9,
            travel: { x: 0, y: -26 },
          }),
        ),
      }),
    );
  }

  private spawnAnimationDemo(): Feel {
    this.spawnLabel(450, 346, "5  ANIMATION + CALLBACK");
    const entity = this.spawn("animation-target");
    const transform = entity.add(
      new Transform({ position: new Vec2(450, 425) }),
    );
    entity.add(
      new GraphicsComponent().draw((g) => {
        g.poly([0, -38, 22, 24, -34, -14, 34, -14, -22, 24]).fill({
          color: 0xfacc15,
        });
      }),
    );
    entity.add(new ProcessComponent());
    const animator = entity.add(
      new KeyframeAnimator<"spin">({
        spin: {
          keyframes: [
            { time: 0, data: 0 },
            { time: 0.35, data: Math.PI },
            { time: 0.7, data: Math.PI * 2 },
          ],
          setter: (rotation) => transform.setRotation(rotation as number),
        },
      }),
    );
    const callbackText = this.spawnText(
      "callback-count",
      450,
      480,
      "CALLBACKS: 0",
      12,
      0xfde68a,
    );
    let calls = 0;
    return entity.add(
      new Feel({
        show: feelSequence(
          feelKeyframeAnimation("spin", animator),
          feelDelay(0.7),
          feelCall(() => {
            calls++;
            callbackText.setText(`CALLBACKS: ${calls}`);
          }, "showcase callback"),
        ),
      }),
    );
  }

  private spawnShockwaveDemo(): Feel {
    this.spawnLabel(735, 346, "6  SCENE SHOCKWAVE");
    const entity = this.spawn("shockwave-target");
    entity.add(new Transform({ position: new Vec2(735, 435) }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 42).fill({ color: 0xe11d48 });
        g.circle(0, 0, 24).stroke({ color: 0xfda4af, width: 6 });
        g.circle(0, 0, 8).fill({ color: 0xfff1f2 });
      }),
    );
    const sceneEffects = this.use(SceneRenderTreeKey).fx;
    return entity.add(
      new Feel({
        show: feelParallel(
          feelShockwave(sceneEffects, {
            center: { x: 735, y: 435 },
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

function createShowcaseScene(page: number): FeelGalleryScene {
  return page === 0 ? new EssentialsScene() : new MoreEffectsScene();
}

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

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        cue1: ["Digit1"],
        cue2: ["Digit2"],
        cue3: ["Digit3"],
        cue4: ["Digit4"],
        cue5: ["Digit5"],
        cue6: ["Digit6"],
        autoplay: ["KeyA"],
        nextPage: ["KeyN", "ArrowRight"],
        previousPage: ["KeyP", "ArrowLeft"],
      },
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(createShowcaseScene(0));
}

main().catch(console.error);

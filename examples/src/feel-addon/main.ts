/**
 * Feel addon showcase. Four cues cover impact feedback, motion trails,
 * renderer effects, camera modifiers, transient callouts, and a custom effect.
 */

import {
  Component,
  Engine,
  Scene,
  Transform,
  Vec2,
  type Entity,
} from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
  type VisualTransformModifierHandle,
} from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import {
  Feel,
  defineFeelEffect,
  feelHitStop,
  feelParallel,
  type FeelNode,
} from "@yagejs-addons/feel";
import {
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
  feelOutline,
  feelRotationShake,
  feelScalePunch,
  feelScaleShake,
  feelSquash,
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
const DASH_SPEED = 1_350;

interface ShowcaseParts {
  impactFeel: Feel;
  dashFeel: Feel;
  highlightFeel: Feel;
  customFeel: Feel;
  dashEntity: Entity;
  status: TextComponent;
  setImpactValues(): void;
}

class ShowcaseController extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly dashTransform: Transform;
  private autoplay = true;
  private autoplayElapsed = 1.1;
  private autoplayIndex = 0;
  private dashRemaining = 0;
  private lastCue = "waiting";

  constructor(private readonly parts: ShowcaseParts) {
    super();
    this.dashTransform = parts.dashEntity.get(Transform);
  }

  update(dt: number): void {
    if (this.input.isJustPressed("impact")) this.trigger(0, false);
    if (this.input.isJustPressed("dash")) this.trigger(1, false);
    if (this.input.isJustPressed("highlight")) this.trigger(2, false);
    if (this.input.isJustPressed("custom")) this.trigger(3, false);
    if (this.input.isJustPressed("autoplay")) {
      this.autoplay = !this.autoplay;
      this.autoplayElapsed = 0;
      this.renderStatus();
    }

    if (this.dashRemaining > 0) {
      const step = Math.min(dt, this.dashRemaining);
      this.dashTransform.translate(DASH_SPEED * step, 0);
      this.dashRemaining -= step;
    }

    if (!this.autoplay) return;
    this.autoplayElapsed += dt;
    if (this.autoplayElapsed < 1.7) return;
    this.autoplayElapsed = 0;
    this.trigger(this.autoplayIndex, true);
    this.autoplayIndex = (this.autoplayIndex + 1) % 4;
  }

  private trigger(index: number, fromAutoplay: boolean): void {
    if (!fromAutoplay) this.autoplayElapsed = 0;
    if (index === 0) {
      this.parts.setImpactValues();
      this.parts.impactFeel.play("impact");
      this.lastCue = "impact";
    } else if (index === 1) {
      this.parts.dashFeel.stop("dash");
      this.dashTransform.setPosition(DASH_START.x, DASH_START.y);
      this.dashRemaining = DASH_DURATION;
      this.parts.dashFeel.play("dash");
      this.lastCue = "dash trail";
    } else if (index === 2) {
      this.parts.highlightFeel.play("highlight");
      this.lastCue = "highlight";
    } else {
      this.parts.customFeel.play("custom");
      this.lastCue = "custom effect";
    }
    this.renderStatus();
  }

  private renderStatus(): void {
    this.parts.status.setText(
      `Autoplay: ${this.autoplay ? "on" : "off"}  ·  Last cue: ${this.lastCue}`,
    );
  }
}

class FeelShowcaseScene extends Scene {
  readonly name = "feel-addon";

  onEnter(): void {
    const camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.drawBackdrop();

    const status = this.spawnText(
      "status",
      WIDTH / 2,
      62,
      "Autoplay: on  ·  Last cue: waiting",
      15,
      0x94a3b8,
    );

    const impact = this.spawnImpactDemo(camera);
    const dash = this.spawnDashDemo();
    const highlight = this.spawnHighlightDemo();
    const custom = this.spawnCustomDemo();

    const controller = this.spawn("showcase-controller");
    controller.add(new Transform());
    controller.add(
      new ShowcaseController({
        impactFeel: impact.feel,
        dashFeel: dash.feel,
        highlightFeel: highlight.feel,
        customFeel: custom.feel,
        dashEntity: dash.entity,
        status,
        setImpactValues: impact.setValues,
      }),
    );
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
    this.spawnLabel(450, 342, "2  FLIGHT LINES + MOTION TRAIL");
    const entity = this.spawn("dash-runner");
    entity.add(new Transform({ position: DASH_START }));
    const visual = entity.add(
      new GraphicsComponent().draw((g) => {
        g.poly([30, 0, -20, -18, -8, 0, -20, 18]).fill({ color: 0x38bdf8 });
        g.circle(2, 0, 6).fill({ color: 0xe0f2fe });
      }),
    );
    const feel = entity.add(
      new Feel({
        dash: feelParallel(
          feelFlightLines({
            direction: { x: 1, y: 0 },
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

  private drawBackdrop(): void {
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
        for (const x of [40, 325, 610]) {
          g.roundRect(x, 100, 250, 190, 12).fill({
            color: 0x111827,
            alpha: 0.88,
          });
          g.roundRect(x, 100, 250, 190, 12).stroke({
            color: 0x334155,
            width: 2,
          });
        }
        g.roundRect(40, 320, 820, 190, 12).fill({
          color: 0x111827,
          alpha: 0.88,
        });
        g.roundRect(40, 320, 820, 190, 12).stroke({
          color: 0x334155,
          width: 2,
        });
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

  private spawnLabel(x: number, y: number, text: string): void {
    this.spawnText(`label:${text}`, x, y, text, 14, 0x94a3b8);
  }

  private spawnText(
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
        impact: ["Digit1"],
        dash: ["Digit2"],
        highlight: ["Digit3"],
        custom: ["Digit4"],
        autoplay: ["KeyA"],
      },
    }),
  );
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new FeelShowcaseScene());
}

main().catch(console.error);

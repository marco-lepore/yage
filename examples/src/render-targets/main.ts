/**
 * Offscreen render targets and blend modes.
 *
 * A light buffer is drawn offscreen and then composited over the world. Press
 * C to cycle the three ways of doing that:
 *
 *   - **cut-out** — the buffer is darkness with soft holes erased out of it,
 *     drawn over the world normally. Lit areas show the world's true colours;
 *     lights cannot tint.
 *   - **multiply** — the buffer is cleared to an ambient colour and each light
 *     is added into it, so overlapping lights accumulate. Drawn over the world
 *     with `blendMode: "multiply"`, it darkens and tints in one pass. Coloured
 *     lights work, but every surface takes the light's colour: a warm lamp
 *     cannot make a blue object read blue.
 *   - **cut-out + glow** — the cut-out buffer for the darkness, plus a second
 *     overlay of coloured lights added straight over the world. True colours
 *     in the lit areas AND a tint, at the cost of two passes.
 *
 * The buffer is what makes the first two possible at all. `"erase"` and
 * `"add"` compose against whatever they are drawn into, so the lights have to
 * meet the ambient or the darkness somewhere of their own before the result
 * reaches the canvas. The glow pass is the exception: it only brightens what
 * is already on screen, so it needs no buffer.
 *
 * The strip along the bottom uses `blendMode` on its own, with no buffer.
 *
 * R cycles `resolutionScale` — the holes get chunky, nothing changes size.
 * Space stops the orbit, and `renderIfNeeded()` stops drawing with it.
 */
import { Container, Graphics } from "pixi.js";
import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import {
  GraphicsComponent,
  RendererKey,
  RendererPlugin,
  SpriteComponent,
  TextComponent,
  radialGradient,
  registerTexture,
} from "@yagejs/renderer";
import type { LayerDef, RenderTargetHandle } from "@yagejs/renderer";
import { installDebugFromUrl, setupGameContainer } from "../shared/bootstrap.js";

const W = 800;
const H = 600;
const BAND_TOP = 470;

/** The resolutionScale values R cycles through. */
const SCALES = [1, 0.5, 0.25, 0.1];

/** Ambient light where no lamp reaches — the multiply buffer's clear colour. */
const AMBIENT = 0x0c1020;

interface LightSpec {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Only the multiply composite can honour this. */
  readonly color: number;
}

const LIGHTS: readonly LightSpec[] = [
  { x: 190, y: 190, radius: 150, color: 0xffb066 },
  { x: 620, y: 150, radius: 110, color: 0x66aaff },
];
const ROAMER: LightSpec = { x: 0, y: 0, radius: 165, color: 0xff7ac4 };

/**
 * A radial ramp, opaque at the centre and transparent at the rim. The ramp is
 * what makes the light soft under either composite: `erase` subtracts by it,
 * `add` brightens by it.
 */
function lightGraphics(spec: LightSpec, color: number): Graphics {
  const fill = radialGradient({
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerRadius: 0.5,
    stops: [
      { offset: 0, color, alpha: 1 },
      { offset: 0.55, color, alpha: 0.72 },
      { offset: 1, color, alpha: 0 },
    ],
  });
  const g = new Graphics().circle(0, 0, spec.radius).fill(fill);
  g.position.set(spec.x, spec.y);
  return g;
}

const COMPOSITES = ["cut-out", "multiply", "cut-out + glow"] as const;
type Composite = (typeof COMPOSITES)[number];

// ---------------------------------------------------------------------------
// Owns the buffer's contents for the composites and swaps between them
// ---------------------------------------------------------------------------
class LightBuffer {
  readonly source = new Container();
  private readonly cutOut = new Container();
  private readonly multiply = new Container();
  /** The roaming light's graphic in each group, moved together. */
  private readonly roamers: Graphics[] = [];
  mode: Composite = "cut-out";

  constructor() {
    // Cut-out: opaque darkness, holes erased through it.
    this.cutOut.addChild(
      new Graphics().rect(0, 0, W, BAND_TOP).fill({ color: 0x05060a, alpha: 0.9 }),
    );
    for (const spec of [...LIGHTS, ROAMER]) {
      const g = lightGraphics(spec, 0xffffff);
      g.blendMode = "erase";
      this.cutOut.addChild(g);
      if (spec === ROAMER) this.roamers.push(g);
    }

    // Multiply: ambient floor, lights added on top so they accumulate.
    this.multiply.addChild(new Graphics().rect(0, 0, W, BAND_TOP).fill(AMBIENT));
    for (const spec of [...LIGHTS, ROAMER]) {
      const g = lightGraphics(spec, spec.color);
      g.blendMode = "add";
      this.multiply.addChild(g);
      if (spec === ROAMER) this.roamers.push(g);
    }

    this.multiply.visible = false;
    this.source.addChild(this.cutOut, this.multiply);
  }

  /** The blend mode the finished buffer is drawn over the world with. */
  get overlayBlendMode(): "normal" | "multiply" {
    return this.mode === "multiply" ? "multiply" : "normal";
  }

  /** Whether the separate additive glow pass is part of this composite. */
  get usesGlowPass(): boolean {
    return this.mode === "cut-out + glow";
  }

  next(): void {
    const i = COMPOSITES.indexOf(this.mode);
    this.mode = COMPOSITES[(i + 1) % COMPOSITES.length] ?? "cut-out";
    // "cut-out + glow" reuses the cut-out buffer and adds a second overlay on
    // top, so only the multiply composite swaps what the buffer contains.
    this.multiply.visible = this.mode === "multiply";
    this.cutOut.visible = this.mode !== "multiply";
  }

  moveRoamer(x: number, y: number): void {
    for (const g of this.roamers) g.position.set(x, y);
  }
}

// ---------------------------------------------------------------------------
// Drives the orbiting light and redraws the buffer only when it moved
// ---------------------------------------------------------------------------
class OrbitingLight extends Component {
  private elapsed = 0;
  paused = false;
  redraws = 0;

  constructor(
    private readonly buffer: LightBuffer,
    private readonly target: RenderTargetHandle,
    /** The glow pass's roaming light, which lives in the scene, not the buffer. */
    private readonly glowRoamer: Transform,
  ) {
    super();
  }

  update(dt: number): void {
    if (!this.paused) {
      this.elapsed += dt;
      const x = 400 + Math.cos(this.elapsed * 0.9) * 230;
      const y = 240 + Math.sin(this.elapsed * 1.3) * 130;
      this.buffer.moveRoamer(x, y);
      this.glowRoamer.setPosition(x, y);
      // The buffer's content changed, so mark it stale. Without this the
      // texture keeps whatever it held last.
      this.target.invalidate();
    }
    if (this.target.renderIfNeeded()) this.redraws++;
  }
}

// ---------------------------------------------------------------------------
// In-canvas readout
// ---------------------------------------------------------------------------
class Readout extends Component {
  private readonly text = this.sibling(TextComponent);
  private since = 0;
  private lastCount = 0;
  private perSecond = 0;

  constructor(
    private readonly orbit: OrbitingLight,
    private readonly buffer: LightBuffer,
    private readonly target: RenderTargetHandle,
  ) {
    super();
  }

  update(dt: number): void {
    this.since += dt;
    if (this.since >= 0.5) {
      this.perSecond = Math.round((this.orbit.redraws - this.lastCount) / this.since);
      this.lastCount = this.orbit.redraws;
      this.since = 0;
    }
    const scale = this.target.resolution / window.devicePixelRatio;
    const texels = `${Math.round(this.target.width * scale)}x${Math.round(this.target.height * scale)}`;
    const passes = this.buffer.usesGlowPass
      ? `buffer "${this.buffer.overlayBlendMode}" + additive glow pass`
      : `buffer "${this.buffer.overlayBlendMode}"`;
    this.text.setText(
      `composite ${this.buffer.mode}  (${passes})\n` +
        `buffer ${this.target.width}x${this.target.height} @ ${scale.toFixed(2)}x  (${texels} texels)\n` +
        `redraws/sec ${this.perSecond}${this.orbit.paused ? "  — orbit paused" : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class RenderTargetScene extends Scene {
  readonly name = "render-targets";

  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "overlay", order: 10 },
    { name: "glow", order: 15 },
    { name: "blend-demo", order: 20 },
    { name: "hud", order: 30 },
  ];

  private target: RenderTargetHandle | undefined;
  private buffer: LightBuffer | undefined;
  private overlaySprite: SpriteComponent | undefined;
  private orbit: OrbitingLight | undefined;
  private glowPass: GraphicsComponent[] = [];
  private scaleIndex = 0;
  private onKey: ((e: KeyboardEvent) => void) | undefined;

  // `noUncheckedIndexedAccess` widens a variable index to `| undefined`.
  private get resolutionScale(): number {
    return SCALES[this.scaleIndex] ?? 1;
  }

  onEnter(): void {
    this.buildWorld();
    const glowRoamer = this.buildGlowPass();
    this.buildLighting(glowRoamer);
    this.buildBlendStrip();
    this.bindKeys();
  }

  /**
   * The third composite's second overlay: coloured lights drawn straight over
   * the world with `blendMode: "add"`. No buffer — `add` composes correctly
   * against the scene, because it only ever brightens what is already there.
   * Hidden unless the composite asks for it.
   */
  private buildGlowPass(): Transform {
    const draw = (spec: LightSpec) => (g: GraphicsComponent["graphics"]) => {
      g.circle(0, 0, spec.radius * 0.85).fill(
        radialGradient({
          center: { x: 0.5, y: 0.5 },
          innerRadius: 0,
          outerRadius: 0.5,
          stops: [
            { offset: 0, color: spec.color, alpha: 0.55 },
            { offset: 0.5, color: spec.color, alpha: 0.28 },
            { offset: 1, color: spec.color, alpha: 0 },
          ],
        }),
      );
    };

    for (const spec of LIGHTS) {
      const e = this.spawn(`glow-${spec.x}`);
      e.add(new Transform({ position: new Vec2(spec.x, spec.y) }));
      this.glowPass.push(
        e.add(
          new GraphicsComponent({
            layer: "glow",
            blendMode: "add",
            visible: false,
          }).draw(draw(spec)),
        ),
      );
    }

    const roamer = this.spawn("glow-roamer");
    const transform = roamer.add(new Transform());
    this.glowPass.push(
      roamer.add(
        new GraphicsComponent({
          layer: "glow",
          blendMode: "add",
          visible: false,
        }).draw(draw(ROAMER)),
      ),
    );
    return transform;
  }

  onExit(): void {
    if (this.onKey) window.removeEventListener("keydown", this.onKey);
    // The buffer holds GPU memory that no entity owns, so release it here.
    this.target?.destroy();
  }

  /** Something worth revealing: a tile floor plus a few solid shapes. */
  private buildWorld(): void {
    const floor = this.spawn("floor");
    floor.add(new Transform());
    floor.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(0, 0, W, BAND_TOP).fill({ color: 0x2e6f4e });
        for (let y = 0; y < BAND_TOP; y += 40) {
          for (let x = 0; x < W; x += 40) {
            if ((x / 40 + y / 40) % 2 === 0) {
              g.rect(x, y, 40, 40).fill({ color: 0x3a8a61 });
            }
          }
        }
      }),
    );

    const props = this.spawn("props");
    props.add(new Transform());
    props.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.circle(190, 190, 46).fill({ color: 0xe4573d });
        g.rect(430, 250, 110, 110).fill({ color: 0xf2f0e6 });
        g.circle(620, 150, 34).fill({ color: 0x6ba7e4 });
        g.poly([300, 380, 360, 300, 420, 380]).fill({ color: 0xa78bfa });
      }),
    );
  }

  /**
   * The buffer's contents are plain Pixi containers that are never added to
   * the scene's render tree — they exist only to be drawn into the texture.
   * What the scene shows is that texture.
   */
  private buildLighting(glowRoamer: Transform): void {
    const renderer = this.context.resolve(RendererKey);

    const buffer = new LightBuffer();
    this.buffer = buffer;

    const target = renderer.createRenderTarget(buffer.source, {
      width: W,
      height: BAND_TOP,
      resolutionScale: this.resolutionScale,
    });
    this.target = target;
    target.render();

    registerTexture("lighting-buffer", target.texture);
    const overlay = this.spawn("lighting");
    overlay.add(new Transform());
    this.overlaySprite = overlay.add(
      new SpriteComponent({
        texture: "lighting-buffer",
        anchor: { x: 0, y: 0 },
        layer: "overlay",
        blendMode: buffer.overlayBlendMode,
      }),
    );

    const orbit = new OrbitingLight(buffer, target, glowRoamer);
    overlay.add(orbit);
    this.orbit = orbit;

    const hud = this.spawn("hud");
    hud.add(new Transform({ position: new Vec2(12, 10) }));
    hud.add(
      new TextComponent({
        text: "",
        layer: "hud",
        style: { fontFamily: "monospace", fontSize: 13, fill: 0x9fe3c0 },
      }),
    );
    hud.add(new Readout(orbit, buffer, target));
  }

  /**
   * `blendMode` on its own, with no buffer — each square combines with the
   * bright band already drawn beneath it.
   */
  private buildBlendStrip(): void {
    const band = this.spawn("band");
    band.add(new Transform());
    band.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        g.rect(0, BAND_TOP, W, H - BAND_TOP).fill({ color: 0x1b1b22 });
        g.rect(40, BAND_TOP + 40, 720, 70).fill({ color: 0x7a6cc4 });
      }),
    );

    const modes = ["normal", "add", "multiply", "screen"] as const;
    modes.forEach((mode, i) => {
      const x = 120 + i * 180;
      const square = this.spawn(`blend-${mode}`);
      square.add(new Transform());
      square.add(
        new GraphicsComponent({ layer: "blend-demo", blendMode: mode }).draw((g) => {
          g.rect(x - 45, BAND_TOP + 30, 90, 90).fill({ color: 0xf2a33c });
        }),
      );

      const label = this.spawn(`blend-label-${mode}`);
      label.add(new Transform({ position: new Vec2(x, BAND_TOP + 130) }));
      label.add(
        new TextComponent({
          text: mode,
          layer: "hud",
          anchor: { x: 0.5, y: 0 },
          style: { fontFamily: "monospace", fontSize: 13, fill: 0xbdbdc8 },
        }),
      );
    });
  }

  private bindKeys(): void {
    this.onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        this.scaleIndex = (this.scaleIndex + 1) % SCALES.length;
        // resize() re-allocates at the new texel count and marks the buffer
        // stale; the sprite showing it picks the change up on its next draw.
        this.target?.resize(W, BAND_TOP, this.resolutionScale);
      } else if (e.key === "c" || e.key === "C") {
        if (!this.buffer) return;
        this.buffer.next();
        // The live accessors — the same values the constructor options take.
        if (this.overlaySprite) {
          this.overlaySprite.blendMode = this.buffer.overlayBlendMode;
        }
        for (const glow of this.glowPass) glow.visible = this.buffer.usesGlowPass;
        this.target?.invalidate();
      } else if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (this.orbit) this.orbit.paused = !this.orbit.paused;
      }
    };
    window.addEventListener("keydown", this.onKey);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: W,
      height: H,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(W, H),
    }),
  );
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new RenderTargetScene());
}

main().catch(console.error);

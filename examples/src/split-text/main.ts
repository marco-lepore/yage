import {
  Engine,
  Component,
  MathUtils,
  RandomKey,
  Scene,
  Transform,
  Vec2,
  easeOutCubic,
} from "@yagejs/core";
import {
  RendererPlugin,
  SplitTextComponent,
  TextComponent,
} from "@yagejs/renderer";
import type { DisplayBitmapText, DisplayText } from "@yagejs/renderer";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** HSL (h in degrees, s/l in 0–1) to a packed 0xRRGGBB int for `.tint`. */
function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r: number;
  let g: number;
  let b: number;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to8 = (v: number): number => Math.round((v + m) * 255);
  return (to8(r) << 16) | (to8(g) << 8) | to8(b);
}

// ---------------------------------------------------------------------------
// Effect cycle — each effect animates the per-glyph `chars` directly. The
// showcase captures each glyph's "home" position once, then every effect
// offsets from there; switching effects resets glyphs to home first.
// ---------------------------------------------------------------------------
const EFFECTS = [
  { name: "Typewriter", duration: 3.4 },
  { name: "Wave", duration: 3.6 },
  { name: "Rainbow", duration: 3.6 },
  { name: "Glitch", duration: 3.0 },
  { name: "Explode", duration: 3.8 },
  { name: "Fall to pieces", duration: 3.8 },
  { name: "Assemble", duration: 3.0 },
] as const;

type Effect = (typeof EFFECTS)[number];

const GLITCH_TINTS = [0xffffff, 0x00ffff, 0xff3df0, 0xfff04d];

/**
 * One glyph of the title: its display object, its home position, and the
 * scratch state `enterEffect` re-seeds for each effect (velocity for the
 * physics effects, start pose for Assemble).
 */
interface Glyph {
  readonly char: DisplayText | DisplayBitmapText;
  readonly homeX: number;
  readonly homeY: number;
  vx: number;
  vy: number;
  vr: number;
  startX: number;
  startY: number;
  startRotation: number;
}

class SplitTextShowcase extends Component {
  private readonly split = this.sibling(SplitTextComponent);
  private readonly rng = this.service(RandomKey);

  private glyphs: Glyph[] = [];
  private cx = 0;
  private cy = 0;

  private current = 0;
  private effect: Effect = EFFECTS[0];
  private localT = 0;

  constructor(private readonly label: TextComponent) {
    super();
  }

  update(dt: number): void {
    if (!this.ready()) return;

    this.localT += dt;
    const t = this.localT;

    switch (this.effect.name) {
      case "Typewriter": {
        const per = 0.13;
        const fade = 0.18;
        for (const [k, g] of this.glyphs.entries()) {
          const p = MathUtils.clamp((t - k * per) / fade, 0, 1);
          g.char.alpha = p;
          g.char.scale.set(1 + (1 - p) * 0.9);
        }
        break;
      }
      case "Wave": {
        for (const [k, g] of this.glyphs.entries()) {
          const phase = t * 4 + k * 0.45;
          g.char.y = g.homeY + Math.sin(phase) * 16;
          g.char.rotation = Math.sin(phase) * 0.18;
        }
        break;
      }
      case "Rainbow": {
        for (const [k, g] of this.glyphs.entries()) {
          g.char.tint = hsl(t * 120 + k * 30, 0.85, 0.62);
          g.char.y = g.homeY + Math.sin(t * 3 + k * 0.4) * 6;
        }
        break;
      }
      case "Glitch": {
        for (const g of this.glyphs) {
          const c = g.char;
          c.x = g.homeX + this.rng.range(-3.5, 3.5);
          c.y = g.homeY + this.rng.range(-3.5, 3.5);
          c.alpha = this.rng.float() < 0.08 ? 0.2 : 1;
          c.tint =
            this.rng.float() < 0.18 ? this.rng.pick(GLITCH_TINTS) : 0xffffff;
          c.rotation =
            this.rng.float() < 0.12 ? this.rng.range(-0.175, 0.175) : 0;
        }
        break;
      }
      case "Explode": {
        const dur = this.effect.duration;
        for (const g of this.glyphs) {
          const c = g.char;
          g.vy += 800 * dt; // gentle gravity so shards arc
          c.x += g.vx * dt;
          c.y += g.vy * dt;
          c.rotation += g.vr * dt;
          c.alpha = MathUtils.clamp(1 - t / (dur * 0.9), 0, 1);
        }
        break;
      }
      case "Fall to pieces": {
        for (const g of this.glyphs) {
          const c = g.char;
          g.vy += 1600 * dt; // gravity
          c.x += g.vx * dt;
          c.y += g.vy * dt;
          c.rotation += g.vr * dt;
          c.alpha = MathUtils.clamp(1 - (t - 1.0) / 2.4, 0, 1);
        }
        break;
      }
      case "Assemble": {
        const p = easeOutCubic(MathUtils.clamp(t / 1.7, 0, 1));
        for (const g of this.glyphs) {
          const c = g.char;
          c.x = MathUtils.lerp(g.startX, g.homeX, p);
          c.y = MathUtils.lerp(g.startY, g.homeY, p);
          c.rotation = MathUtils.lerp(g.startRotation, 0, p);
          c.scale.set(MathUtils.lerp(0.2, 1, p));
          c.alpha = MathUtils.clamp(t / 0.8, 0, 1);
        }
        break;
      }
    }

    if (this.localT >= this.effect.duration) {
      this.enterEffect((this.current + 1) % EFFECTS.length);
    }
  }

  /** Capture glyph homes + block center on the first update. */
  private ready(): boolean {
    if (this.glyphs.length) return true;
    const chars = this.split.chars;
    if (!chars.length) return false;

    this.glyphs = chars.map((char) => ({
      char,
      homeX: char.x,
      homeY: char.y,
      vx: 0,
      vy: 0,
      vr: 0,
      startX: 0,
      startY: 0,
      startRotation: 0,
    }));
    const b = this.split.splitText.getLocalBounds();
    this.cx = b.x + b.width / 2;
    this.cy = b.y + b.height / 2;

    this.enterEffect(0);
    return true;
  }

  /** Reset glyphs to home and seed the next effect's scratch state. */
  private enterEffect(index: number): void {
    const effect = EFFECTS[index]!;
    this.current = index;
    this.effect = effect;
    this.localT = 0;
    this.label.setText(`${effect.name}   ·   ${index + 1} / ${EFFECTS.length}`);

    for (const g of this.glyphs) {
      const c = g.char;
      c.x = g.homeX;
      c.y = g.homeY;
      c.rotation = 0;
      c.scale.set(1);
      c.alpha = 1;
      c.tint = 0xffffff;

      if (effect.name === "Explode") {
        const dx = g.homeX - this.cx;
        const dy = g.homeY - this.cy;
        const len = Math.hypot(dx, dy) || 1;
        const speed = this.rng.range(220, 620);
        g.vx = (dx / len) * speed + this.rng.range(-75, 75);
        g.vy = (dy / len) * speed - this.rng.range(250, 450);
        g.vr = this.rng.range(-12.5, 12.5);
      } else if (effect.name === "Fall to pieces") {
        g.vx = this.rng.range(-90, 90);
        g.vy = -this.rng.range(180, 400); // small initial hop
        g.vr = this.rng.range(-15, 15);
      } else if (effect.name === "Assemble") {
        const ang = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(260, 520);
        g.startX = g.homeX + Math.cos(ang) * r;
        g.startY = g.homeY + Math.sin(ang) * r;
        g.startRotation = this.rng.range(-4, 4);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class SplitTextScene extends Scene {
  readonly name = "split-text";

  onEnter(): void {
    // Effect-name label, centered near the bottom.
    const labelEntity = this.spawn("label");
    labelEntity.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 70) }),
    );
    const label = labelEntity.add(
      new TextComponent({
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 18,
          fontWeight: "600",
          fill: 0x94a3b8,
          letterSpacing: 2,
        },
      }),
    );

    // The animated title.
    const title = this.spawn("title");
    title.add(
      new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 - 20) }),
    );
    title.add(
      new SplitTextComponent({
        text: "SPLIT TEXT",
        // Center the block on the entity's Transform.
        anchor: { x: 0.5, y: 0.5 },
        // Center each glyph's transform origin so rotation / scale pivot
        // around the glyph, not its top-left corner.
        charAnchor: 0.5,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 104,
          fontWeight: "800",
          fill: 0xffffff,
        },
      }),
    );
    title.add(new SplitTextShowcase(label));
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );

  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new SplitTextScene());
}

main().catch(console.error);

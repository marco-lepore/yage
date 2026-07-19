import {
  Engine,
  Component,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  RendererPlugin,
  SplitTextComponent,
  TextComponent,
} from "@yagejs/renderer";
import { injectStyles, installDebugFromUrl, setupGameContainer } from "./shared/bootstrap.js";

const WIDTH = 800;
const HEIGHT = 600;

injectStyles();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** HSL (h in degrees, s/l in 0–1) to a packed 0xRRGGBB int for `.tint`. */
function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
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

const GLITCH_TINTS = [0xffffff, 0x00ffff, 0xff3df0, 0xfff04d];

class SplitTextShowcase extends Component {
  private readonly split = this.sibling(SplitTextComponent);

  private homes: { x: number; y: number }[] = [];
  private cx = 0;
  private cy = 0;

  private current = 0;
  private localT = 0;

  // Per-glyph scratch state, re-seeded on each effect enter (velocity for the
  // physics effects, start pose for Assemble).
  private vx: number[] = [];
  private vy: number[] = [];
  private vr: number[] = [];
  private sx: number[] = [];
  private sy: number[] = [];
  private srot: number[] = [];

  constructor(private readonly label: TextComponent) {
    super();
  }

  update(dt: number): void {
    if (!this.ready()) return;

    this.localT += dt;
    const t = this.localT;
    const chars = this.split.chars;
    const name = EFFECTS[this.current]!.name;

    switch (name) {
      case "Typewriter": {
        const per = 0.13;
        const fade = 0.18;
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          const p = clamp01((t - k * per) / fade);
          c.alpha = p;
          c.scale.set(1 + (1 - p) * 0.9);
        }
        break;
      }
      case "Wave": {
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          const phase = t * 4 + k * 0.45;
          c.y = this.homes[k]!.y + Math.sin(phase) * 16;
          c.rotation = Math.sin(phase) * 0.18;
        }
        break;
      }
      case "Rainbow": {
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          c.tint = hsl(t * 120 + k * 30, 0.85, 0.62);
          c.y = this.homes[k]!.y + Math.sin(t * 3 + k * 0.4) * 6;
        }
        break;
      }
      case "Glitch": {
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          const h = this.homes[k]!;
          c.x = h.x + (Math.random() - 0.5) * 7;
          c.y = h.y + (Math.random() - 0.5) * 7;
          c.alpha = Math.random() < 0.08 ? 0.2 : 1;
          c.tint =
            Math.random() < 0.18
              ? GLITCH_TINTS[(Math.random() * GLITCH_TINTS.length) | 0]!
              : 0xffffff;
          c.rotation = Math.random() < 0.12 ? (Math.random() - 0.5) * 0.35 : 0;
        }
        break;
      }
      case "Explode": {
        const dur = EFFECTS[this.current]!.duration;
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          this.vy[k]! += 800 * dt; // gentle gravity so shards arc
          c.x += this.vx[k]! * dt;
          c.y += this.vy[k]! * dt;
          c.rotation += this.vr[k]! * dt;
          c.alpha = clamp01(1 - t / (dur * 0.9));
        }
        break;
      }
      case "Fall to pieces": {
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          this.vy[k]! += 1600 * dt; // gravity
          c.x += this.vx[k]! * dt;
          c.y += this.vy[k]! * dt;
          c.rotation += this.vr[k]! * dt;
          c.alpha = clamp01(1 - (t - 1.0) / 2.4);
        }
        break;
      }
      case "Assemble": {
        const p = easeOutCubic(clamp01(t / 1.7));
        for (let k = 0; k < chars.length; k++) {
          const c = chars[k]!;
          const h = this.homes[k]!;
          c.x = lerp(this.sx[k]!, h.x, p);
          c.y = lerp(this.sy[k]!, h.y, p);
          c.rotation = lerp(this.srot[k]!, 0, p);
          c.scale.set(lerp(0.2, 1, p));
          c.alpha = clamp01(t / 0.8);
        }
        break;
      }
    }

    if (this.localT >= EFFECTS[this.current]!.duration) {
      this.enterEffect((this.current + 1) % EFFECTS.length);
    }
  }

  /** Capture glyph homes + block center on the first frame after the split. */
  private ready(): boolean {
    if (this.homes.length) return true;
    const chars = this.split.chars;
    if (!chars.length) return false;

    this.homes = chars.map((c) => ({ x: c.x, y: c.y }));
    const b = this.split.splitText.getLocalBounds();
    this.cx = b.x + b.width / 2;
    this.cy = b.y + b.height / 2;
    // Pivot at the block center so the whole title is centered on the
    // entity's Transform (DisplaySystem syncs position but leaves pivot to us).
    this.split.splitText.pivot.set(this.cx, this.cy);

    this.enterEffect(0);
    return true;
  }

  /** Reset glyphs to home and seed the next effect's scratch state. */
  private enterEffect(index: number): void {
    this.current = index;
    this.localT = 0;

    const chars = this.split.chars;
    for (let k = 0; k < chars.length; k++) {
      const c = chars[k]!;
      const h = this.homes[k]!;
      c.x = h.x;
      c.y = h.y;
      c.rotation = 0;
      c.scale.set(1);
      c.alpha = 1;
      c.tint = 0xffffff;
    }

    const effect = EFFECTS[index]!;
    this.label.setText(`${effect.name}   ·   ${index + 1} / ${EFFECTS.length}`);

    this.vx = [];
    this.vy = [];
    this.vr = [];
    this.sx = [];
    this.sy = [];
    this.srot = [];

    if (effect.name === "Explode") {
      for (let k = 0; k < chars.length; k++) {
        const h = this.homes[k]!;
        const dx = h.x - this.cx;
        const dy = h.y - this.cy;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 220 + Math.random() * 400;
        this.vx[k] = (dx / len) * speed + (Math.random() - 0.5) * 150;
        this.vy[k] = (dy / len) * speed - 250 - Math.random() * 200;
        this.vr[k] = (Math.random() - 0.5) * 25;
      }
    } else if (effect.name === "Fall to pieces") {
      for (let k = 0; k < chars.length; k++) {
        this.vx[k] = (Math.random() - 0.5) * 180;
        this.vy[k] = -180 - Math.random() * 220; // small initial hop
        this.vr[k] = (Math.random() - 0.5) * 30;
      }
    } else if (effect.name === "Assemble") {
      for (let k = 0; k < chars.length; k++) {
        const h = this.homes[k]!;
        const ang = Math.random() * Math.PI * 2;
        const r = 260 + Math.random() * 260;
        this.sx[k] = h.x + Math.cos(ang) * r;
        this.sy[k] = h.y + Math.sin(ang) * r;
        this.srot[k] = (Math.random() - 0.5) * 8;
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
    labelEntity.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 70) }));
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
    title.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2 - 20) }));
    title.add(
      new SplitTextComponent({
        text: "SPLIT TEXT",
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

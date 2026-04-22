/**
 * Responsive UI with a fixed-ratio game area + fog-of-war at the crop edges.
 *
 * Demonstrates `cover` fit with `visibleVirtualRect` and `croppedVirtualRects`:
 *
 * - Declared virtual area is 800×600 — the play field. Gameplay operates
 *   in the full rectangle regardless of screen aspect.
 * - `fit: { mode: "cover" }` fills the host, cropping the long axis.
 * - HUD cards anchor to `visibleVirtualRect` corners so they stay at
 *   the edges of what the player can see.
 * - A screen-space fog layer reads `croppedVirtualRects` and draws a
 *   half-opacity band along each cropped edge, expanded inward into the
 *   visible area so the fog actually shows. The grid bleeds through at
 *   half alpha; bouncing balls that cross into the fog band get visually
 *   muted as they approach the crop boundary.
 * - Under an exact-aspect host (800×600), `croppedVirtualRects` is empty
 *   and no fog is drawn. Resize the window to see it appear/disappear.
 */
import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  RendererKey,
  GraphicsComponent,
} from "@yagejs/renderer";
import type { LayerDef, VirtualRect } from "@yagejs/renderer";
import { injectStyles, getContainer } from "./shared.js";

injectStyles(`
  /* Let the container flex to any aspect so cover mode has something to do. */
  #game-container {
    max-width: 100%;
    height: 70vh;
    aspect-ratio: auto;
  }
  #readout {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: #aaa;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 6px 10px;
    text-align: center;
  }
`);

const readout = document.createElement("div");
readout.id = "readout";
readout.textContent = "Resize the browser to see the fog track the cropped edges";
document.body.appendChild(readout);

const VIRTUAL_WIDTH = 800;
const VIRTUAL_HEIGHT = 600;
const FOG_INWARD_DEPTH = 60; // virtual pixels the fog extends into visible area

// Configure the container for "flex to any size".
const container = getContainer();
container.style.maxWidth = "100%";
container.style.height = "70vh";
container.style.aspectRatio = "auto";

// ---------------------------------------------------------------------------
// HudAnchor — repositions its entity to a corner of `visibleVirtualRect`.
// ---------------------------------------------------------------------------
type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

class HudAnchor extends Component {
  private readonly renderer = this.service(RendererKey);
  private readonly transform = this.sibling(Transform);

  constructor(
    private readonly corner: Corner,
    private readonly margin = 20,
  ) {
    super();
  }

  update(): void {
    const { x, y, width, height } = this.renderer.visibleVirtualRect;
    const m = this.margin;
    let px = x + m;
    let py = y + m;
    if (this.corner === "topRight") px = x + width - m;
    if (this.corner === "bottomLeft") py = y + height - m;
    if (this.corner === "bottomRight") {
      px = x + width - m;
      py = y + height - m;
    }
    this.transform.setPosition(px, py);
  }
}

// ---------------------------------------------------------------------------
// BouncingBall — gameplay. Bounces off the full 800×600 virtual bounds,
// NOT the visible sub-rect. Demonstrates that gameplay continues off-screen.
// ---------------------------------------------------------------------------
class BouncingBall extends Component {
  private readonly transform = this.sibling(Transform);
  private velocity: Vec2;

  constructor(
    vx: number,
    vy: number,
    private readonly radius: number,
  ) {
    super();
    this.velocity = new Vec2(vx, vy);
  }

  update(dt: number): void {
    const dtSec = dt / 1000;
    const p = this.transform.position;
    let nx = p.x + this.velocity.x * dtSec;
    let ny = p.y + this.velocity.y * dtSec;
    if (nx - this.radius < 0 || nx + this.radius > VIRTUAL_WIDTH) {
      this.velocity = new Vec2(-this.velocity.x, this.velocity.y);
      nx = p.x + this.velocity.x * dtSec;
    }
    if (ny - this.radius < 0 || ny + this.radius > VIRTUAL_HEIGHT) {
      this.velocity = new Vec2(this.velocity.x, -this.velocity.y);
      ny = p.y + this.velocity.y * dtSec;
    }
    this.transform.setPosition(nx, ny);
  }
}

// ---------------------------------------------------------------------------
// FogOverlay — redraws a half-opacity fog band for each cropped edge, each
// band extended inward by FOG_INWARD_DEPTH so it's visible inside the
// canvas instead of being fully clipped. Redraws only when the rect set
// changes (resize events) to avoid per-frame graphics churn.
// ---------------------------------------------------------------------------
function expandInward(
  cropped: VirtualRect,
  depth: number,
  vw: number,
  vh: number,
): VirtualRect {
  // Push the cropped rect edge into the visible area on the axis where
  // the rect sits against the virtual boundary.
  if (cropped.y === 0 && cropped.height < vh) {
    // top strip: extend height downward into visible
    return { ...cropped, height: cropped.height + depth };
  }
  if (cropped.y + cropped.height === vh) {
    // bottom strip: start earlier, keep end
    return {
      x: cropped.x,
      y: cropped.y - depth,
      width: cropped.width,
      height: cropped.height + depth,
    };
  }
  if (cropped.x === 0 && cropped.width < vw) {
    // left strip
    return { ...cropped, width: cropped.width + depth };
  }
  if (cropped.x + cropped.width === vw) {
    // right strip
    return {
      x: cropped.x - depth,
      y: cropped.y,
      width: cropped.width + depth,
      height: cropped.height,
    };
  }
  return cropped;
}

class FogOverlay extends Component {
  private readonly renderer = this.service(RendererKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private lastKey = "";

  update(): void {
    const rects = this.renderer.croppedVirtualRects;
    const key = rects.map((r) => `${r.x},${r.y},${r.width},${r.height}`).join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.graphics.graphics;
    g.clear();
    for (const cropped of rects) {
      const r = expandInward(cropped, FOG_INWARD_DEPTH, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
      g.rect(r.x, r.y, r.width, r.height).fill({ color: 0x000000, alpha: 0.55 });
    }
  }
}

// ---------------------------------------------------------------------------
// ReadoutUpdater — prints canvas size + visible + cropped rects below canvas.
// ---------------------------------------------------------------------------
class ReadoutUpdater extends Component {
  private readonly renderer = this.service(RendererKey);
  private last = "";

  update(): void {
    const c = this.renderer.canvasSize;
    const v = this.renderer.visibleVirtualRect;
    const cropped = this.renderer.croppedVirtualRects.length;
    const text =
      `canvas ${Math.round(c.width)}×${Math.round(c.height)} CSS  │  ` +
      `visible { x: ${Math.round(v.x)}, y: ${Math.round(v.y)}, ` +
      `w: ${Math.round(v.width)}, h: ${Math.round(v.height)} }  │  ` +
      `cropped rects: ${cropped}`;
    if (text !== this.last) {
      this.last = text;
      readout.textContent = text;
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const HUD_COLORS: Record<Corner, { fill: number; stroke: number }> = {
  topLeft: { fill: 0x22c55e, stroke: 0x16a34a },
  topRight: { fill: 0xf97316, stroke: 0xea580c },
  bottomLeft: { fill: 0x38bdf8, stroke: 0x0ea5e9 },
  bottomRight: { fill: 0xa78bfa, stroke: 0x7c3aed },
};

class ResponsiveUIScene extends Scene {
  readonly name = "responsive-ui";
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: "fog", order: 50, space: "screen" },
    { name: "hud", order: 100, space: "screen" },
  ];

  onEnter(): void {
    // Play-area grid spanning the full declared virtual rect.
    const playArea = this.spawn("play-area");
    playArea.add(new Transform());
    playArea.add(
      new GraphicsComponent({ layer: "world" }).draw((g) => {
        for (let x = 0; x <= VIRTUAL_WIDTH; x += 50) {
          g.moveTo(x, 0).lineTo(x, VIRTUAL_HEIGHT).stroke({ color: 0x1f2937, width: 1 });
        }
        for (let y = 0; y <= VIRTUAL_HEIGHT; y += 50) {
          g.moveTo(0, y).lineTo(VIRTUAL_WIDTH, y).stroke({ color: 0x1f2937, width: 1 });
        }
        g.rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT).stroke({
          color: 0x475569,
          width: 3,
        });
        g.moveTo(VIRTUAL_WIDTH / 2 - 20, VIRTUAL_HEIGHT / 2)
          .lineTo(VIRTUAL_WIDTH / 2 + 20, VIRTUAL_HEIGHT / 2)
          .stroke({ color: 0x64748b, width: 2 });
        g.moveTo(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 - 20)
          .lineTo(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 + 20)
          .stroke({ color: 0x64748b, width: 2 });
      }),
    );

    // Bouncing balls across the full virtual rect. Some positions will be
    // off-screen on narrow aspects — demonstrates gameplay-continues-in-crop.
    const palette = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0xa855f7];
    for (let i = 0; i < 10; i++) {
      const radius = 12 + Math.random() * 10;
      const x = radius + Math.random() * (VIRTUAL_WIDTH - 2 * radius);
      const y = radius + Math.random() * (VIRTUAL_HEIGHT - 2 * radius);
      const vx = (Math.random() - 0.5) * 200;
      const vy = (Math.random() - 0.5) * 200;
      const color = palette[i % palette.length]!;
      const ball = this.spawn(`ball-${i}`);
      ball.add(new Transform({ position: new Vec2(x, y) }));
      ball.add(
        new GraphicsComponent({ layer: "world" }).draw((g) => {
          g.circle(0, 0, radius).fill({ color, alpha: 0.85 });
          g.circle(0, 0, radius).stroke({ color: 0xffffff, width: 1, alpha: 0.4 });
        }),
      );
      ball.add(new BouncingBall(vx, vy, radius));
    }

    // Fog layer — redraws when croppedVirtualRects changes.
    const fog = this.spawn("fog");
    fog.add(new Transform());
    fog.add(new GraphicsComponent({ layer: "fog" }));
    fog.add(new FogOverlay());

    // HUD cards anchored to visibleVirtualRect corners.
    for (const corner of Object.keys(HUD_COLORS) as Corner[]) {
      const meta = HUD_COLORS[corner];
      const card = this.spawn(`hud-${corner}`);
      card.add(new Transform());
      card.add(
        new GraphicsComponent({ layer: "hud" }).draw((g) => {
          const w = 110;
          const h = 44;
          const dx = corner === "topLeft" || corner === "bottomLeft" ? 0 : -w;
          const dy = corner === "topLeft" || corner === "topRight" ? 0 : -h;
          g.rect(dx, dy, w, h).fill({ color: 0x111827, alpha: 0.9 });
          g.rect(dx, dy, w, h).stroke({ color: meta.stroke, width: 2 });
          g.circle(dx + 14, dy + h / 2, 5).fill({ color: meta.fill });
        }),
      );
      card.add(new HudAnchor(corner));
    }

    // Live readout
    const info = this.spawn("readout");
    info.add(new Transform());
    info.add(new ReadoutUpdater());
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine();

  engine.use(
    new RendererPlugin({
      width: VIRTUAL_WIDTH,
      height: VIRTUAL_HEIGHT,
      backgroundColor: 0x0f172a,
      container,
      fit: { mode: "cover" },
    }),
  );

  await engine.start();
  await engine.scenes.push(new ResponsiveUIScene());
}

main().catch(console.error);

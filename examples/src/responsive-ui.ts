/**
 * Responsive UI with a fixed-ratio play area + fog beyond it.
 *
 * Demonstrates `fit: "expand"` together with `visibleCanvasRect`,
 * `extendedVirtualRects`, and `virtualCanvasRect`. The play area
 * (VIRTUAL_WIDTH × VIRTUAL_HEIGHT) is always fully visible — like letterbox.
 * But instead of black bars, the game draws into the leftover canvas space:
 * the grid extends across the whole visible canvas, and a fog overlay covers
 * the bars so the player can see "there's world here, but it's not the play
 * area." HUD cards anchor to the canvas corners so they land in the bars
 * whenever aspect mismatches.
 *
 * Layers:
 *   grid  — world-space, draws over `visibleCanvasRect` (extends into bars).
 *   balls — world-space, bouncing against `visibleCanvasRect` so they roam
 *           across the entire canvas (through the bars) rather than being
 *           confined to the declared virtual rect.
 *   fog   — screen-space, semi-opaque bands over `extendedVirtualRects`. Each
 *           strip is a solid fog rect plus a short gradient on the edge that
 *           touches the play area (transitioning to transparent), so the
 *           boundary softens without blurring the outer canvas edge.
 *   hud   — screen-space, corner cards tracking `visibleCanvasRect` corners.
 */
import { Engine, Scene, Component, Transform, Vec2 } from "@yagejs/core";
import {
  RendererPlugin,
  RendererKey,
  GraphicsComponent,
  TextComponent,
  linearGradient,
} from "@yagejs/renderer";
import type { GradientFill, LayerDef } from "@yagejs/renderer";
import { injectStyles, getContainer } from "./shared.js";

injectStyles(`
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
readout.textContent = "Resize the browser — the grid extends into the bars, fog marks the out-of-bounds area";
document.body.appendChild(readout);

const VIRTUAL_WIDTH = 800;
const VIRTUAL_HEIGHT = 600;
const FOG_ALPHA = 0.78;
// Width (in virtual px) of the gradient band on the edge of each fog strip
// that touches the play area — the rest of the strip is solid fog.
const FOG_GRADIENT_WIDTH = 40;

const container = getContainer();

// ---------------------------------------------------------------------------
// HudAnchor — places an entity at a corner of `visibleCanvasRect`, i.e. the
// canvas corners expressed in virtual-space coords. Under `expand`, these
// corners live in the bars whenever aspect mismatches.
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
    const { x, y, width, height } = this.renderer.visibleCanvasRect;
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
// BouncingBall — bounces against `visibleCanvasRect`, i.e. the full canvas
// expressed in virtual-space coords. Under `expand` this means balls travel
// through the bars rather than being confined to the declared virtual rect.
// ---------------------------------------------------------------------------
class BouncingBall extends Component {
  private readonly renderer = this.service(RendererKey);
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
    const bounds = this.renderer.visibleCanvasRect;
    const minX = bounds.x + this.radius;
    const maxX = bounds.x + bounds.width - this.radius;
    const minY = bounds.y + this.radius;
    const maxY = bounds.y + bounds.height - this.radius;

    const p = this.transform.position;
    let nx = p.x + this.velocity.x * dtSec;
    let ny = p.y + this.velocity.y * dtSec;
    if (nx < minX || nx > maxX) {
      this.velocity = new Vec2(-this.velocity.x, this.velocity.y);
      nx = Math.min(Math.max(nx, minX), maxX);
    }
    if (ny < minY || ny > maxY) {
      this.velocity = new Vec2(this.velocity.x, -this.velocity.y);
      ny = Math.min(Math.max(ny, minY), maxY);
    }
    this.transform.setPosition(nx, ny);
  }
}

// ---------------------------------------------------------------------------
// GridRedraw — renders the grid every time the canvas extent changes so it
// always reaches the canvas edges (not just inside the virtual rect).
// ---------------------------------------------------------------------------
class GridRedraw extends Component {
  private readonly renderer = this.service(RendererKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private lastKey = "";

  update(): void {
    const v = this.renderer.visibleCanvasRect;
    const key = `${v.x},${v.y},${v.width},${v.height}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    // Align gridlines to a 50-px lattice based at the virtual origin, then
    // extend past the canvas edges on every side so lines reach into the bars.
    const step = 50;
    const xStart = Math.floor(v.x / step) * step;
    const xEnd = Math.ceil((v.x + v.width) / step) * step;
    const yStart = Math.floor(v.y / step) * step;
    const yEnd = Math.ceil((v.y + v.height) / step) * step;

    const g = this.graphics.graphics;
    g.clear();
    for (let x = xStart; x <= xEnd; x += step) {
      g.moveTo(x, yStart).lineTo(x, yEnd).stroke({ color: 0x1f2937, width: 1 });
    }
    for (let y = yStart; y <= yEnd; y += step) {
      g.moveTo(xStart, y).lineTo(xEnd, y).stroke({ color: 0x1f2937, width: 1 });
    }
    // Center crosshair.
    g.moveTo(VIRTUAL_WIDTH / 2 - 20, VIRTUAL_HEIGHT / 2)
      .lineTo(VIRTUAL_WIDTH / 2 + 20, VIRTUAL_HEIGHT / 2)
      .stroke({ color: 0x64748b, width: 2 });
    g.moveTo(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 - 20)
      .lineTo(VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2 + 20)
      .stroke({ color: 0x64748b, width: 2 });
  }
}

// ---------------------------------------------------------------------------
// FogOverlay — each `extendedVirtualRect` becomes a solid fog rect plus a
// short gradient band on the edge touching the play area. The gradient
// transitions from full fog alpha to 0 right at the virtual boundary.
// ---------------------------------------------------------------------------
// Pre-built gradient fills, one per direction/orientation pair. `space:
// "local"` makes each gradient scale to whatever rect it's applied to, so one
// instance covers every top/bottom/left/right band regardless of strip size.
function makeFogGradient(
  axis: "horizontal" | "vertical",
  direction: "opaqueToClear" | "clearToOpaque",
): GradientFill {
  const opaque = { color: 0x000000, alpha: FOG_ALPHA };
  const clear = { color: 0x000000, alpha: 0 };
  return linearGradient({
    axis,
    stops: [
      { offset: 0, ...(direction === "opaqueToClear" ? opaque : clear) },
      { offset: 1, ...(direction === "opaqueToClear" ? clear : opaque) },
    ],
  });
}

class FogOverlay extends Component {
  private readonly renderer = this.service(RendererKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly gradTopInner = makeFogGradient("vertical", "opaqueToClear");
  private readonly gradBottomInner = makeFogGradient("vertical", "clearToOpaque");
  private readonly gradLeftInner = makeFogGradient("horizontal", "opaqueToClear");
  private readonly gradRightInner = makeFogGradient("horizontal", "clearToOpaque");
  private lastKey = "";

  update(): void {
    const rects = this.renderer.extendedVirtualRects;
    const key = rects
      .map((r) => `${r.x},${r.y},${r.width},${r.height}`)
      .join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.graphics.graphics;
    g.clear();

    for (const r of rects) {
      // Each extended strip is flush to exactly one edge of the virtual rect
      // (letterbox/expand scales on one axis only, so top+bottom OR left+right
      // pairs, never corner-mixed).
      const EPS = 0.5;
      const atTop = r.y + r.height <= EPS;
      const atBottom = r.y >= VIRTUAL_HEIGHT - EPS;
      const atLeft = r.x + r.width <= EPS;
      const atRight = r.x >= VIRTUAL_WIDTH - EPS;

      const axisSize = atTop || atBottom ? r.height : r.width;
      const gradW = Math.min(FOG_GRADIENT_WIDTH, axisSize);
      const bulk = axisSize - gradW;

      if (atTop) {
        if (bulk > 0) {
          g.rect(r.x, r.y, r.width, bulk).fill({ color: 0x000000, alpha: FOG_ALPHA });
        }
        g.rect(r.x, r.y + bulk, r.width, gradW).fill(this.gradTopInner);
      } else if (atBottom) {
        g.rect(r.x, r.y, r.width, gradW).fill(this.gradBottomInner);
        if (bulk > 0) {
          g.rect(r.x, r.y + gradW, r.width, bulk).fill({ color: 0x000000, alpha: FOG_ALPHA });
        }
      } else if (atLeft) {
        if (bulk > 0) {
          g.rect(r.x, r.y, bulk, r.height).fill({ color: 0x000000, alpha: FOG_ALPHA });
        }
        g.rect(r.x + bulk, r.y, gradW, r.height).fill(this.gradLeftInner);
      } else if (atRight) {
        g.rect(r.x, r.y, gradW, r.height).fill(this.gradRightInner);
        if (bulk > 0) {
          g.rect(r.x + gradW, r.y, bulk, r.height).fill({ color: 0x000000, alpha: FOG_ALPHA });
        }
      }
    }
  }

  onRemove(): void {
    this.gradTopInner.destroy();
    this.gradBottomInner.destroy();
    this.gradLeftInner.destroy();
    this.gradRightInner.destroy();
  }
}

// ---------------------------------------------------------------------------
// ReadoutUpdater — prints the current fit state for debugging.
// ---------------------------------------------------------------------------
class ReadoutUpdater extends Component {
  private readonly renderer = this.service(RendererKey);
  private last = "";

  update(): void {
    const c = this.renderer.canvasSize;
    const vc = this.renderer.visibleCanvasRect;
    const vcr = this.renderer.virtualCanvasRect;
    const bars = this.renderer.extendedVirtualRects.length;
    const text =
      `canvas ${Math.round(c.width)}×${Math.round(c.height)} CSS  │  ` +
      `play area on canvas ${Math.round(vcr.x)},${Math.round(vcr.y)} ` +
      `${Math.round(vcr.width)}×${Math.round(vcr.height)}  │  ` +
      `visible (virtual) { x: ${Math.round(vc.x)}, y: ${Math.round(vc.y)}, ` +
      `w: ${Math.round(vc.width)}, h: ${Math.round(vc.height)} }  │  ` +
      `bars: ${bars}`;
    if (text !== this.last) {
      this.last = text;
      readout.textContent = text;
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const HUD_CARDS: Record<
  Corner,
  { fill: number; stroke: number; label: string; value: string }
> = {
  topLeft: { fill: 0x22c55e, stroke: 0x16a34a, label: "SCORE", value: "12,340" },
  topRight: { fill: 0xf97316, stroke: 0xea580c, label: "WAVE", value: "03" },
  bottomLeft: { fill: 0x38bdf8, stroke: 0x0ea5e9, label: "HP", value: "78%" },
  bottomRight: { fill: 0xa78bfa, stroke: 0x7c3aed, label: "TIME", value: "01:42" },
};

class ResponsiveUIScene extends Scene {
  readonly name = "responsive-ui";
  readonly layers: readonly LayerDef[] = [
    { name: "grid", order: 0 },
    { name: "balls", order: 10 },
    { name: "fog", order: 50, space: "screen" },
    { name: "hud", order: 100, space: "screen" },
  ];

  onEnter(): void {
    // Grid — drawn dynamically so it reaches the canvas edges on every resize.
    const grid = this.spawn("grid");
    grid.add(new Transform());
    grid.add(new GraphicsComponent({ layer: "grid" }));
    grid.add(new GridRedraw());

    // Balls — bouncing across the full `visibleCanvasRect`, so they roam
    // through the expand bars; initial spawn stays inside the virtual rect
    // to guarantee visibility on the first frame.
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
        new GraphicsComponent({ layer: "balls" }).draw((g) => {
          g.circle(0, 0, radius).fill({ color, alpha: 0.95 });
          g.circle(0, 0, radius).stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
        }),
      );
      ball.add(new BouncingBall(vx, vy, radius));
    }

    // Fog overlay covering `extendedVirtualRects` (the bars).
    const fog = this.spawn("fog");
    fog.add(new Transform());
    fog.add(new GraphicsComponent({ layer: "fog" }));
    fog.add(new FogOverlay());

    // HUD corners anchored to the canvas corners (in virtual coords). Each
    // card is a parent entity holding the backdrop graphics; the label/value
    // text ride as child entities, so their Transform auto-tracks the anchor.
    const CARD_W = 120;
    const CARD_H = 44;
    for (const corner of Object.keys(HUD_CARDS) as Corner[]) {
      const meta = HUD_CARDS[corner];
      const dx = corner === "topLeft" || corner === "bottomLeft" ? 0 : -CARD_W;
      const dy = corner === "topLeft" || corner === "topRight" ? 0 : -CARD_H;

      const card = this.spawn(`hud-${corner}`);
      card.add(new Transform());
      card.add(
        new GraphicsComponent({ layer: "hud" }).draw((g) => {
          g.rect(dx, dy, CARD_W, CARD_H).fill({ color: 0x111827, alpha: 0.9 });
          g.rect(dx, dy, CARD_W, CARD_H).stroke({ color: meta.stroke, width: 2 });
          g.circle(dx + 14, dy + CARD_H / 2, 5).fill({ color: meta.fill });
        }),
      );
      card.add(new HudAnchor(corner));

      const label = card.spawnChild("label");
      label.add(new Transform({ position: new Vec2(dx + 28, dy + 7) }));
      label.add(
        new TextComponent({
          text: meta.label,
          layer: "hud",
          style: {
            fontFamily: "ui-monospace, monospace",
            fontSize: 10,
            fill: 0x94a3b8,
            letterSpacing: 1,
          },
        }),
      );

      const value = card.spawnChild("value");
      value.add(new Transform({ position: new Vec2(dx + 28, dy + 21) }));
      value.add(
        new TextComponent({
          text: meta.value,
          layer: "hud",
          style: {
            fontFamily: "ui-monospace, monospace",
            fontSize: 14,
            fill: 0xf8fafc,
            fontWeight: "bold",
          },
        }),
      );
    }

    // Live readout.
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
      fit: { mode: "expand" },
    }),
  );

  await engine.start();
  await engine.scenes.push(new ResponsiveUIScene());
}

main().catch(console.error);

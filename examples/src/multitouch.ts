import {
  Component,
  Engine,
  Scene,
  Transform,
  Vec2,
} from "@yagejs/core";
import {
  GraphicsComponent,
  RendererPlugin,
  TextComponent,
} from "@yagejs/renderer";
import {
  InputManagerKey,
  InputPlugin,
  type PointerInfo,
} from "@yagejs/input";
import { injectStyles, setupGameContainer } from "./shared.js";

injectStyles(`
  /* Stop iOS / Android from interpreting touches as scroll, zoom, or
     long-press selection on the canvas. Without this the second finger's
     events get hijacked by the browser before YAGE sees them. */
  #game-container { touch-action: none; user-select: none; -webkit-user-select: none; }
`);

const WIDTH = 800;
const HEIGHT = 600;
const TRAIL_LENGTH = 24;
const RIPPLE_DURATION = 600;        // ms

interface PointerTrail {
  /** Recent screen-space positions for this pointer, newest at the end. */
  positions: Vec2[];
  type: "mouse" | "pen" | "touch";
  isPrimary: boolean;
  isDown: boolean;
}

interface Ripple {
  position: Vec2;
  start: number;
  color: number;
}

/**
 * Watches every active pointer (mouse, pen, finger) and renders a labeled
 * disk + fading trail under each one. Showcases:
 *   - `getPointers()` for the synchronous "what's down right now" snapshot
 *   - `onPointerDown / Move / Up` hooks for per-pointer lifecycle tracking
 *   - `pointerType` so the UI can tell mouse from touch
 *   - `isPrimary` so the primary contact is highlighted
 *   - Tap-to-ripple via the same `onPointerDown` callback
 */
class MultitouchVisualizer extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly graphics = this.sibling(GraphicsComponent);
  private readonly trails = new Map<number, PointerTrail>();
  private readonly ripples: Ripple[] = [];
  private elapsed = 0;
  private disposers: Array<() => void> = [];

  override onAdd(): void {
    this.disposers.push(
      this.input.onPointerDown((p) => {
        this.upsertTrail(p);
        this.ripples.push({
          position: new Vec2(p.screenPos.x, p.screenPos.y),
          start: this.elapsed,
          color: colorForId(p.id),
        });
        if (this.ripples.length > 32) this.ripples.shift();
      }),
      this.input.onPointerMove((p) => this.upsertTrail(p)),
      this.input.onPointerUp((p) => {
        const trail = this.trails.get(p.id);
        if (trail) trail.isDown = false;
        // Touches vanish from getPointers() once they release; drop the trail
        // shortly after so the user sees the release without a stale finger.
        // (Mouse stays in getPointers naturally, so we keep its trail.)
        if (p.type !== "mouse") {
          setTimeout(() => this.trails.delete(p.id), 0);
        }
      }),
    );
  }

  override onRemove(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
  }

  private upsertTrail(p: PointerInfo): void {
    let trail = this.trails.get(p.id);
    if (!trail) {
      trail = {
        positions: [],
        type: p.type,
        isPrimary: p.isPrimary,
        isDown: p.isDown,
      };
      this.trails.set(p.id, trail);
    } else {
      trail.type = p.type;
      trail.isPrimary = p.isPrimary;
      trail.isDown = p.isDown;
    }
    trail.positions.push(new Vec2(p.screenPos.x, p.screenPos.y));
    if (trail.positions.length > TRAIL_LENGTH) trail.positions.shift();
  }

  override update(dt: number): void {
    this.elapsed += dt;

    // Drop ripples that finished animating.
    while (this.ripples.length > 0) {
      const oldest = this.ripples[0]!;
      if (this.elapsed - oldest.start > RIPPLE_DURATION) this.ripples.shift();
      else break;
    }

    this.graphics.draw((g) => {
      g.clear();

      // Ripples (drawn beneath pointer disks)
      for (const r of this.ripples) {
        const t = (this.elapsed - r.start) / RIPPLE_DURATION;
        const radius = 12 + t * 80;
        const alpha = 1 - t;
        g.circle(r.position.x, r.position.y, radius).stroke({
          color: r.color,
          width: 3,
          alpha,
        });
      }

      // Pointers
      for (const [id, trail] of this.trails) {
        if (trail.positions.length === 0) continue;
        const head = trail.positions[trail.positions.length - 1]!;
        const color = colorForId(id);

        // Trail: line connecting recent samples, fading out toward the tail.
        for (let i = 1; i < trail.positions.length; i++) {
          const a = trail.positions[i - 1]!;
          const b = trail.positions[i]!;
          const alpha = i / trail.positions.length;
          g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({
            color,
            width: 3,
            alpha: alpha * 0.6,
          });
        }

        // Disk under the pointer — solid when down, hollow when hovering.
        const radius = trail.isPrimary ? 26 : 20;
        if (trail.isDown) {
          g.circle(head.x, head.y, radius).fill({ color, alpha: 0.55 });
        }
        g.circle(head.x, head.y, radius).stroke({
          color,
          width: trail.isPrimary ? 4 : 2,
        });

        // Crosshair at center
        g.moveTo(head.x - 6, head.y).lineTo(head.x + 6, head.y).stroke({
          color: 0xffffff,
          width: 1,
        });
        g.moveTo(head.x, head.y - 6).lineTo(head.x, head.y + 6).stroke({
          color: 0xffffff,
          width: 1,
        });
      }
    });
  }
}

/** Stable color hash from a pointer id. */
function colorForId(id: number): number {
  // Six well-separated hues; primary mouse pointer (id ~1) lands on cyan.
  const palette = [0x22d3ee, 0xfacc15, 0xf472b6, 0x4ade80, 0xa78bfa, 0xfb923c];
  // Touch pointer ids are large + browser-assigned; mod into palette.
  const idx = Math.abs(id) % palette.length;
  return palette[idx]!;
}

/**
 * Top-of-screen HUD: live count, primary-pointer hint, per-pointer rows.
 */
class PointerHud extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly headerText: TextComponent;
  private readonly listText: TextComponent;

  constructor(headerText: TextComponent, listText: TextComponent) {
    super();
    this.headerText = headerText;
    this.listText = listText;
  }

  override update(): void {
    const pointers = this.input.getPointers();
    const touchCount = pointers.filter((p) => p.type === "touch").length;
    const downCount = pointers.filter((p) => p.isDown).length;

    if (pointers.length === 0) {
      this.headerText.setText("Touch the screen with one or more fingers.");
    } else if (touchCount > 0) {
      this.headerText.setText(
        `${pointers.length} pointer${pointers.length === 1 ? "" : "s"} active — ${downCount} held down`,
      );
    } else {
      this.headerText.setText(
        `Mouse hovering · click and drag to leave a trail`,
      );
    }

    // Per-pointer rows. Sorted by id so the primary (lowest id from browsers)
    // shows first.
    const lines = [...pointers]
      .sort((a, b) => a.id - b.id)
      .map((p) => {
        const tag = p.isPrimary ? "★" : "·";
        const state = p.isDown ? "DOWN" : "hover";
        return `${tag} id:${p.id}  ${p.type.padEnd(5)}  ${state}  (${Math.round(p.screenPos.x)}, ${Math.round(p.screenPos.y)})`;
      });
    this.listText.setText(lines.join("\n") || "—");
  }
}

class MultitouchScene extends Scene {
  readonly name = "multitouch";

  onEnter(): void {
    // Visualizer — owns the canvas-sized GraphicsComponent at origin so the
    // disks / trails / ripples are positioned in raw screen space.
    const viz = this.spawn("visualizer");
    viz.add(new Transform({ position: new Vec2(0, 0) }));
    viz.add(new GraphicsComponent());
    viz.add(new MultitouchVisualizer());

    // HUD header text
    const headerEntity = this.spawn("hud-header");
    headerEntity.add(new Transform({ position: new Vec2(20, 20) }));
    const headerText = headerEntity.add(
      new TextComponent({
        text: "",
        style: { fontFamily: "system-ui, sans-serif", fontSize: 14, fill: 0xe2e8f0 },
      }),
    );

    // Per-pointer list
    const listEntity = this.spawn("hud-list");
    listEntity.add(new Transform({ position: new Vec2(20, 50) }));
    const listText = listEntity.add(
      new TextComponent({
        text: "—",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          fill: 0x94a3b8,
          lineHeight: 18,
        },
      }),
    );

    headerEntity.add(new PointerHud(headerText, listText));

    // Footer hint
    const footer = this.spawn("footer");
    footer.add(new Transform({ position: new Vec2(20, HEIGHT - 28) }));
    footer.add(
      new TextComponent({
        text:
          "Each pointer gets its own color and trail. ★ marks the primary contact. " +
          "Tap to ripple.",
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          fill: 0x64748b,
        },
      }),
    );
  }
}

async function main() {
  const engine = new Engine();

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );

  engine.use(new InputPlugin());

  await engine.start();
  await engine.scenes.push(new MultitouchScene());
}

main().catch(console.error);

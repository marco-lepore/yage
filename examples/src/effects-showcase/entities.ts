import {
  Entity,
  Transform,
  Vec2,
  createRandomService,
  serializable,
} from "@yagejs/core";
import {
  GraphicsComponent,
  linearGradient,
  radialGradient,
} from "@yagejs/renderer";
import { hitFlash } from "@yagejs/effects";
import type { HitFlashHandle } from "@yagejs/effects";
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT } from "./constants.js";

/** Colourful, detailed backdrop so subtle effects stay visible. Lives on
 * the "background" layer below the world. */
@serializable
export class BackgroundEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(0, 0) }));
    this.add(new GraphicsComponent({ layer: "background" }));
    this.redraw();
  }

  afterRestore(): void {
    this.redraw();
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      const sky = linearGradient({
        axis: "vertical",
        stops: [
          { offset: 0, color: 0x1e1b4b },
          { offset: 0.5, color: 0x312e81 },
          { offset: 1, color: 0x065f46 },
        ],
      });
      ctx.rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT).fill(sky);

      const sun = radialGradient({
        center: { x: 0.25, y: 0.25 },
        outerRadius: 0.7,
        stops: [
          { offset: 0, color: 0xfde68a, alpha: 0.4 },
          { offset: 1, color: 0xfde68a, alpha: 0 },
        ],
        space: "local",
      });
      ctx.rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT).fill(sun);

      // Grid lines so pixelate / chromaticAberration / CRT / halftone /
      // wave have geometry to chew on.
      const gridStep = 40;
      for (let x = 0; x <= VIRTUAL_WIDTH; x += gridStep) {
        ctx
          .moveTo(x, 0)
          .lineTo(x, VIRTUAL_HEIGHT)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
      }
      for (let y = 0; y <= VIRTUAL_HEIGHT; y += gridStep) {
        ctx
          .moveTo(0, y)
          .lineTo(VIRTUAL_WIDTH, y)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.06 });
      }

      const palette = [0xfacc15, 0xf472b6, 0x60a5fa, 0x34d399, 0xfb923c];
      const rng = createRandomService(1);
      for (let i = 0; i < 60; i++) {
        const x = rng.range(0, VIRTUAL_WIDTH);
        const y = rng.range(0, VIRTUAL_HEIGHT);
        const r = rng.range(1, 3.5);
        const color = rng.pick(palette);
        ctx.circle(x, y, r).fill({ color, alpha: 0.65 });
      }
    });
  }
}

/** Blue circle with the demo's pre-attached hitFlash effect. */
@serializable
export class HeroEntity extends Entity {
  flashHandle: HitFlashHandle | null = null;

  setup(): void {
    this.add(new Transform({ position: new Vec2(150, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
    this.attachHitFlash();
  }

  afterRestore(): void {
    this.redraw();
    const g = this.tryGet(GraphicsComponent);
    this.flashHandle = g?.fx.findEffect(hitFlash) ?? null;
    if (!this.flashHandle) this.attachHitFlash();
  }

  private attachHitFlash(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    this.flashHandle = g.fx.addEffect(
      hitFlash({ color: 0xffffff, duration: 0.2 }),
    );
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      ctx.circle(0, 0, 60).fill({ color: 0x38bdf8 });
      ctx.circle(0, 0, 60).stroke({ color: 0x0ea5e9, width: 4 });
    });
  }
}

/** Orange square — outline / dropShadow target. */
@serializable
export class BlockEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(310, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
  }

  afterRestore(): void {
    this.redraw();
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      ctx.rect(-60, -60, 120, 120).fill({ color: 0xf97316 });
      ctx.rect(-60, -60, 120, 120).stroke({ color: 0xfb923c, width: 2 });
    });
  }
}

/** Green diamond — glow target. */
@serializable
export class GemEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(490, 320) }));
    this.add(new GraphicsComponent({ layer: "world" }));
    this.redraw();
  }

  afterRestore(): void {
    this.redraw();
  }

  private redraw(): void {
    const g = this.tryGet(GraphicsComponent);
    if (!g) return;
    g.draw((ctx) => {
      ctx.clear();
      ctx.poly([0, -55, 50, 0, 0, 55, -50, 0]).fill({ color: 0x22c55e });
      ctx.poly([0, -55, 50, 0, 0, 55, -50, 0]).stroke({
        color: 0x16a34a,
        width: 3,
      });
    });
  }
}

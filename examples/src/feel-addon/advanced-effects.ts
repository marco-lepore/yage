import { Transform, type Vec2 } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { axisBlur, implosion, zoomBlur } from "@yagejs/effects";
import { Feel, feelParallel } from "@yagejs-addons/feel";
import {
  feelDissolve,
  feelEffect,
  feelGlitch,
} from "@yagejs-addons/feel/renderer";
import { voidCollapse } from "@yagejs-addons/feel/recipes";
import { FeelDemo } from "./gallery.js";

// ---------------------------------------------------------------------------
// 1  Glitch
// ---------------------------------------------------------------------------

export class GlitchDemo extends FeelDemo {
  readonly label = "seeded glitch";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-62, -45, 124, 90, 8).fill({ color: 0x111827 });
        for (let index = 0; index < 5; index++) {
          g.rect(-50, -32 + index * 16, 100, 8).fill({
            color: index % 2 === 0 ? 0x22d3ee : 0xf472b6,
          });
        }
        g.circle(0, 0, 13).fill({ color: 0xf8fafc });
      }),
    );
    this.add(
      new Feel({
        show: feelGlitch({
          host: visual.fx,
          duration: 0.65,
          slices: 9,
          offset: 28,
          red: { x: 7, y: 0 },
          blue: { x: -7, y: 0 },
          refreshRate: 18,
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 2  Zoom + axis blur
// ---------------------------------------------------------------------------

export class SpeedBlurDemo extends FeelDemo {
  readonly label = "zoom + axis blur";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        for (let ring = 3; ring >= 1; ring--) {
          g.circle(0, 0, ring * 18).stroke({
            color: ring % 2 === 0 ? 0x60a5fa : 0xe0f2fe,
            width: 7,
          });
        }
        g.poly([0, -32, 28, 26, 0, 14, -28, 26]).fill({
          color: 0xf8fafc,
        });
      }),
    );
    this.add(
      new Feel({
        show: feelParallel(
          feelEffect(
            visual.fx,
            zoomBlur({ strength: 0.32, innerRadius: 8, radius: 90 }),
            { duration: 0.55 },
          ),
          feelEffect(
            visual.fx,
            axisBlur({ axis: "horizontal", strength: 16, quality: 2 }),
            { duration: 0.55, peakAt: 0.35 },
          ),
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 3  Implosion primitive
// ---------------------------------------------------------------------------

export class ImplosionDemo extends FeelDemo {
  readonly label = "implosion primitive";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 64).fill({ color: 0x312e81 });
        for (let index = 0; index < 8; index++) {
          const angle = (index / 8) * Math.PI * 2;
          const orbit = index % 2 === 0 ? 28 : 46;
          g.circle(Math.cos(angle) * orbit, Math.sin(angle) * orbit, 8).fill({
            color: index % 2 === 0 ? 0xc4b5fd : 0x67e8f9,
          });
        }
        g.circle(0, 0, 12).fill({ color: 0xf8fafc });
      }),
    );
    this.add(
      new Feel({
        show: feelEffect(
          visual.fx,
          implosion({
            radius: 68,
            strength: 1,
            darkness: 0.92,
            swirl: 0.7,
            expandFromCenter: true,
          }),
          { duration: 0.7, peakAt: 0.65 },
        ),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 4  Recipe: void collapse
// ---------------------------------------------------------------------------

export class VoidCollapseDemo extends FeelDemo {
  readonly label = "void collapse recipe";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        for (let index = 0; index < 14; index++) {
          const angle = (index / 14) * Math.PI * 2;
          const orbitX = Math.cos(angle) * (92 + (index % 3) * 14);
          const orbitY = Math.sin(angle) * (48 + (index % 2) * 12);
          g.circle(orbitX, orbitY, 3 + (index % 3)).fill({
            color: index % 2 === 0 ? 0x67e8f9 : 0xc4b5fd,
          });
        }
        g.circle(0, 0, 56).fill({ color: 0x172554 });
        g.circle(0, 0, 46).stroke({ color: 0x818cf8, width: 7 });
        g.circle(0, 0, 30).stroke({ color: 0x22d3ee, width: 5 });
        g.circle(0, 0, 14).fill({ color: 0xe0e7ff });
      }),
    );
    this.add(
      new Feel({
        show: voidCollapse({
          host: visual.fx,
          radius: 132,
          strength: 1,
          darkness: 1,
          swirl: 0.72,
          zoomStrength: -0.5,
          implosionDelay: 0.08,
          holdDuration: 0.22,
          color: 0x7c3aed,
          colorStrength: 0.72,
          duration: 1.05,
          peakAt: 0.48,
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// 5  Dissolve out
// ---------------------------------------------------------------------------

export class DissolveDemo extends FeelDemo {
  readonly label = "dissolve primitive";

  setup(params: { position: Vec2 }): void {
    this.add(new Transform({ position: params.position }));
    const visual = this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(-57, -53, 114, 106, 22).fill({ color: 0x4c1d95 });
        g.circle(-20, -7, 10).fill({ color: 0xe0e7ff });
        g.circle(20, -7, 10).fill({ color: 0xe0e7ff });
        g.moveTo(-25, 23)
          .quadraticCurveTo(0, 34, 25, 23)
          .stroke({ color: 0xc4b5fd, width: 6 });
      }),
    );
    this.add(
      new Feel({
        show: feelDissolve({
          target: visual,
          duration: 0.75,
          edgeColor: 0x22d3ee,
          edgeWidth: 0.12,
          noiseScale: 9,
          seed: 7,
        }),
      }),
    );
  }
}

import { MathUtils, type Entity, type Scene } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import type { VirtualStick } from "../core/stick.js";
import type { ControlView } from "../view.js";
import type { ControlsTheme } from "./theme.js";

/** How fast the knob glides back to center after release, 1/seconds. */
const KNOB_RETURN_SPEED = 18;
/** How fast the idle/active alpha fade runs, 1/seconds. */
const FADE_SPEED = 10;

/**
 * The built-in stick visual: a translucent base disc with a rim, and a knob
 * that tracks the finger exactly while engaged and glides back to center on
 * release. Draws in absolute virtual coords (the base recenters in
 * floating/follow modes), so the entity's transform stays at the origin.
 */
export class GraphicsStickView implements ControlView {
  private readonly entity: Entity;
  private readonly gfx: GraphicsComponent;
  private knobX: number;
  private knobY: number;
  private alpha: number;
  private visible = true;
  private disposed = false;
  private drawnBaseX = Number.NaN;
  private drawnBaseY = Number.NaN;
  private drawnKnobX = Number.NaN;
  private drawnKnobY = Number.NaN;
  private drawnRadius = Number.NaN;
  private drawnAlpha = Number.NaN;

  constructor(
    scene: Scene,
    private readonly stick: VirtualStick,
    private readonly theme: ControlsTheme,
  ) {
    this.entity = scene.spawn(`vc-stick-${stick.id}`);
    this.gfx = this.entity.add(
      new GraphicsComponent({ layer: theme.layer }),
    );
    const knob = stick.knobPos;
    this.knobX = knob.x;
    this.knobY = knob.y;
    this.alpha = theme.idleAlpha;
    this.redraw();
  }

  update(dt: number): void {
    if (this.disposed || !this.visible) return;
    const target = this.stick.knobPos;
    if (this.stick.active) {
      // Track the finger exactly — any lag here feels like input latency.
      this.knobX = target.x;
      this.knobY = target.y;
    } else {
      const k = Math.min(1, dt * KNOB_RETURN_SPEED);
      this.knobX = MathUtils.lerp(this.knobX, target.x, k);
      this.knobY = MathUtils.lerp(this.knobY, target.y, k);
    }
    const targetAlpha = this.stick.active
      ? this.theme.activeAlpha
      : this.theme.idleAlpha;
    this.alpha = MathUtils.lerp(
      this.alpha,
      targetAlpha,
      Math.min(1, dt * FADE_SPEED),
    );

    // Idle sticks settle — skip the Graphics rebuild (geometry re-tessellates
    // and re-uploads per redraw, a real cost on the mobile target).
    const base = this.stick.basePos;
    const radius = this.stick.layout.radius;
    if (
      base.x === this.drawnBaseX &&
      base.y === this.drawnBaseY &&
      radius === this.drawnRadius &&
      Math.abs(this.knobX - this.drawnKnobX) < 0.05 &&
      Math.abs(this.knobY - this.drawnKnobY) < 0.05 &&
      Math.abs(this.alpha - this.drawnAlpha) < 0.004
    ) {
      return;
    }
    this.redraw();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!this.disposed) this.gfx.graphics.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entity.destroy();
  }

  private redraw(): void {
    const t = this.theme;
    const base = this.stick.basePos;
    const radius = this.stick.layout.radius;
    const g = this.gfx.graphics;
    g.clear();
    g.circle(base.x, base.y, radius).fill({
      color: t.stickBaseColor,
      alpha: t.stickBaseAlpha * this.alpha,
    });
    g.circle(base.x, base.y, radius).stroke({
      width: t.stickBorderWidth,
      color: t.stickBorderColor,
      alpha: t.stickBorderAlpha * this.alpha,
    });
    g.circle(this.knobX, this.knobY, radius * t.knobScale).fill({
      color: t.stickKnobColor,
      alpha: t.stickKnobAlpha * this.alpha,
    });
    this.drawnBaseX = base.x;
    this.drawnBaseY = base.y;
    this.drawnKnobX = this.knobX;
    this.drawnKnobY = this.knobY;
    this.drawnRadius = radius;
    this.drawnAlpha = this.alpha;
  }
}

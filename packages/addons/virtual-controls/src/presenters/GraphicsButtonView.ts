import {
  MathUtils,
  Transform,
  Vec2,
  type Entity,
  type Scene,
} from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import type { VirtualButton } from "../core/button.js";
import type { ControlView } from "../view.js";
import type { ControlsTheme } from "./theme.js";

/** How fast the idle/active alpha fade runs, 1/seconds. */
const FADE_SPEED = 10;
/** Scale while pressed (the whole disc + label dips). */
const PRESSED_SCALE = 0.92;
/** Alpha multiplier while the button is disabled. */
const DISABLED_ALPHA = 0.45;

/**
 * The built-in button visual: a translucent disc with a rim and a centered
 * label. Pressing recolors the fill and dips the scale. The entity's
 * transform sits on the button center, so graphics + label draw at the local
 * origin and layout changes are a `setPosition`.
 */
export class GraphicsButtonView implements ControlView {
  private readonly entity: Entity;
  private readonly transform: Transform;
  private readonly gfx: GraphicsComponent;
  private readonly text: TextComponent;
  private alpha: number;
  private drawnPressed = false;
  private drawnRadius = 0;
  private drawnAlpha = 0;
  private globallyVisible = true;
  private disposed = false;

  constructor(
    scene: Scene,
    private readonly button: VirtualButton,
    private readonly theme: ControlsTheme,
  ) {
    const layout = button.layout;
    this.entity = scene.spawn(`vc-button-${button.id}`);
    this.transform = this.entity.add(
      new Transform({ position: new Vec2(layout.center.x, layout.center.y) }),
    );
    this.gfx = this.entity.add(new GraphicsComponent({ layer: theme.layer }));
    this.text = this.entity.add(
      new TextComponent({
        text: button.label,
        layer: theme.layer,
        anchor: { x: 0.5, y: 0.5 },
        alpha: theme.labelAlpha,
        style: {
          fontFamily: theme.fontFamily,
          fontSize: Math.max(8, Math.round(layout.radius * theme.labelScale)),
          fill: theme.labelColor,
        },
      }),
    );
    this.alpha = theme.idleAlpha;
    this.redraw();
  }

  update(dt: number): void {
    if (this.disposed) return;
    const visible = this.globallyVisible && this.button.visible;
    this.gfx.graphics.visible = visible;
    this.text.text.visible = visible;
    if (!visible) return;

    const layout = this.button.layout;
    this.transform.setPosition(layout.center.x, layout.center.y);

    const targetAlpha = !this.button.enabled
      ? this.theme.idleAlpha * DISABLED_ALPHA
      : this.button.pressed
        ? this.theme.activeAlpha
        : this.theme.idleAlpha;
    this.alpha = MathUtils.lerp(
      this.alpha,
      targetAlpha,
      Math.min(1, dt * FADE_SPEED),
    );
    this.text.text.alpha =
      this.theme.labelAlpha * (this.button.enabled ? 1 : DISABLED_ALPHA);

    const scale = this.button.pressed ? PRESSED_SCALE : 1;
    this.transform.setScale(scale, scale);

    if (
      this.button.pressed !== this.drawnPressed ||
      layout.radius !== this.drawnRadius ||
      Math.abs(this.alpha - this.drawnAlpha) > 0.004
    ) {
      if (layout.radius !== this.drawnRadius) {
        this.text.mergeStyle({
          fontSize: Math.max(
            8,
            Math.round(layout.radius * this.theme.labelScale),
          ),
        });
      }
      this.redraw();
    }
  }

  setVisible(visible: boolean): void {
    this.globallyVisible = visible;
    if (this.disposed) return;
    const shown = visible && this.button.visible;
    this.gfx.graphics.visible = shown;
    this.text.text.visible = shown;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entity.destroy();
  }

  private redraw(): void {
    const t = this.theme;
    const radius = this.button.layout.radius;
    const pressed = this.button.pressed;
    const g = this.gfx.graphics;
    g.clear();
    g.circle(0, 0, radius).fill({
      color: pressed ? t.buttonPressedColor : t.buttonColor,
      alpha: (pressed ? t.buttonPressedAlpha : t.buttonAlpha) * this.alpha,
    });
    g.circle(0, 0, radius).stroke({
      width: t.buttonBorderWidth,
      color: t.buttonBorderColor,
      alpha: t.buttonBorderAlpha * this.alpha,
    });
    this.drawnPressed = pressed;
    this.drawnRadius = radius;
    this.drawnAlpha = this.alpha;
  }
}

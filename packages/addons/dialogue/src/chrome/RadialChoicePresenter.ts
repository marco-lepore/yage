/**
 * A Mass-Effect-style radial choice wheel — an alternative {@link ChoicePresenter}
 * that proves the choice seam is swappable without touching the Session. Options
 * are placed evenly around a centre hub; the Session's up/down nav still cycles
 * them, and pointer hover/click works via {@link ChoicePresenter.choiceAtPoint}.
 *
 * @experimental This presenter is an unpolished spike. Geometry, hit radius, and
 * styling are intentionally minimal; the API may change. Reach it via the
 * `./presenters` subpath; it is not part of the default factory bundles.
 */

import { Transform, type Entity, type Scene } from "@yagejs/core";
import {
  GraphicsComponent,
  TextComponent,
  type TextComponentOptions,
  type TextStyle,
} from "@yagejs/renderer";
import type { ChoiceChannel, PresentedChoice } from "../core/session.js";
import type { ChoicePresenter } from "./DialogueUiAdapter.js";

export interface RadialChoiceConfig {
  readonly center: { readonly x: number; readonly y: number };
  readonly radius: number;
  readonly choiceColor: number;
  readonly choiceSelectedColor: number;
  readonly hubColor: number;
  readonly size: number;
  readonly bitmapFont?: string | undefined;
  readonly fontFamily?: string | undefined;
  readonly resolution?: number | undefined;
  readonly layerFrame: string;
  readonly layerText: string;
}

interface Spoke {
  readonly entity: Entity;
  readonly comp: TextComponent;
  readonly x: number;
  readonly y: number;
}

/** @experimental Unpolished radial choice wheel; see file header. */
export class RadialChoicePresenter implements ChoicePresenter, ChoiceChannel {
  private scene?: Scene | undefined;
  private hub?: { entity: Entity; gfx: GraphicsComponent } | undefined;
  private spokes: Spoke[] = [];
  private selected = -1;

  onChoiceChosen?: (position: number) => void;

  constructor(private readonly cfg: RadialChoiceConfig) {}

  mount(scene: Scene): void {
    this.scene = scene;
    const hub = scene.spawn("dlg-radial-hub");
    hub.add(new Transform()).setPosition(0, 0);
    this.hub = { entity: hub, gfx: hub.add(new GraphicsComponent({ layer: this.cfg.layerFrame })) };
  }

  present(choices: readonly PresentedChoice[]): void {
    this.clear();
    if (!this.scene) return;
    const { center: c, radius } = this.cfg;
    const n = choices.length;
    choices.forEach((choice, i) => {
      // Evenly spaced, starting at the top and going clockwise.
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = c.x + Math.cos(angle) * radius;
      const y = c.y + Math.sin(angle) * radius;
      const entity = this.scene!.spawn("dlg-radial");
      entity.add(new Transform()).setPosition(x, y);
      const comp = entity.add(
        new TextComponent(this.textOptions(choice.label, this.cfg.choiceColor)),
      );
      comp.text.visible = true;
      this.spokes.push({ entity, comp, x, y });
    });
    this.highlight(0);
  }

  highlight(position: number): void {
    if (this.spokes.length === 0) return;
    this.selected = Math.max(0, Math.min(this.spokes.length - 1, position));
    this.spokes.forEach((s, i) => {
      const on = i === this.selected;
      s.comp.text.style.fill = on ? this.cfg.choiceSelectedColor : this.cfg.choiceColor;
      s.entity.get(Transform).setScale(on ? 1.15 : 1, on ? 1.15 : 1);
    });
    this.drawHub();
  }

  /** {@link ChoicePresenter}: nearest spoke within a small radius. */
  choiceAtPoint(x: number, y: number): number | undefined {
    let best: number | undefined;
    let bestD = 22; // px hit radius
    this.spokes.forEach((s, i) => {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  clear(): void {
    for (const s of this.spokes) s.entity.destroy();
    this.spokes = [];
    this.selected = -1;
    this.hub?.gfx.draw((g) => g.clear());
  }

  dispose(): void {
    this.clear();
    this.hub?.entity.destroy();
    this.hub = undefined;
  }

  private drawHub(): void {
    if (!this.hub) return;
    const { center: c } = this.cfg;
    const sel = this.spokes[this.selected];
    this.hub.gfx.draw((g) => {
      g.clear();
      if (sel) {
        g.moveTo(c.x, c.y).lineTo(sel.x, sel.y).stroke({ color: this.cfg.choiceSelectedColor, width: 2, alpha: 0.7 });
      }
      g.circle(c.x, c.y, 4).fill({ color: this.cfg.hubColor, alpha: 1 });
    });
  }

  private textOptions(text: string, color: number): TextComponentOptions {
    const style: TextStyle = { fontSize: this.cfg.size, fill: color };
    if (this.cfg.bitmapFont) style.fontFamily = this.cfg.bitmapFont;
    else if (this.cfg.fontFamily) style.fontFamily = this.cfg.fontFamily;
    const base: TextComponentOptions = { text, style, layer: this.cfg.layerText, anchor: { x: 0.5, y: 0.5 } };
    if (this.cfg.bitmapFont) base.bitmap = true;
    // `exactOptionalPropertyTypes` rejects `resolution: undefined`; omit when unset.
    else if (this.cfg.resolution !== undefined) base.resolution = this.cfg.resolution;
    return base;
  }
}

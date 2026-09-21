import { Graphics } from "pixi.js";
import type { LightingWorld } from "./LightingWorld.js";

/**
 * @internal The floor a lighting renderer's lights are added over: the scene's
 * ambient colour scaled by its ambient level, across the whole viewport.
 */
export class AmbientFill {
  readonly graphics = new Graphics();
  private level = -1;
  private color = -1;
  private width = -1;
  private height = -1;

  constructor(label: string) {
    this.graphics.label = label;
  }

  /** Redraw when the world's ambient or the viewport changed. */
  sync(world: LightingWorld, width: number, height: number): boolean {
    const level = world.ambientLevel;
    const color = world.ambientColor;
    if (
      level === this.level &&
      color === this.color &&
      width === this.width &&
      height === this.height
    ) {
      return false;
    }
    this.level = level;
    this.color = color;
    this.width = width;
    this.height = height;
    this.graphics
      .clear()
      .rect(0, 0, width, height)
      .fill(scaleColor(color, level));
    return true;
  }
}

/** An RGB colour dimmed to `level`, from 0 to 1. */
function scaleColor(color: number, level: number): number {
  const r = Math.round(((color >> 16) & 0xff) * level);
  const g = Math.round(((color >> 8) & 0xff) * level);
  const b = Math.round((color & 0xff) * level);
  return (r << 16) | (g << 8) | b;
}

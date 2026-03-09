import { Text, Container } from "pixi.js";

const LINE_HEIGHT = 16;
const FONT_SIZE = 14;
const PADDING = 4;

/** Allocation-free pool of PixiJS Text objects for HUD debug lines. */
export class TextPool {
  private pool: Text[] | null = null;
  private index = 0;
  private readonly container: Container;
  private readonly maxLines: number;

  constructor(container: Container, maxLines = 32) {
    this.container = container;
    this.maxLines = maxLines;
  }

  /** Lazily create Text objects on first use (ensures PixiJS is fully ready). */
  private ensure(): Text[] {
    if (this.pool) return this.pool;
    this.pool = [];
    for (let i = 0; i < this.maxLines; i++) {
      const t = new Text({
        text: "",
        style: {
          fontFamily: "monospace",
          fontSize: FONT_SIZE,
          fill: 0xffffff,
        },
      });
      t.visible = false;
      t.eventMode = "none";
      this.container.addChild(t);
      this.pool.push(t);
    }
    return this.pool;
  }

  /** Show a text line at the next available slot. */
  addLine(text: string): void {
    const pool = this.ensure();
    if (this.index >= pool.length) return;
    const t = pool[this.index]!;
    t.text = text;
    t.visible = true;
    t.position.set(PADDING, PADDING + this.index * LINE_HEIGHT);
    this.index++;
  }

  /** Hide all lines and reset for the next frame. */
  resetFrame(): void {
    if (!this.pool) return;
    for (let i = 0; i < this.index; i++) {
      this.pool[i]!.visible = false;
    }
    this.index = 0;
  }

  destroy(): void {
    if (!this.pool) return;
    for (const t of this.pool) {
      t.destroy();
    }
    this.pool.length = 0;
  }
}

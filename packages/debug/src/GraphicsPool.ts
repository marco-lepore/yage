import { Graphics, Container } from "pixi.js";

/** Allocation-free pool of PixiJS Graphics objects for debug drawing. */
export class GraphicsPool {
  private pool: Graphics[] | null = null;
  private index = 0;
  private readonly container: Container;
  private readonly maxSize: number;

  constructor(container: Container, maxSize = 256) {
    this.container = container;
    this.maxSize = maxSize;
  }

  /** Lazily create Graphics objects on first use (ensures PixiJS is fully ready). */
  private ensure(): Graphics[] {
    if (this.pool) return this.pool;
    this.pool = [];
    for (let i = 0; i < this.maxSize; i++) {
      const g = new Graphics();
      g.visible = false;
      g.eventMode = "none";
      this.container.addChild(g);
      this.pool.push(g);
    }
    return this.pool;
  }

  /** Return the next available Graphics, or undefined if the pool is exhausted. */
  acquire(): Graphics | undefined {
    const pool = this.ensure();
    if (this.index >= pool.length) return undefined;
    const g = pool[this.index]!;
    g.visible = true;
    this.index++;
    return g;
  }

  /** Clear and hide all previously acquired graphics, reset index. */
  resetFrame(): void {
    if (!this.pool) return;
    for (let i = 0; i < this.index; i++) {
      const g = this.pool[i]!;
      g.clear();
      g.visible = false;
      g.position.set(0, 0);
      g.rotation = 0;
      g.scale.set(1, 1);
    }
    this.index = 0;
  }

  destroy(): void {
    if (!this.pool) return;
    for (const g of this.pool) {
      g.destroy();
    }
    this.pool.length = 0;
  }
}

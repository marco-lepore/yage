import { Particle } from "pixi.js";
import type { TextureResource } from "@yagejs/renderer";

/** Pre-allocated pool of PixiJS Particle instances. */
export class ParticlePool {
  private readonly free: Particle[] = [];
  private readonly texture: TextureResource;
  readonly capacity: number;
  private _activeCount = 0;

  constructor(texture: TextureResource, capacity: number) {
    this.texture = texture;
    this.capacity = capacity;

    // Pre-allocate all particles
    for (let i = 0; i < capacity; i++) {
      this.free.push(new Particle(texture));
    }
  }

  /** Acquire a recycled particle, or undefined if at capacity. */
  acquire(): Particle | undefined {
    if (this.free.length === 0) return undefined;
    this._activeCount++;
    return this.free.pop()!;
  }

  /** Release a particle back to the pool. */
  release(particle: Particle): void {
    // Reset particle state for reuse
    particle.x = 0;
    particle.y = 0;
    particle.scaleX = 1;
    particle.scaleY = 1;
    particle.rotation = 0;
    particle.alpha = 1;
    particle.texture = this.texture;
    this._activeCount--;
    this.free.push(particle);
  }

  /** Number of particles currently in use. */
  get activeCount(): number {
    return this._activeCount;
  }

  /** Number of particles available for reuse. */
  get freeCount(): number {
    return this.free.length;
  }
}

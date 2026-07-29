import type { ErrorBoundary, Scene } from "@yagejs/core";
import type { LightOccluder } from "./LightOccluder.js";
import type { LightSource } from "./LightSource.js";
import type {
  AmbientLightOptions,
  LightingRenderer,
  LightingRenderFrame,
} from "./types.js";
import { assertColor, assertUnit, clampUnit } from "./validation.js";

const DEFAULT_AMBIENT_LEVEL = 0.15;
const DEFAULT_AMBIENT_COLOR = 0xffffff;

/**
 * Per-scene light state.
 *
 * `levelAt(x, y)` reports a continuous value from 0 to 1. The ambient level
 * and every radial source contribution are added, then clamped.
 */
export class LightingWorld {
  readonly scene: Scene;

  private readonly _sources = new Set<LightSource>();
  private readonly _occluders = new Set<LightOccluder>();
  private readonly errorBoundary: ErrorBoundary | undefined;
  private backend: LightingRenderer | null = null;
  private _ambientLevel: number;
  private _ambientColor: number;
  private destroyed = false;

  constructor(
    scene: Scene,
    ambient: AmbientLightOptions = {},
    errorBoundary?: ErrorBoundary,
  ) {
    const level = ambient.level ?? DEFAULT_AMBIENT_LEVEL;
    const color = ambient.color ?? DEFAULT_AMBIENT_COLOR;
    assertUnit(level, "Lighting ambient level");
    assertColor(color, "Lighting ambient color");

    this.scene = scene;
    this._ambientLevel = level;
    this._ambientColor = color;
    this.errorBoundary = errorBoundary;
  }

  /** Every effectively enabled light source in this scene. */
  get sources(): ReadonlySet<LightSource> {
    return this._sources;
  }

  /** Every effectively enabled occluder in this scene. */
  get occluders(): ReadonlySet<LightOccluder> {
    return this._occluders;
  }

  /** Scalar light present where no source reaches. */
  get ambientLevel(): number {
    return this._ambientLevel;
  }

  /** RGB ambient tint used by visual renderers. */
  get ambientColor(): number {
    return this._ambientColor;
  }

  /** Set the ambient light level and optionally its RGB tint. */
  setAmbient(level: number, color: number = this._ambientColor): void {
    assertUnit(level, "Lighting ambient level");
    assertColor(color, "Lighting ambient color");
    if (level === this._ambientLevel && color === this._ambientColor) return;
    this._ambientLevel = level;
    this._ambientColor = color;
  }

  /** Return the combined light level at a world-space point. */
  levelAt(x: number, y: number): number {
    let level = this._ambientLevel;
    for (const source of this._sources) {
      const position = source.position;
      const dx = x - position.x;
      const dy = y - position.y;
      const distanceSquared = dx * dx + dy * dy;
      const radius = source.radius;
      if (distanceSquared >= radius * radius) continue;
      const falloff = 1 - Math.sqrt(distanceSquared) / radius;
      level += source.intensity * falloff;
      if (level >= 1) return 1;
    }
    return clampUnit(level);
  }

  /** Register a source. Components call this while effectively enabled. */
  registerSource(source: LightSource): void {
    if (this._sources.has(source)) return;
    this._sources.add(source);
  }

  /** Remove a source without destroying it. */
  unregisterSource(source: LightSource): void {
    this._sources.delete(source);
  }

  /** Register renderer-neutral shadow geometry. */
  registerOccluder(occluder: LightOccluder): void {
    if (this._occluders.has(occluder)) return;
    this._occluders.add(occluder);
  }

  /** Remove renderer-neutral shadow geometry without destroying it. */
  unregisterOccluder(occluder: LightOccluder): void {
    this._occluders.delete(occluder);
  }

  /** @internal */
  _attachRenderer(renderer: LightingRenderer): void {
    if (this.backend) {
      throw new Error(
        `LightingWorld for scene "${this.scene.name}" already has a renderer.`,
      );
    }
    this.backend = renderer;
  }

  /** @internal */
  _render(frame: LightingRenderFrame): void {
    const backend = this.backend;
    if (!backend) return;
    if (this.errorBoundary) {
      this.errorBoundary.wrapCallback(() => backend.render(frame), {
        kind: "Lighting renderer",
        scene: this.scene.name,
      });
      return;
    }
    backend.render(frame);
  }

  /** Release the renderer and clear registered scene state. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const backend = this.backend;
    this.backend = null;
    try {
      if (backend && this.errorBoundary) {
        this.errorBoundary.wrapCallback(() => backend.destroy(), {
          kind: "Lighting renderer teardown",
          scene: this.scene.name,
        });
      } else {
        backend?.destroy();
      }
    } finally {
      this._sources.clear();
      this._occluders.clear();
    }
  }
}

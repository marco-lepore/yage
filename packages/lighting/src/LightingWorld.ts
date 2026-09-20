import { Vec2Buffer } from "@yagejs/core";
import type { ErrorBoundary, Scene } from "@yagejs/core";
import type { LightOccluder } from "./LightOccluder.js";
import type { LightSource } from "./LightSource.js";
import type {
  AmbientLightOptions,
  LightGrid,
  LightingRenderer,
  LightingRenderFrame,
} from "./types.js";
import { LampView, OccluderFootprintPool } from "./occlusion.js";
import type { OccluderFootprint } from "./occlusion.js";
import { FULL_TURN, assertColor, assertUnit, clampUnit } from "./validation.js";

const DEFAULT_AMBIENT_LEVEL = 0.15;
const DEFAULT_AMBIENT_COLOR = 0xffffff;

/**
 * Per-scene light state.
 *
 * `levelAt(x, y)` reports a continuous value from 0 to 1. The ambient level
 * and every radial source contribution are added, then clamped. A source
 * contributes in proportion to how much of its lamp an enabled occluder
 * leaves visible from the point, which for a point lamp is all of it or none;
 * `levelGridInto` answers the same question for a whole grid in one call.
 */
export class LightingWorld {
  private readonly positionScratch = new Vec2Buffer();
  /** Reused footprints, one per registered occluder, refreshed per query. */
  private readonly footprints = new OccluderFootprintPool();
  /** Footprints near enough to shadow the light being summed. */
  private readonly inReach: OccluderFootprint[] = [];
  /** The lamp being summed, as the point being sampled sees it. */
  private readonly lamp = new LampView();
  /** Double-precision cell totals, so a grid cell matches `levelAt` exactly. */
  private accumulator = new Float64Array(0);
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
    this.footprints.refresh(this._occluders);
    const footprintCount = this.footprints.count;
    let level = this._ambientLevel;
    for (const source of this._sources) {
      const position = source.getPositionInto(this.positionScratch);
      const sourceX = position.x;
      const sourceY = position.y;
      const dx = x - sourceX;
      const dy = y - sourceY;
      const distanceSquared = dx * dx + dy * dy;
      const radius = source.radius;
      if (distanceSquared >= radius * radius) continue;
      const distance = Math.sqrt(distanceSquared);
      const coneAngle = source.coneAngle;
      if (coneAngle < FULL_TURN) {
        const rotation = source.rotation;
        if (
          !inCone(
            dx,
            dy,
            distance,
            Math.cos(rotation),
            Math.sin(rotation),
            Math.cos(coneAngle / 2),
          )
        ) {
          continue;
        }
      }
      let coverage = 1;
      if (source.castShadows) {
        const halfSize = source.size / 2;
        if (halfSize === 0) {
          if (this.shadowed(footprintCount, sourceX, sourceY, x, y)) continue;
        } else {
          coverage = this.covered(
            footprintCount,
            sourceX,
            sourceY,
            x,
            y,
            halfSize,
          );
          if (coverage === 0) continue;
        }
      }
      const falloff = 1 - distance / radius;
      level += source.intensity * falloff * coverage;
      if (level >= 1) return 1;
    }
    return clampUnit(level);
  }

  /**
   * Sample a rectangular grid of light levels into `out`, row by row, one
   * sample at each cell's centre. Every cell holds what `levelAt` returns for
   * that centre.
   *
   * Each source is summed over the cells its radius reaches, against the
   * occluders within that radius, so the cost grows with the lit area rather
   * than with the whole grid.
   */
  levelGridInto(out: Float32Array, grid: LightGrid): Float32Array {
    const { x: originX, y: originY, cols, rows, cellWidth, cellHeight } = grid;
    assertPositiveInteger(cols, "cols");
    assertPositiveInteger(rows, "rows");
    assertFinite(originX, "x");
    assertFinite(originY, "y");
    assertPositiveSize(cellWidth, "cellWidth");
    assertPositiveSize(cellHeight, "cellHeight");
    const cellCount = cols * rows;
    if (out.length !== cellCount) {
      throw new RangeError(
        `LightingWorld.levelGridInto: out must hold cols * rows samples ` +
          `(${cellCount}), got ${out.length}.`,
      );
    }

    const levels = this.ensureAccumulator(cellCount);
    levels.fill(this._ambientLevel, 0, cellCount);

    this.footprints.refresh(this._occluders);
    const footprintCount = this.footprints.count;
    for (const source of this._sources) {
      const position = source.getPositionInto(this.positionScratch);
      const sourceX = position.x;
      const sourceY = position.y;
      const radius = source.radius;
      const intensity = source.intensity;
      const halfSize = source.size / 2;
      const coneAngle = source.coneAngle;
      const coned = coneAngle < FULL_TURN;
      const rotation = source.rotation;
      const aimX = coned ? Math.cos(rotation) : 0;
      const aimY = coned ? Math.sin(rotation) : 0;
      const coneCosine = coned ? Math.cos(coneAngle / 2) : 0;

      const minCol = Math.max(
        0,
        Math.ceil((sourceX - radius - originX) / cellWidth - 0.5),
      );
      const maxCol = Math.min(
        cols - 1,
        Math.floor((sourceX + radius - originX) / cellWidth - 0.5),
      );
      const minRow = Math.max(
        0,
        Math.ceil((sourceY - radius - originY) / cellHeight - 0.5),
      );
      const maxRow = Math.min(
        rows - 1,
        Math.floor((sourceY + radius - originY) / cellHeight - 0.5),
      );
      if (minCol > maxCol || minRow > maxRow) continue;

      const inReach = this.inReach;
      const lamp = this.lamp;
      inReach.length = 0;
      if (source.castShadows) {
        // Rays run from a cell to anywhere on the lamp, so a wide lamp reaches
        // its own half-width past the light's radius.
        const reach = radius + halfSize;
        for (let i = 0; i < footprintCount; i++) {
          const footprint = this.footprints.get(i);
          if (!footprint.withinRange(sourceX, sourceY, reach)) continue;
          if (footprint.contains(sourceX, sourceY)) continue;
          inReach.push(footprint);
        }
      }

      for (let row = minRow; row <= maxRow; row++) {
        const y = originY + (row + 0.5) * cellHeight;
        const rowStart = row * cols;
        for (let col = minCol; col <= maxCol; col++) {
          const index = rowStart + col;
          if (levels[index]! >= 1) continue;
          const x = originX + (col + 0.5) * cellWidth;
          const dx = x - sourceX;
          const dy = y - sourceY;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= radius * radius) continue;
          const distance = Math.sqrt(distanceSquared);
          if (coned && !inCone(dx, dy, distance, aimX, aimY, coneCosine)) {
            continue;
          }
          let coverage = 1;
          if (halfSize === 0) {
            let blocked = false;
            for (const footprint of inReach) {
              if (!footprint.blocks(sourceX, sourceY, x, y)) continue;
              blocked = true;
              break;
            }
            if (blocked) continue;
          } else if (lamp.aimAt(x, y, sourceX, sourceY, halfSize)) {
            for (const footprint of inReach) {
              footprint.projectShadow(lamp);
              if (lamp.blocked) break;
            }
            coverage = lamp.litShare;
            if (coverage === 0) continue;
          }
          levels[index] =
            levels[index]! + intensity * (1 - distance / radius) * coverage;
        }
      }
    }

    for (let i = 0; i < cellCount; i++) out[i] = clampUnit(levels[i]!);
    return out;
  }

  /** Whether an occluder stands between a light and a point. */
  private shadowed(
    footprintCount: number,
    sourceX: number,
    sourceY: number,
    x: number,
    y: number,
  ): boolean {
    for (let i = 0; i < footprintCount; i++) {
      const footprint = this.footprints.get(i);
      // A light inside an occluder shines out of it rather than being
      // swallowed by it, so a lamp mounted on a pillar still lights the room.
      if (footprint.contains(sourceX, sourceY)) continue;
      if (footprint.blocks(sourceX, sourceY, x, y)) return true;
    }
    return false;
  }

  /**
   * Share of a lamp of half-width `halfSize` that reaches a point, from 0 to
   * 1. An occluder that holds the light is skipped, as it is for a point lamp.
   */
  private covered(
    footprintCount: number,
    sourceX: number,
    sourceY: number,
    x: number,
    y: number,
    halfSize: number,
  ): number {
    const lamp = this.lamp;
    if (!lamp.aimAt(x, y, sourceX, sourceY, halfSize)) return 1;
    for (let i = 0; i < footprintCount; i++) {
      const footprint = this.footprints.get(i);
      if (footprint.contains(sourceX, sourceY)) continue;
      footprint.projectShadow(lamp);
      if (lamp.blocked) return 0;
    }
    return lamp.litShare;
  }

  private ensureAccumulator(cellCount: number): Float64Array {
    if (this.accumulator.length < cellCount) {
      this.accumulator = new Float64Array(cellCount);
    }
    return this.accumulator;
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

/**
 * Whether a point lies inside a light's cone. `aimX`/`aimY` is the cone's unit
 * direction and `cosine` the cosine of half its spread; a point standing on
 * the lamp has no direction and counts as lit.
 */
function inCone(
  dx: number,
  dy: number,
  distance: number,
  aimX: number,
  aimY: number,
  cosine: number,
): boolean {
  return distance === 0 || dx * aimX + dy * aimY >= cosine * distance;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(
      `LightingWorld.levelGridInto: ${name} must be a positive integer, got ${value}.`,
    );
  }
}

function assertPositiveSize(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `LightingWorld.levelGridInto: ${name} must be a finite number greater than 0, got ${value}.`,
    );
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `LightingWorld.levelGridInto: ${name} must be a finite number, got ${value}.`,
    );
  }
}

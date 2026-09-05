import { Vec2Buffer } from "@yagejs/core";
import { Container, Graphics, Sprite } from "pixi.js";
import type { FillGradient } from "pixi.js";
import { SceneRenderTreeKey, radialGradient } from "@yagejs/renderer";
import type { RenderTargetHandle } from "@yagejs/renderer";
import type { LightSource } from "./LightSource.js";
import type {
  LightingRenderer,
  LightingRendererContext,
  LightingRenderFrame,
} from "./types.js";
import { assertPositive } from "./validation.js";

const DEFAULT_LAYER = "lighting";
const DEFAULT_ORDER = 900;
const DEFAULT_RESOLUTION_SCALE = 0.5;

/** Options for the built-in multiply-composite renderer. */
export interface OverlayLightingRendererOptions {
  /** Screen-space layer name. Default `"lighting"`. */
  layer?: string;
  /** Layer order when the renderer creates it. Default `900`. */
  order?: number;
  /** Render-target texel density relative to the canvas. Default `0.5`. */
  resolutionScale?: number;
  /** Antialias the light buffer. Default `true`. */
  antialias?: boolean;
}

interface SourceVisual {
  readonly graphics: Graphics;
  gradient: FillGradient;
  radius: number;
  intensity: number;
  color: number;
  x: number;
  y: number;
}

/**
 * Draws ambient colour plus radial lights into an offscreen buffer, then
 * multiplies that buffer over the scene.
 *
 * Coloured lights tint every surface they reach. Occluders are registered in
 * the world for custom renderers but do not cast shadows in this renderer.
 */
export class OverlayLightingRenderer implements LightingRenderer {
  private readonly positionScratch = new Vec2Buffer();
  private readonly world;
  private readonly source = new Container();
  private readonly ambient = new Graphics();
  private readonly target: RenderTargetHandle;
  private readonly overlay: Sprite;
  private readonly visuals = new Map<LightSource, SourceVisual>();
  private width: number;
  private height: number;
  private ambientLevel = -1;
  private ambientColor = -1;
  private destroyed = false;

  constructor(
    context: LightingRendererContext,
    options: OverlayLightingRendererOptions = {},
  ) {
    const resolutionScale = options.resolutionScale ?? DEFAULT_RESOLUTION_SCALE;
    assertPositive(resolutionScale, "OverlayLightingRenderer resolutionScale");

    this.world = context.world;
    const { width, height } = context.renderer.virtualSize;
    this.width = width;
    this.height = height;

    const tree = context.scene.tryResolveScoped(SceneRenderTreeKey);
    if (!tree) {
      throw new Error(
        `OverlayLightingRenderer: scene "${context.scene.name}" has no render tree. ` +
          "Install RendererPlugin before LightingPlugin.",
      );
    }
    const layer = tree.ensureLayer(
      {
        name: options.layer ?? DEFAULT_LAYER,
        order: options.order ?? DEFAULT_ORDER,
        space: "screen",
      },
      { space: "screen", eventMode: "none" },
    );
    if (layer.space !== "screen") {
      throw new Error(
        `OverlayLightingRenderer: layer "${layer.name}" must use screen space.`,
      );
    }

    this.source.label = `lighting-source:${context.scene.name}`;
    this.source.addChild(this.ambient);
    this.target = context.renderer.createRenderTarget(this.source, {
      width,
      height,
      resolutionScale,
      antialias: options.antialias ?? true,
      clearColor: 0x000000,
      label: `lighting:${context.scene.name}`,
    });
    this.overlay = new Sprite(this.target.texture);
    this.overlay.label = `lighting-overlay:${context.scene.name}`;
    this.overlay.eventMode = "none";
    this.overlay.blendMode = "multiply";
    layer.container.addChild(this.overlay);
  }

  render(frame: LightingRenderFrame): void {
    if (this.destroyed) {
      throw new Error("OverlayLightingRenderer.render called after destroy().");
    }

    let changed = this.resize(frame.width, frame.height);
    changed = this.syncAmbient() || changed;
    changed = this.syncSources(frame) || changed;
    if (changed) this.target.invalidate();
    this.target.renderIfNeeded();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const visual of this.visuals.values()) {
      visual.gradient.destroy();
    }
    this.visuals.clear();
    if (!this.overlay.destroyed) {
      this.overlay.removeFromParent();
      this.overlay.destroy();
    }
    this.target.destroy();
    this.source.destroy({ children: true });
  }

  private resize(width: number, height: number): boolean {
    if (width === this.width && height === this.height) return false;
    assertPositive(width, "Lighting viewport width");
    assertPositive(height, "Lighting viewport height");
    this.width = width;
    this.height = height;
    this.target.resize(width, height);
    this.overlay.width = width;
    this.overlay.height = height;
    return true;
  }

  private syncAmbient(): boolean {
    const level = this.world.ambientLevel;
    const color = this.world.ambientColor;
    if (
      level === this.ambientLevel &&
      color === this.ambientColor &&
      this.ambient.width === this.width &&
      this.ambient.height === this.height
    ) {
      return false;
    }
    this.ambientLevel = level;
    this.ambientColor = color;
    this.ambient
      .clear()
      .rect(0, 0, this.width, this.height)
      .fill(scaleColor(color, level));
    return true;
  }

  private syncSources(frame: LightingRenderFrame): boolean {
    let changed = false;
    for (const [source, visual] of this.visuals) {
      if (this.world.sources.has(source)) continue;
      visual.gradient.destroy();
      visual.graphics.removeFromParent();
      visual.graphics.destroy();
      this.visuals.delete(source);
      changed = true;
    }

    const camera = frame.camera;
    const scale = Math.abs(camera?.zoom ?? 1);
    for (const source of this.world.sources) {
      const position = source.getPositionInto(this.positionScratch);
      const projected = camera
        ? camera.worldToScreenInto(this.positionScratch, position.x, position.y)
        : position;
      const radius = source.radius * scale;
      let visual = this.visuals.get(source);
      if (!visual) {
        visual = this.createVisual(source, radius, projected.x, projected.y);
        this.visuals.set(source, visual);
        changed = true;
        continue;
      }

      if (
        visual.color !== source.color ||
        visual.intensity !== source.intensity
      ) {
        visual.gradient.destroy();
        visual.gradient = createLightGradient(source.color, source.intensity);
        visual.color = source.color;
        visual.intensity = source.intensity;
        visual.radius = radius;
        redrawLight(visual);
        changed = true;
      } else if (visual.radius !== radius) {
        visual.radius = radius;
        redrawLight(visual);
        changed = true;
      }

      if (visual.x !== projected.x || visual.y !== projected.y) {
        visual.x = projected.x;
        visual.y = projected.y;
        visual.graphics.position.set(projected.x, projected.y);
        changed = true;
      }
    }
    return changed;
  }

  private createVisual(
    source: LightSource,
    radius: number,
    x: number,
    y: number,
  ): SourceVisual {
    const graphics = new Graphics();
    graphics.blendMode = "add";
    graphics.position.set(x, y);
    const visual: SourceVisual = {
      graphics,
      gradient: createLightGradient(source.color, source.intensity),
      radius,
      intensity: source.intensity,
      color: source.color,
      x,
      y,
    };
    redrawLight(visual);
    this.source.addChild(graphics);
    return visual;
  }
}

/** Return a per-scene factory for the built-in renderer. */
export function overlayLighting(
  options: OverlayLightingRendererOptions = {},
): (context: LightingRendererContext) => OverlayLightingRenderer {
  return (context) => new OverlayLightingRenderer(context, options);
}

function createLightGradient(color: number, intensity: number): FillGradient {
  return radialGradient({
    stops: [
      { offset: 0, color, alpha: intensity },
      { offset: 1, color, alpha: 0 },
    ],
  }) as FillGradient;
}

function redrawLight(visual: SourceVisual): void {
  visual.graphics.clear().circle(0, 0, visual.radius).fill(visual.gradient);
}

function scaleColor(color: number, level: number): number {
  const r = Math.round(((color >> 16) & 0xff) * level);
  const g = Math.round(((color >> 8) & 0xff) * level);
  const b = Math.round((color & 0xff) * level);
  return (r << 16) | (g << 8) | b;
}

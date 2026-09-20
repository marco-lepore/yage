import { Vec2Buffer } from "@yagejs/core";
import { Container, Graphics, Sprite } from "pixi.js";
import type { FillGradient } from "pixi.js";
import { SceneRenderTreeKey, radialGradient } from "@yagejs/renderer";
import type { RenderTargetHandle } from "@yagejs/renderer";
import type { LightOccluder } from "./LightOccluder.js";
import type { LightSource } from "./LightSource.js";
import { OccluderFootprintPool } from "./occlusion.js";
import type { OccluderFootprint } from "./occlusion.js";
import type {
  LightingRenderer,
  LightingRendererContext,
  LightingRenderFrame,
} from "./types.js";
import { FULL_TURN, assertPositive } from "./validation.js";

const DEFAULT_LAYER = "lighting";
const DEFAULT_ORDER = 900;
const DEFAULT_RESOLUTION_SCALE = 0.5;
/** Shadow geometry only ever fills a stencil, so its colour never shows. */
const SHADOW_FILL = 0xffffff;
/** Widest angle one shadow quad may cover as seen from the light, in radians. */
const MAX_SHADOW_PIECE_ANGLE = Math.PI / 3;
/** How often one edge may be halved before its quad is drawn as it stands. */
const MAX_SHADOW_SPLIT_DEPTH = 6;
/** Below this, an edge counts as running straight through the light. */
const STRAIGHT_ANGLE_EPSILON = 1e-6;

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
  /** Holds the light and, while something shadows it, its inverse mask. */
  readonly container: Container;
  readonly graphics: Graphics;
  shadows: Graphics | null;
  masked: boolean;
  gradient: FillGradient;
  /** Radius the gradient spans, or 0 while it follows the drawn bounds. */
  gradientRadius: number;
  radius: number;
  intensity: number;
  color: number;
  coneAngle: number;
  /** Screen-space direction the cone points along, in radians. */
  aim: number;
  x: number;
  y: number;
  /** World-space light state the drawn shadows were built from. */
  shadowX: number;
  shadowY: number;
  shadowRadius: number;
  castShadows: boolean;
  shadowRevision: number;
}

/** One occluder's world transform, compared per frame to catch a move. */
interface OccluderState {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Draws ambient colour plus radial lights into an offscreen buffer, then
 * multiplies that buffer over the scene.
 *
 * Coloured lights tint every surface they reach. A light with a cone is drawn
 * as a pie slice aimed along its entity's world rotation. An enabled occluder
 * is opaque: each light is drawn through an inverse mask covering everything
 * its occluders hide.
 *
 * Shadow edges are hard whatever a light's `size` says. At `size: 0` the
 * picture is exactly what `LightingWorld.levelAt()` reports; above it the
 * drawn edge runs along the middle of the soft border the query answers with,
 * so the two agree everywhere except inside that border.
 */
export class OverlayLightingRenderer implements LightingRenderer {
  private readonly positionScratch = new Vec2Buffer();
  private readonly occluderScratch = new Vec2Buffer();
  private readonly world;
  private readonly source = new Container();
  private readonly ambient = new Graphics();
  private readonly target: RenderTargetHandle;
  private readonly overlay: Sprite;
  private readonly visuals = new Map<LightSource, SourceVisual>();
  private readonly footprints = new OccluderFootprintPool();
  private readonly occluderStates = new Map<LightOccluder, OccluderState>();
  /** Bumped whenever an occluder appears, moves or leaves. */
  private occlusionRevision = 0;
  /** Whether {@link footprints} already matches this frame's occluders. */
  private footprintsResolved = false;
  /** Camera transform the shadow masks are drawn under. */
  private viewX = 0;
  private viewY = 0;
  private viewRotation = 0;
  private viewZoom = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
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

    this.footprintsResolved = false;
    this.syncOccluders();
    let changed = this.resize(frame.width, frame.height);
    changed = this.syncAmbient() || changed;
    changed = this.syncShadowView(frame) || changed;
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
    this.occluderStates.clear();
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

  /** Notice an occluder appearing, moving, rescaling, rotating or leaving. */
  private syncOccluders(): void {
    const occluders = this.world.occluders;
    let changed = false;
    for (const occluder of this.occluderStates.keys()) {
      if (occluders.has(occluder)) continue;
      this.occluderStates.delete(occluder);
      changed = true;
    }
    for (const occluder of occluders) {
      const position = occluder.getPositionInto(this.occluderScratch);
      const scale = occluder.scale;
      const rotation = occluder.rotation;
      const state = this.occluderStates.get(occluder);
      if (!state) {
        this.occluderStates.set(occluder, {
          x: position.x,
          y: position.y,
          rotation,
          scaleX: scale.x,
          scaleY: scale.y,
        });
        changed = true;
        continue;
      }
      if (
        state.x === position.x &&
        state.y === position.y &&
        state.rotation === rotation &&
        state.scaleX === scale.x &&
        state.scaleY === scale.y
      ) {
        continue;
      }
      state.x = position.x;
      state.y = position.y;
      state.rotation = rotation;
      state.scaleX = scale.x;
      state.scaleY = scale.y;
      changed = true;
    }
    if (changed) this.occlusionRevision++;
  }

  /**
   * Put the shadow masks under the camera's own transform. Shadow geometry is
   * world-space, so the camera moves it the way it moves the scene and the
   * geometry itself only has to be rebuilt when a light or an occluder moves.
   */
  private syncShadowView(frame: LightingRenderFrame): boolean {
    const camera = frame.camera;
    let x = 0;
    let y = 0;
    let rotation = 0;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    if (camera) {
      const position = camera.getEffectivePositionInto(this.occluderScratch);
      x = position.x;
      y = position.y;
      rotation = camera.effectiveRotation;
      zoom = camera.effectiveZoom;
      offsetX = camera.viewportWidth / 2;
      offsetY = camera.viewportHeight / 2;
    }
    if (
      x === this.viewX &&
      y === this.viewY &&
      rotation === this.viewRotation &&
      zoom === this.viewZoom &&
      offsetX === this.viewOffsetX &&
      offsetY === this.viewOffsetY
    ) {
      return false;
    }
    this.viewX = x;
    this.viewY = y;
    this.viewRotation = rotation;
    this.viewZoom = zoom;
    this.viewOffsetX = offsetX;
    this.viewOffsetY = offsetY;
    let masked = false;
    for (const visual of this.visuals.values()) {
      if (!visual.shadows) continue;
      this.applyShadowView(visual.shadows);
      masked = masked || visual.masked;
    }
    return masked;
  }

  private applyShadowView(shadows: Graphics): void {
    shadows.pivot.set(this.viewX, this.viewY);
    shadows.scale.set(this.viewZoom);
    shadows.rotation = -this.viewRotation;
    shadows.position.set(this.viewOffsetX, this.viewOffsetY);
  }

  private syncSources(frame: LightingRenderFrame): boolean {
    let changed = false;
    for (const [source, visual] of this.visuals) {
      if (this.world.sources.has(source)) continue;
      visual.gradient.destroy();
      visual.container.removeFromParent();
      visual.container.destroy({ children: true });
      this.visuals.delete(source);
      changed = true;
    }

    const camera = frame.camera;
    const scale = Math.abs(camera?.effectiveZoom ?? 1);
    for (const source of this.world.sources) {
      const position = source.getPositionInto(this.positionScratch);
      const worldX = position.x;
      const worldY = position.y;
      const projected = camera
        ? camera.worldToScreenInto(this.positionScratch, worldX, worldY)
        : position;
      const radius = source.radius * scale;
      const coneAngle = source.coneAngle;
      const gradientRadius = gradientRadiusFor(coneAngle, radius);
      let visual = this.visuals.get(source);
      if (!visual) {
        visual = this.createVisual(source, radius, projected.x, projected.y);
        this.visuals.set(source, visual);
        this.syncShadows(visual, source, worldX, worldY);
        changed = true;
        continue;
      }

      if (
        visual.color !== source.color ||
        visual.intensity !== source.intensity ||
        visual.gradientRadius !== gradientRadius
      ) {
        visual.gradient.destroy();
        visual.gradient = createLightGradient(
          source.color,
          source.intensity,
          gradientRadius,
        );
        visual.color = source.color;
        visual.intensity = source.intensity;
        visual.gradientRadius = gradientRadius;
        visual.radius = radius;
        visual.coneAngle = coneAngle;
        redrawLight(visual);
        changed = true;
      } else if (visual.radius !== radius || visual.coneAngle !== coneAngle) {
        visual.radius = radius;
        visual.coneAngle = coneAngle;
        redrawLight(visual);
        changed = true;
      }

      // Shadow geometry rides the camera transform; a light's own graphic is
      // already projected, so its cone turns by the camera's rotation here.
      const aim =
        coneAngle < FULL_TURN ? source.rotation - this.viewRotation : 0;
      if (visual.aim !== aim) {
        visual.aim = aim;
        visual.graphics.rotation = aim;
        changed = true;
      }

      if (visual.x !== projected.x || visual.y !== projected.y) {
        visual.x = projected.x;
        visual.y = projected.y;
        visual.graphics.position.set(projected.x, projected.y);
        changed = true;
      }

      if (this.syncShadows(visual, source, worldX, worldY)) changed = true;
    }
    return changed;
  }

  /**
   * Rebuild one light's inverse mask when the light, an occluder or the
   * occluder set moved since it was last drawn. Returns whether it redrew.
   */
  private syncShadows(
    visual: SourceVisual,
    source: LightSource,
    worldX: number,
    worldY: number,
  ): boolean {
    const castShadows = source.castShadows;
    const radius = source.radius;
    if (
      visual.shadowRevision === this.occlusionRevision &&
      visual.castShadows === castShadows &&
      visual.shadowX === worldX &&
      visual.shadowY === worldY &&
      visual.shadowRadius === radius
    ) {
      return false;
    }
    visual.shadowRevision = this.occlusionRevision;
    visual.castShadows = castShadows;
    visual.shadowX = worldX;
    visual.shadowY = worldY;
    visual.shadowRadius = radius;

    const count = castShadows ? this.resolveFootprints() : 0;
    const shadows =
      count > 0
        ? (visual.shadows ?? this.createShadows(visual))
        : visual.shadows;
    let drawn = false;
    if (shadows) {
      shadows.clear();
      for (let i = 0; i < count; i++) {
        const footprint = this.footprints.get(i);
        if (!footprint.withinRange(worldX, worldY, radius)) continue;
        // A light inside an occluder shines out of it, so a lamp mounted on a
        // pillar still lights the room.
        if (footprint.contains(worldX, worldY)) continue;
        drawShadow(shadows, footprint, worldX, worldY, radius);
        drawn = true;
      }
    }
    if (drawn !== visual.masked) {
      if (drawn && shadows) {
        visual.container.setMask({ mask: shadows, inverse: true });
      } else {
        visual.container.mask = null;
      }
      visual.masked = drawn;
    }
    return true;
  }

  private resolveFootprints(): number {
    if (!this.footprintsResolved) {
      this.footprints.refresh(this.world.occluders);
      this.footprintsResolved = true;
    }
    return this.footprints.count;
  }

  private createShadows(visual: SourceVisual): Graphics {
    const shadows = new Graphics();
    shadows.label = "lighting-shadows";
    this.applyShadowView(shadows);
    visual.container.addChild(shadows);
    visual.shadows = shadows;
    return shadows;
  }

  private createVisual(
    source: LightSource,
    radius: number,
    x: number,
    y: number,
  ): SourceVisual {
    const container = new Container();
    const graphics = new Graphics();
    graphics.blendMode = "add";
    graphics.position.set(x, y);
    container.addChild(graphics);
    const coneAngle = source.coneAngle;
    const gradientRadius = gradientRadiusFor(coneAngle, radius);
    const aim = coneAngle < FULL_TURN ? source.rotation - this.viewRotation : 0;
    graphics.rotation = aim;
    const visual: SourceVisual = {
      container,
      graphics,
      shadows: null,
      masked: false,
      gradient: createLightGradient(
        source.color,
        source.intensity,
        gradientRadius,
      ),
      gradientRadius,
      radius,
      intensity: source.intensity,
      color: source.color,
      coneAngle,
      aim,
      x,
      y,
      shadowX: NaN,
      shadowY: NaN,
      shadowRadius: NaN,
      castShadows: source.castShadows,
      shadowRevision: -1,
    };
    redrawLight(visual);
    this.source.addChild(container);
    return visual;
  }
}

/** Return a per-scene factory for the built-in renderer. */
export function overlayLighting(
  options: OverlayLightingRendererOptions = {},
): (context: LightingRendererContext) => OverlayLightingRenderer {
  return (context) => new OverlayLightingRenderer(context, options);
}

/**
 * How far a light's gradient has to span, or 0 to let it follow the drawn
 * shape's own bounds.
 *
 * A full circle's bounds are the light itself, so a gradient normalised to
 * them lands correctly at any radius and a radius change only redraws the
 * shape. A pie slice's bounds are narrower than the light, so a cone's
 * gradient is placed on the lamp and spans the radius, which costs a rebuild
 * whenever the radius changes.
 */
function gradientRadiusFor(coneAngle: number, radius: number): number {
  return coneAngle < FULL_TURN ? radius : 0;
}

function createLightGradient(
  color: number,
  intensity: number,
  gradientRadius: number,
): FillGradient {
  const stops = [
    { offset: 0, color, alpha: intensity },
    { offset: 1, color, alpha: 0 },
  ];
  if (gradientRadius === 0) return radialGradient({ stops }) as FillGradient;
  return radialGradient({
    stops,
    center: { x: 0, y: 0 },
    outerRadius: gradientRadius,
    space: "global",
  }) as FillGradient;
}

function redrawLight(visual: SourceVisual): void {
  const graphics = visual.graphics.clear();
  if (visual.coneAngle >= FULL_TURN) {
    graphics.circle(0, 0, visual.radius).fill(visual.gradient);
    return;
  }
  const half = visual.coneAngle / 2;
  graphics
    .moveTo(0, 0)
    .arc(0, 0, visual.radius, -half, half)
    .fill(visual.gradient);
}

/**
 * Draw everything one occluder hides from a light: each outline edge extruded
 * away from the light past its radius. The union of those quads is the set of
 * points whose straight line back to the light crosses the occluder, which is
 * the rule `LightingWorld.levelAt()` applies.
 */
function drawShadow(
  shadows: Graphics,
  footprint: OccluderFootprint,
  lightX: number,
  lightY: number,
  radius: number,
): void {
  if (footprint.isCircle) {
    drawCircleShadow(shadows, footprint, lightX, lightY, radius);
    return;
  }
  const vertices = footprint.vertices;
  const count = footprint.vertexCount;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    drawEdgeShadow(
      shadows,
      vertices[j * 2]!,
      vertices[j * 2 + 1]!,
      vertices[i * 2]!,
      vertices[i * 2 + 1]!,
      lightX,
      lightY,
      radius,
      0,
    );
  }
}

/**
 * A disc's umbra is bounded by the two tangent lines from the light and by the
 * disc's own far side. The tangent points span the umbra beyond the disc, and
 * the disc fills the part in front of the chord between them.
 */
function drawCircleShadow(
  shadows: Graphics,
  footprint: OccluderFootprint,
  lightX: number,
  lightY: number,
  radius: number,
): void {
  const centerX = footprint.centerX;
  const centerY = footprint.centerY;
  const occluderRadius = footprint.radius;
  shadows.circle(centerX, centerY, occluderRadius).fill(SHADOW_FILL);

  const dx = lightX - centerX;
  const dy = lightY - centerY;
  const distance = Math.hypot(dx, dy);
  const cos = occluderRadius / distance;
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const ux = dx / distance;
  const uy = dy / distance;
  const firstX = centerX + occluderRadius * (ux * cos - uy * sin);
  const firstY = centerY + occluderRadius * (ux * sin + uy * cos);
  const secondX = centerX + occluderRadius * (ux * cos + uy * sin);
  const secondY = centerY + occluderRadius * (uy * cos - ux * sin);
  drawEdgeShadow(
    shadows,
    firstX,
    firstY,
    secondX,
    secondY,
    lightX,
    lightY,
    radius,
    0,
  );
}

/**
 * Draw the region one edge hides, as quads that stay outside the light's
 * circle all the way across.
 *
 * Pushing both ends of an edge out along their own rays is not enough on its
 * own: the straight far side of the resulting quad cuts the corner between
 * them, and for a wide edge it cuts inside the circle and leaves shadow
 * undrawn. Two things fix that. A wide edge is split in half until each piece
 * subtends at most `MAX_SHADOW_PIECE_ANGLE`, and each piece reaches out to
 * `radius / cos(half its angle)`, the distance at which its far side just
 * touches the circle.
 */
function drawEdgeShadow(
  shadows: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  lightX: number,
  lightY: number,
  radius: number,
  depth: number,
): void {
  const firstDistance = Math.hypot(ax - lightX, ay - lightY);
  const secondDistance = Math.hypot(bx - lightX, by - lightY);
  // An end sitting on the light hides nothing along that ray.
  if (firstDistance === 0 || secondDistance === 0) return;

  const angle = subtendedAngle(ax, ay, bx, by, lightX, lightY);
  if (angle > MAX_SHADOW_PIECE_ANGLE && depth < MAX_SHADOW_SPLIT_DEPTH) {
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    const next = depth + 1;
    drawEdgeShadow(shadows, ax, ay, midX, midY, lightX, lightY, radius, next);
    drawEdgeShadow(shadows, midX, midY, bx, by, lightX, lightY, radius, next);
    return;
  }
  // The light lies on the edge, which hides no area at all.
  if (angle >= Math.PI - STRAIGHT_ANGLE_EPSILON) return;

  const reach = Math.max(
    firstDistance,
    secondDistance,
    radius / Math.cos(angle / 2),
  );
  const firstScale = reach / firstDistance;
  const secondScale = reach / secondDistance;
  shadows
    .poly([
      ax,
      ay,
      bx,
      by,
      lightX + (bx - lightX) * secondScale,
      lightY + (by - lightY) * secondScale,
      lightX + (ax - lightX) * firstScale,
      lightY + (ay - lightY) * firstScale,
    ])
    .fill(SHADOW_FILL);
}

/** The angle, from 0 to PI, that a segment covers as seen from a point. */
function subtendedAngle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  fromX: number,
  fromY: number,
): number {
  const firstX = ax - fromX;
  const firstY = ay - fromY;
  const secondX = bx - fromX;
  const secondY = by - fromY;
  return Math.atan2(
    Math.abs(firstX * secondY - firstY * secondX),
    firstX * secondX + firstY * secondY,
  );
}

function scaleColor(color: number, level: number): number {
  const r = Math.round(((color >> 16) & 0xff) * level);
  const g = Math.round(((color >> 8) & 0xff) * level);
  const b = Math.round((color & 0xff) * level);
  return (r << 16) | (g << 8) | b;
}

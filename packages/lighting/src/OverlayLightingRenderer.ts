import { Vec2Buffer } from "@yagejs/core";
import { Container, Graphics } from "pixi.js";
import type { FillGradient } from "pixi.js";
import { SceneRenderTreeKey, radialGradient } from "@yagejs/renderer";
import { AmbientFill } from "./ambient-fill.js";
import { CameraView } from "./camera-view.js";
import { coneMidHalfAngle } from "./cone.js";
import { LightingComposite } from "./LightingComposite.js";
import type { LightSource } from "./LightSource.js";
import { OccluderWatch } from "./occlusion.js";
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
  coneSoftness: number;
  /** Half-spread of the drawn pie slice, in radians. */
  coneHalf: number;
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

/**
 * Draws ambient colour plus radial lights into an offscreen buffer, then
 * multiplies that buffer over the scene.
 *
 * Coloured lights tint every surface they reach. A light with a cone is drawn
 * as a pie slice aimed along its entity's world rotation. An enabled occluder
 * is opaque: each light is drawn through an inverse mask covering everything
 * its occluders hide.
 *
 * Shadow edges are hard whatever a light's `size` says, and a cone's edge is
 * hard whatever its `softness` says. At `size: 0` with an unsoftened cone the
 * picture is exactly what `LightingWorld.levelAt()` reports; above either, the
 * drawn edge runs along the middle of the soft border the query answers with,
 * so the two agree everywhere except inside that border.
 *
 * The bounced light the scene resolved to reaches the picture through
 * {@link LightingComposite}, which every lighting renderer shares.
 */
export class OverlayLightingRenderer implements LightingRenderer {
  private readonly positionScratch = new Vec2Buffer();
  private readonly world;
  private readonly source = new Container();
  private readonly ambient: AmbientFill;
  private readonly composite: LightingComposite;
  private readonly visuals = new Map<LightSource, SourceVisual>();
  private readonly occluders = new OccluderWatch();
  /** Camera transform the shadow masks are drawn under. */
  private readonly view = new CameraView();
  private width: number;
  private height: number;
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
    this.ambient = new AmbientFill("lighting-ambient");
    this.source.addChild(this.ambient.graphics);
    this.composite = new LightingComposite(context.renderer, {
      source: this.source,
      parent: layer.container,
      width,
      height,
      resolutionScale,
      antialias: options.antialias ?? true,
      bounce: context.bounce,
      label: `lighting:${context.scene.name}`,
    });
  }

  render(frame: LightingRenderFrame): void {
    if (this.destroyed) {
      throw new Error("OverlayLightingRenderer.render called after destroy().");
    }

    this.occluders.sync(this.world.occluders);
    let changed = this.resize(frame.width, frame.height);
    changed = this.ambient.sync(this.world, this.width, this.height) || changed;
    changed = this.syncShadowView(frame) || changed;
    changed = this.syncSources(frame) || changed;
    if (changed) this.composite.invalidate();
    this.composite.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const visual of this.visuals.values()) {
      visual.gradient.destroy();
    }
    this.visuals.clear();
    this.occluders.clear();
    this.composite.destroy();
    this.source.destroy({ children: true });
  }

  private resize(width: number, height: number): boolean {
    if (width === this.width && height === this.height) return false;
    assertPositive(width, "Lighting viewport width");
    assertPositive(height, "Lighting viewport height");
    this.width = width;
    this.height = height;
    this.composite.resize(width, height);
    return true;
  }

  /** Follow the camera, and report whether a drawn mask moved with it. */
  private syncShadowView(frame: LightingRenderFrame): boolean {
    if (!this.view.read(frame)) return false;
    let masked = false;
    for (const visual of this.visuals.values()) {
      if (!visual.shadows) continue;
      this.view.applyTo(visual.shadows);
      masked = masked || visual.masked;
    }
    return masked;
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
      const coneSoftness = source.coneSoftness;
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
        setCone(visual, coneAngle, coneSoftness);
        redrawLight(visual);
        changed = true;
      } else if (
        visual.radius !== radius ||
        visual.coneAngle !== coneAngle ||
        visual.coneSoftness !== coneSoftness
      ) {
        visual.radius = radius;
        setCone(visual, coneAngle, coneSoftness);
        redrawLight(visual);
        changed = true;
      }

      // Shadow geometry rides the camera transform; a light's own graphic is
      // already projected, so its cone turns by the camera's rotation here.
      const aim = coneAngle < FULL_TURN ? source.rotation - this.view.turn : 0;
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
      visual.shadowRevision === this.occluders.revision &&
      visual.castShadows === castShadows &&
      visual.shadowX === worldX &&
      visual.shadowY === worldY &&
      visual.shadowRadius === radius
    ) {
      return false;
    }
    visual.shadowRevision = this.occluders.revision;
    visual.castShadows = castShadows;
    visual.shadowX = worldX;
    visual.shadowY = worldY;
    visual.shadowRadius = radius;

    const count = castShadows ? this.occluders.footprintCount() : 0;
    const shadows =
      count > 0
        ? (visual.shadows ?? this.createShadows(visual))
        : visual.shadows;
    let drawn = false;
    if (shadows) {
      shadows.clear();
      for (let i = 0; i < count; i++) {
        const footprint = this.occluders.get(i);
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

  private createShadows(visual: SourceVisual): Graphics {
    const shadows = new Graphics();
    shadows.label = "lighting-shadows";
    this.view.applyTo(shadows);
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
    const coneSoftness = source.coneSoftness;
    const gradientRadius = gradientRadiusFor(coneAngle, radius);
    const aim = coneAngle < FULL_TURN ? source.rotation - this.view.turn : 0;
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
      coneSoftness,
      coneHalf: coneMidHalfAngle(coneAngle, coneSoftness),
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

/** Record a cone and the half-spread the hard pie slice is drawn at. */
function setCone(
  visual: SourceVisual,
  coneAngle: number,
  coneSoftness: number,
): void {
  visual.coneAngle = coneAngle;
  visual.coneSoftness = coneSoftness;
  visual.coneHalf = coneMidHalfAngle(coneAngle, coneSoftness);
}

function redrawLight(visual: SourceVisual): void {
  const graphics = visual.graphics.clear();
  if (visual.coneAngle >= FULL_TURN) {
    graphics.circle(0, 0, visual.radius).fill(visual.gradient);
    return;
  }
  const half = visual.coneHalf;
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

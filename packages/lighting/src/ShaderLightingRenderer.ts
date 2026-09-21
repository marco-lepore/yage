import { Vec2Buffer } from "@yagejs/core";
import { Container, Mesh } from "pixi.js";
import type { Geometry, Shader, UniformGroup } from "pixi.js";
import { SceneRenderTreeKey } from "@yagejs/renderer";
import type { RendererPlugin } from "@yagejs/renderer";
import { AmbientFill } from "./ambient-fill.js";
import { CameraView } from "./camera-view.js";
import { coneInnerCosine, coneOuterCosine } from "./cone.js";
import { LightEdgeTexture } from "./light-edges.js";
import { createLightShader, lightQuadGeometry } from "./light-shader.js";
import type { LightUniforms } from "./light-shader.js";
import { LightingComposite } from "./LightingComposite.js";
import type { LightSource } from "./LightSource.js";
import { OccluderWatch } from "./occlusion.js";
import type {
  LightingRenderer,
  LightingRendererContext,
  LightingRendererFactory,
  LightingRenderFrame,
} from "./types.js";
import { FULL_TURN, assertPositive } from "./validation.js";

const DEFAULT_LAYER = "lighting";
const DEFAULT_ORDER = 900;
const DEFAULT_RESOLUTION_SCALE = 1;
/** Cone uniforms for a light that reaches every direction. */
const NO_CONE: readonly number[] = [1, 0, -2, -2];

/** Options for the shader-based lighting renderer. */
export interface ShaderLightingRendererOptions {
  /** Screen-space layer name. Default `"lighting"`. */
  layer?: string;
  /** Layer order when the renderer creates it. Default `900`. */
  order?: number;
  /**
   * Render-target texel density relative to the canvas. Default `1`, where the
   * drawn light matches `levelAt()` pixel for pixel. Lower it to trade that
   * agreement at shadow borders for fill cost.
   */
  resolutionScale?: number;
  /**
   * Renderer to build instead on a device whose browser gives Pixi a WebGL 1
   * context, where this renderer's shader language does not exist. With none
   * given, such a device throws when a scene using this renderer is entered.
   */
  fallback?: LightingRendererFactory;
}

/** One light's quad and the state its drawn pixels came from. */
interface LightVisual {
  readonly mesh: Mesh<Geometry, Shader>;
  readonly shader: Shader;
  readonly uniforms: LightUniforms;
  /** Bumped after a uniform is written, so the GPU copy follows. */
  readonly uniformGroup: UniformGroup;
  /** Whether the light's circle reaches the viewport at all. */
  visible: boolean;
  radius: number;
  size: number;
  intensity: number;
  color: number;
  coneAngle: number;
  coneSoftness: number;
  /** Direction the cone points along, or 0 for a light with no cone. */
  aim: number;
  x: number;
  y: number;
  /** First texel of this light's run in the shared edge texture. */
  base: number;
  edgeCount: number;
  discCount: number;
  /** Outlines the lamp reaches into, which the shader tests pixels against. */
  outlineCount: number;
  /** Whether the run has to be written again this frame. */
  shapesStale: boolean;
  /** Occluder revision, light placement and lamp the run was written from. */
  shapeRevision: number;
  shapeX: number;
  shapeY: number;
  shapeReach: number;
  castShadows: boolean;
}

/**
 * Draws soft-edged radial lights into an offscreen buffer, then multiplies that
 * buffer over the scene.
 *
 * Each light is one quad whose fragment shader runs the projection
 * `LightingWorld.levelAt()` runs: the lamp is a line of width `size` square to
 * the direction from the shaded pixel, every occluder in reach hides a stretch
 * of it, and what is left is how brightly that pixel is lit. A shadow's border
 * therefore widens with the distance from the blocker, a lamp wider than its
 * blocker lights around it, and a cone's `softness` fades its edge — all from
 * one formula, with no geometry per shadow.
 *
 * The drawn picture is what `levelAt()` answers, within the coverage steps the
 * shader counts in and the light buffer's 8 bits per channel. Occluder shapes
 * reach the shader through one data texture the scene's lights share, rebuilt
 * only for the lights that moved.
 *
 * The bounced light the scene resolved to reaches the picture through
 * {@link LightingComposite}, which every lighting renderer shares.
 */
export class ShaderLightingRenderer implements LightingRenderer {
  private readonly positionScratch = new Vec2Buffer();
  private readonly world;
  private readonly source = new Container();
  private readonly ambient: AmbientFill;
  /** Holds every light's quad, under the camera's own transform. */
  private readonly lights = new Container();
  private readonly composite: LightingComposite;
  private readonly visuals = new Map<LightSource, LightVisual>();
  private readonly occluders = new OccluderWatch();
  private readonly view = new CameraView();
  private readonly edges: LightEdgeTexture;
  /** One light's outline runs while it is written: pairs of first edge, count. */
  private readonly outlineRuns: number[] = [];
  private width: number;
  private height: number;
  private destroyed = false;

  constructor(
    context: LightingRendererContext,
    options: ShaderLightingRendererOptions = {},
  ) {
    const resolutionScale = options.resolutionScale ?? DEFAULT_RESOLUTION_SCALE;
    assertPositive(resolutionScale, "ShaderLightingRenderer resolutionScale");

    this.world = context.world;
    const { width, height } = context.renderer.virtualSize;
    this.width = width;
    this.height = height;

    const tree = context.scene.tryResolveScoped(SceneRenderTreeKey);
    if (!tree) {
      throw new Error(
        `ShaderLightingRenderer: scene "${context.scene.name}" has no render tree. ` +
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
        `ShaderLightingRenderer: layer "${layer.name}" must use screen space.`,
      );
    }

    this.edges = new LightEdgeTexture(`lighting-edges:${context.scene.name}`);
    this.source.label = `lighting-source:${context.scene.name}`;
    this.lights.label = "lighting-lights";
    this.ambient = new AmbientFill("lighting-ambient");
    this.source.addChild(this.ambient.graphics, this.lights);
    this.composite = new LightingComposite(context.renderer, {
      source: this.source,
      parent: layer.container,
      width,
      height,
      resolutionScale,
      bounce: context.bounce,
      label: `lighting:${context.scene.name}`,
    });
  }

  render(frame: LightingRenderFrame): void {
    if (this.destroyed) {
      throw new Error("ShaderLightingRenderer.render called after destroy().");
    }

    this.occluders.sync(this.world.occluders);
    let changed = this.resize(frame.width, frame.height);
    changed = this.ambient.sync(this.world, this.width, this.height) || changed;
    if (this.view.read(frame)) {
      this.view.applyTo(this.lights);
      changed = true;
    }
    changed = this.syncSources(frame) || changed;
    this.syncShapes();
    if (changed) this.composite.invalidate();
    this.composite.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const visual of this.visuals.values()) {
      visual.shader.destroy();
    }
    this.visuals.clear();
    this.occluders.clear();
    this.composite.destroy();
    this.source.destroy({ children: true });
    this.edges.destroy();
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

  /** Follow each light's placement and settings. Returns whether any changed. */
  private syncSources(frame: LightingRenderFrame): boolean {
    let changed = false;
    for (const [source, visual] of this.visuals) {
      if (this.world.sources.has(source)) continue;
      visual.shader.destroy();
      visual.mesh.removeFromParent();
      visual.mesh.destroy();
      this.visuals.delete(source);
      changed = true;
    }

    const camera = frame.camera;
    const zoom = Math.abs(camera?.effectiveZoom ?? 1);
    for (const source of this.world.sources) {
      const position = source.getPositionInto(this.positionScratch);
      const worldX = position.x;
      const worldY = position.y;
      const radius = source.radius;
      const size = source.size;
      const castShadows = source.castShadows;
      // A light with no cone points nowhere, so turning its entity changes no
      // pixel and costs no redraw.
      const coneAngle = source.coneAngle;
      const aim = coneAngle < FULL_TURN ? source.rotation : 0;
      const projected = camera
        ? camera.worldToScreenInto(this.positionScratch, worldX, worldY)
        : position;
      // A light the viewport misses is left out of the buffer and out of the
      // edge texture, so an off-screen crowd costs neither fill nor uploads.
      const visible = this.reaches(projected.x, projected.y, radius * zoom);

      let visual = this.visuals.get(source);
      if (!visual) {
        visual = this.createVisual();
        this.visuals.set(source, visual);
      } else if (
        visual.x === worldX &&
        visual.y === worldY &&
        visual.radius === radius &&
        visual.size === size &&
        visual.intensity === source.intensity &&
        visual.color === source.color &&
        visual.coneAngle === coneAngle &&
        visual.coneSoftness === source.coneSoftness &&
        visual.aim === aim &&
        visual.castShadows === castShadows &&
        visual.visible === visible &&
        visual.shapeRevision === this.occluders.revision
      ) {
        continue;
      }
      // A light that stayed outside the view drew nothing either way.
      if (visible || visual.visible) changed = true;

      visual.shapesStale =
        visual.visible !== visible ||
        visual.shapeX !== worldX ||
        visual.shapeY !== worldY ||
        visual.shapeReach !== radius + size / 2 ||
        visual.castShadows !== castShadows ||
        visual.shapeRevision !== this.occluders.revision;
      visual.visible = visible;
      visual.x = worldX;
      visual.y = worldY;
      visual.radius = radius;
      visual.size = size;
      visual.intensity = source.intensity;
      visual.color = source.color;
      visual.coneAngle = coneAngle;
      visual.coneSoftness = source.coneSoftness;
      visual.aim = aim;
      visual.castShadows = castShadows;

      const mesh = visual.mesh;
      mesh.visible = visible;
      mesh.position.set(worldX, worldY);
      mesh.scale.set(radius);
      writeLightUniforms(visual, source);
      visual.uniformGroup.update();
    }
    return changed;
  }

  /** Whether a light's drawn circle reaches the viewport. */
  private reaches(x: number, y: number, radius: number): boolean {
    return (
      x + radius >= 0 &&
      y + radius >= 0 &&
      x - radius <= this.width &&
      y - radius <= this.height
    );
  }

  /**
   * Write the occluder shapes each light reads. A light whose placement and
   * occluders are unchanged, and whose run still starts where it did, keeps
   * the texels it already has.
   */
  private syncShapes(): void {
    const edges = this.edges;
    const revision = this.occluders.revision;
    edges.begin();
    for (const visual of this.visuals.values()) {
      if (!visual.shapesStale && visual.base === edges.at) {
        edges.skip(visual.edgeCount + visual.discCount + visual.outlineCount);
        continue;
      }
      if (visual.visible) {
        this.writeShapes(visual);
      } else {
        visual.base = edges.at;
        visual.edgeCount = 0;
        visual.discCount = 0;
        visual.outlineCount = 0;
      }
      visual.shapesStale = false;
      visual.shapeRevision = revision;
      visual.shapeX = visual.x;
      visual.shapeY = visual.y;
      visual.shapeReach = visual.radius + visual.size / 2;
      const span = visual.uniforms.uEdgeSpan;
      span[0] = visual.base;
      span[1] = visual.edgeCount;
      span[2] = visual.discCount;
      span[3] = visual.outlineCount;
      visual.uniformGroup.update();
    }
    edges.flush();
  }

  /**
   * Write one light's run: every outline edge first, then every disc, then one
   * texel per outline the lamp reaches into, each in coordinates measured from
   * the light. An occluder that holds the light is left out, so a lamp mounted
   * on a pillar still lights the room.
   *
   * Projecting an outline's edges hides every part of the lamp whose straight
   * line back to a pixel crosses that outline. It leaves one case: a pixel
   * inside the outline sees lamp points that are buried in the outline too,
   * and those are joined to it by a line that crosses nothing. Only a lamp
   * within its own half-width of the outline has such points, so those
   * outlines carry a run of their own and the shader counts crossings against
   * them.
   */
  private writeShapes(visual: LightVisual): void {
    const edges = this.edges;
    const outlines = this.outlineRuns;
    visual.base = edges.at;
    visual.edgeCount = 0;
    visual.discCount = 0;
    visual.outlineCount = 0;
    outlines.length = 0;
    if (!visual.castShadows) return;

    const x = visual.x;
    const y = visual.y;
    const halfSize = visual.size / 2;
    const reach = visual.radius + halfSize;
    const count = this.occluders.footprintCount();
    for (let i = 0; i < count; i++) {
      const footprint = this.occluders.get(i);
      if (footprint.isCircle) continue;
      if (!footprint.withinRange(x, y, reach)) continue;
      if (footprint.contains(x, y)) continue;
      const vertices = footprint.vertices;
      const vertexCount = footprint.vertexCount;
      if (footprint.withinRange(x, y, halfSize)) {
        outlines.push(visual.edgeCount, vertexCount);
      }
      for (let k = 0, j = vertexCount - 1; k < vertexCount; j = k++) {
        edges.pushEdge(
          vertices[j * 2]! - x,
          vertices[j * 2 + 1]! - y,
          vertices[k * 2]! - x,
          vertices[k * 2 + 1]! - y,
        );
        visual.edgeCount++;
      }
    }
    for (let i = 0; i < count; i++) {
      const footprint = this.occluders.get(i);
      if (!footprint.isCircle) continue;
      if (!footprint.withinRange(x, y, reach)) continue;
      if (footprint.contains(x, y)) continue;
      edges.pushDisc(
        footprint.centerX - x,
        footprint.centerY - y,
        footprint.radius,
      );
      visual.discCount++;
    }

    for (let i = 0; i < outlines.length; i += 2) {
      edges.pushOutline(outlines[i]!, outlines[i + 1]!);
      visual.outlineCount++;
    }
  }

  private createVisual(): LightVisual {
    const shader = createLightShader(this.edges.source);
    const mesh = new Mesh({ geometry: lightQuadGeometry(), shader });
    mesh.label = "lighting-light";
    mesh.blendMode = "add";
    this.lights.addChild(mesh);
    const uniformGroup = shader.resources["lightUniforms"] as UniformGroup;
    return {
      mesh,
      shader,
      uniformGroup,
      uniforms: uniformGroup.uniforms as unknown as LightUniforms,
      visible: false,
      radius: NaN,
      size: NaN,
      intensity: NaN,
      color: NaN,
      coneAngle: NaN,
      coneSoftness: NaN,
      aim: NaN,
      x: NaN,
      y: NaN,
      base: -1,
      edgeCount: 0,
      discCount: 0,
      outlineCount: 0,
      shapesStale: true,
      shapeRevision: -1,
      shapeX: NaN,
      shapeY: NaN,
      shapeReach: NaN,
      castShadows: true,
    };
  }
}

/**
 * Return a per-scene factory for the shader-based renderer.
 *
 * A browser that gives Pixi a WebGL 1 context has none of the shader language
 * this renderer is written in, which is the one device limit it can read
 * before drawing. Such a device gets `options.fallback`, or an error naming
 * the option when none is given. A shader that fails to build on a context
 * that does have the language is reported to the browser console by Pixi and
 * by the driver, not to this factory, so nothing here can answer it.
 */
export function shaderLighting(
  options: ShaderLightingRendererOptions = {},
): LightingRendererFactory {
  return (context) => {
    if (usesWebGL1(context.renderer)) {
      const fallback = options.fallback;
      if (!fallback) {
        throw new Error(
          `ShaderLightingRenderer: scene "${context.scene.name}" runs on a ` +
            "WebGL 1 context, whose shader language cannot express this " +
            "renderer. Pass shaderLighting({ fallback }) with another " +
            "renderer factory for such devices.",
        );
      }
      return fallback(context);
    }
    return new ShaderLightingRenderer(context, options);
  };
}

/** Whether Pixi settled on a WebGL 1 context for this renderer. */
function usesWebGL1(renderer: RendererPlugin): boolean {
  const live = renderer.application.renderer as {
    context?: { webGLVersion?: number };
  };
  return live.context?.webGLVersion === 1;
}

/** Copy a light's colour, reach and cone into the uniforms its quad reads. */
function writeLightUniforms(visual: LightVisual, source: LightSource): void {
  const { uLightColor, uReach, uCone } = visual.uniforms;
  const color = source.color;
  const intensity = source.intensity;
  uLightColor[0] = (((color >> 16) & 0xff) / 255) * intensity;
  uLightColor[1] = (((color >> 8) & 0xff) / 255) * intensity;
  uLightColor[2] = ((color & 0xff) / 255) * intensity;
  uReach[0] = source.radius;
  uReach[1] = source.size / 2;
  const coneAngle = source.coneAngle;
  if (coneAngle >= FULL_TURN) {
    uCone.set(NO_CONE);
    return;
  }
  const rotation = source.rotation;
  uCone[0] = Math.cos(rotation);
  uCone[1] = Math.sin(rotation);
  uCone[2] = coneOuterCosine(coneAngle);
  uCone[3] = coneInnerCosine(coneAngle, source.coneSoftness);
}

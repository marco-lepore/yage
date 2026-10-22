import { UniformGroup } from "pixi.js";
import { SpriteLightingKey } from "@yagejs/renderer/api";
import { LightEdgeTexture } from "./light-edges.js";
import { OccluderWatch } from "./occlusion.js";
import { writeLightShapes } from "./write-light-shapes.js";
import type { LightShapeSpan } from "./write-light-shapes.js";
import { coneInnerCosine, coneOuterCosine } from "./cone.js";
import {
  SURFACE_GL,
  SURFACE_GPU_LAYOUT,
  SURFACE_WGSL,
} from "./surface-shader.js";
import type {
  LightingRenderer,
  LightingRendererContext,
  LightingRendererFactory,
} from "./types.js";

/** Provides per-sprite lighting, without multiplying the completed scene. */
class SurfaceLightingRenderer implements LightingRenderer {
  private readonly edges: LightEdgeTexture;
  private readonly lights: LightEdgeTexture;
  private readonly occluders = new OccluderWatch();
  private readonly outlines: number[] = [];
  private readonly uniforms = new UniformGroup({
    uAmbient: { value: new Float32Array(4), type: "vec4<f32>" },
  });
  private readonly span: LightShapeSpan = {
    x: 0,
    y: 0,
    radius: 1,
    size: 0,
    castShadows: true,
    base: 0,
    edgeCount: 0,
    discCount: 0,
    outlineCount: 0,
  };

  constructor(private readonly context: LightingRendererContext) {
    if (context.bounce !== null)
      throw new Error(
        "surfaceLighting: bounce is not supported. Set the scene's lighting.bounce to null.",
      );
    const backend = context.renderer.capabilities.backend;
    if (backend === "webgl1")
      throw new Error("surfaceLighting: WebGL2 or WebGPU is required.");
    this.uniforms.isStatic = backend === "webgpu";
    this.edges = new LightEdgeTexture(`surface-edges:${context.scene.name}`);
    this.lights = new LightEdgeTexture(`surface-lights:${context.scene.name}`);
    context.scene.registerScoped(SpriteLightingKey, {
      kind: "surface",
      glsl: SURFACE_GL,
      wgsl: SURFACE_WGSL,
      resources: {
        lightingUniforms: this.uniforms,
        uLights: this.lights.source,
        uEdges: this.edges.source,
      },
      gpuLayout: SURFACE_GPU_LAYOUT,
    });
  }

  render(): void {
    const world = this.context.world;
    this.occluders.sync(world.occluders);
    this.edges.begin();
    this.lights.begin();
    let count = 0;
    for (const light of world.sources) {
      if (light.intensity === 0) continue;
      const point = light.position;
      Object.assign(this.span, {
        x: point.x,
        y: point.y,
        radius: light.radius,
        size: light.size,
        castShadows: light.castShadows,
      });
      writeLightShapes(this.edges, this.occluders, this.span, this.outlines);
      this.lights.pushValues(point.x, point.y, light.radius, light.height);
      const color = light.color;
      this.lights.pushValues(
        (((color >> 16) & 255) / 255) * light.intensity,
        (((color >> 8) & 255) / 255) * light.intensity,
        ((color & 255) / 255) * light.intensity,
        light.size / 2,
      );
      if (light.coneAngle >= Math.PI * 2) this.lights.pushValues(1, 0, -2, -2);
      else
        this.lights.pushValues(
          Math.cos(light.rotation),
          Math.sin(light.rotation),
          coneOuterCosine(light.coneAngle),
          coneInnerCosine(light.coneAngle, light.coneSoftness),
        );
      this.lights.pushValues(
        this.span.base,
        this.span.edgeCount,
        this.span.discCount,
        this.span.outlineCount,
      );
      count++;
    }
    this.edges.flush();
    this.lights.flush();
    const ambient = world.ambientColor;
    this.uniforms.uniforms.uAmbient.set([
      (((ambient >> 16) & 255) / 255) * world.ambientLevel,
      (((ambient >> 8) & 255) / 255) * world.ambientLevel,
      ((ambient & 255) / 255) * world.ambientLevel,
      count,
    ]);
    this.uniforms.update();
  }

  destroy(): void {
    this.edges.destroy();
    this.lights.destroy();
    this.occluders.clear();
  }
}

/**
 * Light every sprite on a world layer individually, with its normal map,
 * specular highlights, and emission. A sprite without a material draws with
 * `litMaterial()` defaults; `unlitMaterial()` opts one sprite out.
 */
export function surfaceLighting(): LightingRendererFactory {
  return (context) => new SurfaceLightingRenderer(context);
}

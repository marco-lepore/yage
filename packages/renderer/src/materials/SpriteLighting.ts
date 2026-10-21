import { ServiceKey } from "@yagejs/core";
import type { ShaderUniforms, TextureSourceResource } from "../public-types.js";

/**
 * @internal Per-scene shader code and data supplied by a lighting backend that
 * shades sprites individually. The sprite shader calls
 * `evaluateLighting(base, normal, point, specular, shininess)` with the
 * surface color, its normal, its world position, its specular color, and its
 * exponent, and adds emission to the result.
 */
export interface SurfaceLightingInputs {
  readonly kind: "surface";
  /** GLSL declaring its own uniforms and samplers and defining `evaluateLighting`. */
  readonly glsl: string;
  /** WGSL binding its resources in group 3 and defining `evaluateLighting`. */
  readonly wgsl: string;
  /** Shader resources, keyed by the names the two sources declare. */
  readonly resources: Readonly<
    Record<string, ShaderUniforms | TextureSourceResource>
  >;
  /** WebGPU layout of bind group 3, matching the WGSL declarations. */
  readonly gpuLayout: readonly GPUBindGroupLayoutEntry[];
}

/**
 * @internal What the scene's lighting backend does with sprites: shades them
 * individually (`"surface"`), or multiplies the finished scene
 * (`"composite"`), which cannot honor a material's own response.
 */
export type SpriteLighting =
  | SurfaceLightingInputs
  | { readonly kind: "composite" };

/** @internal Plugin infrastructure; membership stays in LightingWorld. */
export const SpriteLightingKey = new ServiceKey<SpriteLighting>(
  "renderer.spriteLighting",
  { scope: "scene" },
);

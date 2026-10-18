import { ServiceKey } from "@yagejs/core";
import type { ShaderUniforms, TextureSourceResource } from "../public-types.js";

/** @internal Per-scene shader inputs supplied by the active lighting backend. */
export interface SurfaceLightingInputs {
  readonly kind: "surface";
  /** Defines evaluateLighting(base, normal, point, specular, shininess). */
  readonly glsl: string;
  readonly wgsl: string;
  readonly uniforms: ShaderUniforms;
  readonly lights: TextureSourceResource;
  readonly edges: TextureSourceResource;
}

/** @internal A compositor cannot honor an explicitly unlit surface. */
export type SpriteLighting =
  | SurfaceLightingInputs
  | { readonly kind: "composite" };

/** @internal Plugin infrastructure; membership stays in LightingWorld. */
export const SpriteLightingKey = new ServiceKey<SpriteLighting>(
  "renderer.spriteLighting",
  { scope: "scene" },
);

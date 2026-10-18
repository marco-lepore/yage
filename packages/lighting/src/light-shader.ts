import {
  LIGHT_VISIBILITY_GL,
  LIGHT_VISIBILITY_WGSL,
} from "./light-visibility.js";
export { EDGE_TEXTURE_WIDTH, COVERAGE_SLOTS } from "./light-visibility.js";
import { Geometry, GlProgram, GpuProgram, Shader } from "pixi.js";
import type { TextureSource } from "pixi.js";

/**
 * @internal The GPU side of {@link ShaderLightingRenderer}: one quad per light,
 * shaded per pixel by the same projection `LightingWorld.levelAt()` runs on the
 * processor.
 *
 * Every occluder edge and disc in reach of any light sits in one data texture,
 * and each light reads the run that belongs to it. The shader works in
 * light-local world pixels — the pixel, the edges and the lamp are all measured
 * from the light itself — so a scene far from the origin does not spend float
 * precision on its own coordinates.
 */

const VERTEX_GL = /* glsl */ `
in vec2 aPosition;
out vec2 vLocal;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vLocal = aPosition;
}
`;

const FRAGMENT_GL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
// The shader language gives a sampler lowp by default, which would round the
// edge texture's coordinates to half floats on a driver that honours it.
precision highp sampler2D;

in vec2 vLocal;
out vec4 finalColor;

uniform vec3 uLightColor;
uniform vec2 uReach;
uniform vec4 uCone;
uniform vec4 uEdgeSpan;
uniform sampler2D uEdges;

${LIGHT_VISIBILITY_GL}
void main(void) {
  float weight = lightWeight(vLocal * uReach.x, uReach, uCone, uEdgeSpan);
  finalColor = vec4(uLightColor * weight, 1.0);
}
`;

const SHADER_WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};

struct LightUniforms {
  uLightColor: vec3<f32>,
  uReach: vec2<f32>,
  uCone: vec4<f32>,
  uEdgeSpan: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;
@group(2) @binding(0) var<uniform> lightUniforms : LightUniforms;
@group(2) @binding(1) var uEdges : texture_2d<f32>;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vLocal: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  let mvp = globalUniforms.uProjectionMatrix *
    globalUniforms.uWorldTransformMatrix *
    localUniforms.uTransformMatrix;
  let clip = mvp * vec3<f32>(aPosition, 1.0);
  return VSOutput(vec4<f32>(clip.xy, 0.0, 1.0), aPosition);
}

${LIGHT_VISIBILITY_WGSL}
@fragment
fn mainFragment(@location(0) vLocal: vec2<f32>) -> @location(0) vec4<f32> {
  let weight = lightWeight(vLocal * lightUniforms.uReach.x, lightUniforms.uReach, lightUniforms.uCone, lightUniforms.uEdgeSpan);
  return vec4<f32>(lightUniforms.uLightColor * weight, 1.0);
}
`;

/** WebGPU shader stages, spelled the way `GPUShaderStage` spells them. */
const VERTEX_AND_FRAGMENT = 1 | 2;
const FRAGMENT_ONLY = 2;

/**
 * Bind-group layout for the three groups the shader declares. It replaces the
 * one Pixi reads out of the WGSL, which asks every texture for a filterable
 * sample type: the edge texture holds full-precision coordinates rather than
 * colour, and that format is sampled unfiltered.
 */
const GPU_LAYOUT: GPUBindGroupLayoutEntry[][] = [
  [
    {
      binding: 0,
      visibility: VERTEX_AND_FRAGMENT,
      buffer: { type: "uniform" },
    },
  ],
  [
    {
      binding: 0,
      visibility: VERTEX_AND_FRAGMENT,
      buffer: { type: "uniform" },
    },
  ],
  [
    {
      binding: 0,
      visibility: VERTEX_AND_FRAGMENT,
      buffer: { type: "uniform" },
    },
    {
      binding: 1,
      visibility: FRAGMENT_ONLY,
      texture: {
        sampleType: "unfilterable-float",
        viewDimension: "2d",
        multisampled: false,
      },
    },
  ],
];

let glProgram: GlProgram | undefined;
let gpuProgram: GpuProgram | undefined;
let quadGeometry: Geometry | undefined;

/** The unit quad every light's mesh is drawn from, in light radii. */
export function lightQuadGeometry(): Geometry {
  quadGeometry ??= new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        format: "float32x2",
        stride: 2 * 4,
        offset: 0,
      },
    },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  return quadGeometry;
}

/** The one WebGL program every light's quad is drawn with. */
function lightGlProgram(): GlProgram {
  glProgram ??= GlProgram.from({
    vertex: VERTEX_GL,
    fragment: FRAGMENT_GL,
    name: "yage-lighting-shadow",
  });
  return glProgram;
}

/**
 * @internal The light program's sources as Pixi hands them to a driver, so a
 * link test compiles exactly what the renderer would draw with.
 */
export function lightProgramSources(): {
  readonly vertex: string;
  readonly fragment: string;
} {
  const { vertex, fragment } = lightGlProgram();
  if (vertex == null || fragment == null) {
    throw new Error("lightProgramSources: the light program has no sources.");
  }
  return { vertex, fragment };
}

/** Uniforms one light writes before its quad is drawn. */
export interface LightUniforms {
  /** RGB tint already scaled by the light's intensity. */
  uLightColor: Float32Array;
  /** Reach in world pixels: the light's radius, then the lamp's half-width. */
  uReach: Float32Array;
  /** Aim x, aim y, cosine where the cone ends, cosine where it is full. */
  uCone: Float32Array;
  /**
   * First texel of this light's run, then its edge count, its disc count, and
   * how many outlines the lamp reaches into.
   */
  uEdgeSpan: Float32Array;
}

/**
 * Build one light's shader over the shared edge texture. Both programs are
 * shared by every light in every scene, so a hundred lights compile one WebGL
 * program and one WebGPU module.
 */
export function createLightShader(edges: TextureSource): Shader {
  const glProgram = lightGlProgram();
  gpuProgram ??= new GpuProgram({
    vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
    fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
    gpuLayout: GPU_LAYOUT,
    name: "yage-lighting-shadow",
  });
  return new Shader({
    glProgram,
    gpuProgram,
    resources: {
      lightUniforms: {
        uLightColor: { value: new Float32Array(3), type: "vec3<f32>" },
        uReach: { value: new Float32Array(2), type: "vec2<f32>" },
        uCone: { value: new Float32Array(4), type: "vec4<f32>" },
        uEdgeSpan: { value: new Float32Array(4), type: "vec4<f32>" },
      },
      // The shader reads texels by index rather than sampling between them, so
      // it declares no sampler and the texture's own format never has to be a
      // filterable one.
      uEdges: edges,
    },
  });
}

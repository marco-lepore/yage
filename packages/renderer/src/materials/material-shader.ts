import {
  Buffer,
  BufferUsage,
  Geometry,
  GlProgram,
  GpuProgram,
  Shader,
  Texture,
  UniformGroup,
} from "pixi.js";
import type { SurfaceLightingInputs } from "./SpriteLighting.js";
import type { MaterialGpu } from "./MaterialBinding.js";

export interface MaterialUniforms {
  uParams: Float32Array;
  uEmission: Float32Array;
  uSpecular: Float32Array;
  uFlags: Float32Array;
}

/** Position, UV, world position, normal transform, tint/alpha, pixel rounding. */
export const MATERIAL_VERTEX_SIZE = 15;

const VERTEX_GL = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
in vec2 aSurface;
in vec4 aNormal;
in vec4 aTint;
in float aRound;
out vec2 vUV;
out vec2 vSurface;
out vec4 vNormal;
out vec4 vTint;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec2 uResolution;
void main() {
  vec2 clip = (uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy;
  if (aRound == 1.0) clip = (floor((clip * 0.5 + 0.5) * uResolution + 0.5) / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
  vUV = aUV;
  vSurface = aSurface;
  vNormal = aNormal;
  vTint = aTint;
}
`;

function fragmentGl(inputs?: SurfaceLightingInputs): string {
  return /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUV;
in vec2 vSurface;
in vec4 vNormal;
in vec4 vTint;
out vec4 finalColor;
uniform vec4 uWorldColorAlpha;
uniform vec4 uParams;
uniform vec4 uEmission;
uniform vec4 uSpecular;
uniform vec4 uFlags;
uniform sampler2D uColorTexture;
uniform sampler2D uNormalTexture;
uniform sampler2D uSpecularTexture;
uniform sampler2D uEmissionTexture;
${inputs?.glsl ?? "vec3 evaluateLighting(vec3 base, vec3 normal, vec2 point, vec3 specular, float shininess) { return base; }"}
void main() {
  vec4 color = texture(uColorTexture, vUV);
  vec3 mappedNormal = texture(uNormalTexture, vUV).rgb * 2.0 - 1.0;
  float specularMask = texture(uSpecularTexture, vUV).r;
  vec4 emissionSample = texture(uEmissionTexture, vUV);
  vec3 emitted = uFlags.z > 1.5 ? emissionSample.rgb : emissionSample.rgb / max(emissionSample.a, 0.000001);
  if (color.a <= 0.0) { finalColor = vec4(0.0); return; }
  vec3 base = uFlags.w > 0.5 ? color.rgb : color.rgb / color.a;
  vec3 normal = vec3(0.0, 0.0, 1.0);
  if (uFlags.x > 0.5 && uParams.x > 0.0) {
    mappedNormal.xy *= vec2(uParams.x, uParams.x * uParams.y);
    if (dot(mappedNormal, mappedNormal) > 0.000001) normal = normalize(mappedNormal);
  }
  normal = normalize(vec3(mat2(vNormal.xy, vNormal.zw) * normal.xy, normal.z));
  vec3 specular = uSpecular.rgb * uParams.z * (uFlags.y > 0.5 ? specularMask : 1.0);
  vec3 emission = uEmission.rgb * uEmission.a * (uFlags.z > 0.5 ? emitted : vec3(1.0));
  vec3 rgb = clamp((evaluateLighting(base, normal, vSurface, specular, uParams.w) + emission) * vTint.rgb, 0.0, 1.0);
  float alpha = color.a * vTint.a;
  finalColor = vec4(rgb * alpha, alpha) * uWorldColorAlpha;
}
`;
}

function shaderGpu(inputs?: SurfaceLightingInputs): string {
  return /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
struct MaterialUniforms {
  uParams: vec4<f32>,
  uEmission: vec4<f32>,
  uSpecular: vec4<f32>,
  uFlags: vec4<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> materialUniforms: MaterialUniforms;
@group(2) @binding(0) var uColorTexture: texture_2d<f32>;
@group(2) @binding(1) var uColorSampler: sampler;
@group(2) @binding(2) var uNormalTexture: texture_2d<f32>;
@group(2) @binding(3) var uNormalSampler: sampler;
@group(2) @binding(4) var uSpecularTexture: texture_2d<f32>;
@group(2) @binding(5) var uSpecularSampler: sampler;
@group(2) @binding(6) var uEmissionTexture: texture_2d<f32>;
@group(2) @binding(7) var uEmissionSampler: sampler;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) surface: vec2<f32>,
  @location(2) normal: vec4<f32>,
  @location(3) tint: vec4<f32>,
};
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>, @location(1) aUV: vec2<f32>, @location(2) aSurface: vec2<f32>, @location(3) aNormal: vec4<f32>, @location(4) aTint: vec4<f32>, @location(5) aRound: f32) -> Output {
  var clip = (globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * vec3<f32>(aPosition, 1.0)).xy;
  if (aRound == 1.0) {
    clip = floor((clip * 0.5 + 0.5) * globalUniforms.uResolution + 0.5) / globalUniforms.uResolution * 2.0 - 1.0;
  }
  return Output(vec4<f32>(clip, 0.0, 1.0), aUV, aSurface, aNormal, aTint);
}
${inputs?.wgsl ?? "fn evaluateLighting(base: vec3<f32>, normal: vec3<f32>, point: vec2<f32>, specular: vec3<f32>, shininess: f32) -> vec3<f32> { return base; }"}
@fragment fn mainFragment(input: Output) -> @location(0) vec4<f32> {
  let color = textureSample(uColorTexture, uColorSampler, input.uv);
  var mappedNormal = textureSample(uNormalTexture, uNormalSampler, input.uv).rgb * 2.0 - 1.0;
  let specularMask = textureSample(uSpecularTexture, uSpecularSampler, input.uv).r;
  let emissionSample = textureSample(uEmissionTexture, uEmissionSampler, input.uv);
  let emitted = select(emissionSample.rgb / max(emissionSample.a, 0.000001), emissionSample.rgb, materialUniforms.uFlags.z > 1.5);
  if (color.a <= 0.0) { return vec4<f32>(0.0); }
  let flags = materialUniforms.uFlags;
  let params = materialUniforms.uParams;
  let base = select(color.rgb / color.a, color.rgb, flags.w > 0.5);
  var normal = vec3<f32>(0.0, 0.0, 1.0);
  if (flags.x > 0.5 && params.x > 0.0) {
    mappedNormal = vec3<f32>(mappedNormal.xy * vec2<f32>(params.x, params.x * params.y), mappedNormal.z);
    if (dot(mappedNormal, mappedNormal) > 0.000001) { normal = normalize(mappedNormal); }
  }
  normal = normalize(vec3<f32>(mat2x2<f32>(input.normal.xy, input.normal.zw) * normal.xy, normal.z));
  let specular = materialUniforms.uSpecular.rgb * params.z * select(1.0, specularMask, flags.y > 0.5);
  let emission = materialUniforms.uEmission.rgb * materialUniforms.uEmission.a * select(vec3<f32>(1.0), emitted, flags.z > 0.5);
  let rgb = clamp((evaluateLighting(base, normal, input.surface, specular, params.w) + emission) * input.tint.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  let alpha = color.a * input.tint.a;
  return vec4<f32>(rgb * alpha, alpha) * globalUniforms.uWorldColorAlpha;
}
`;
}

export function createMaterialGpu(inputs?: SurfaceLightingInputs): MaterialGpu {
  const source = shaderGpu(inputs);
  const layout: GPUBindGroupLayoutEntry[][] = [
    [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
    [{ binding: 0, visibility: 3, buffer: { type: "uniform" } }],
    Array.from({ length: 8 }, (_, binding) =>
      binding % 2 === 0
        ? { binding, visibility: 2, texture: { sampleType: "float" as const } }
        : { binding, visibility: 2, sampler: { type: "filtering" as const } },
    ),
  ];
  if (inputs) layout.push([...inputs.gpuLayout]);
  const group = new UniformGroup(
    {
      uParams: { value: new Float32Array(4), type: "vec4<f32>" },
      uEmission: { value: new Float32Array(4), type: "vec4<f32>" },
      uSpecular: { value: new Float32Array(4), type: "vec4<f32>" },
      uFlags: { value: new Float32Array(4), type: "vec4<f32>" },
    },
    { isStatic: true },
  );
  const resources: Record<string, unknown> = { materialUniforms: group };
  for (const role of ["Color", "Normal", "Specular", "Emission"]) {
    resources[`u${role}Texture`] = Texture.WHITE.source;
    resources[`u${role}Sampler`] = Texture.WHITE.source.style;
  }
  if (inputs) Object.assign(resources, inputs.resources);
  const shader = new Shader({
    glProgram: GlProgram.from({
      vertex: VERTEX_GL,
      fragment: fragmentGl(inputs),
      name: "yage-sprite-material",
    }),
    gpuProgram: GpuProgram.from({
      vertex: { source, entryPoint: "mainVertex" },
      fragment: { source, entryPoint: "mainFragment" },
      gpuLayout: layout,
      name: "yage-sprite-material",
    }),
    resources,
  });
  const vertices = new Float32Array(MATERIAL_VERTEX_SIZE * 4);
  const buffer = new Buffer({
    data: vertices,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  const stride = MATERIAL_VERTEX_SIZE * 4;
  const geometry = new Geometry({
    attributes: {
      aPosition: {
        buffer,
        format: "float32x2",
        stride,
        offset: 0,
      },
      aUV: {
        buffer,
        format: "float32x2",
        stride,
        offset: 8,
      },
      aSurface: { buffer, format: "float32x2", stride, offset: 16 },
      aNormal: { buffer, format: "float32x4", stride, offset: 24 },
      aTint: { buffer, format: "float32x4", stride, offset: 40 },
      aRound: { buffer, format: "float32", stride, offset: 56 },
    },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  return {
    shader,
    geometry,
    group,
    uniforms: group.uniforms,
    previousUniforms: new Float64Array(16).fill(NaN),
    vertices,
    capacity: 1,
  };
}

import {
  LIGHT_VISIBILITY_GL,
  LIGHT_VISIBILITY_WGSL,
} from "./light-visibility.js";

/** Surface shading skips back-facing lights before evaluating shared visibility. */
export const SURFACE_GL = /* glsl */ `
uniform vec4 uAmbient;
uniform sampler2D uLights;
uniform sampler2D uEdges;
${LIGHT_VISIBILITY_GL}
vec4 readLight(int index) {
  return texelFetch(uLights, ivec2(index & 255, index >> 8), 0);
}
vec3 evaluateLighting(vec3 base, vec3 normal, vec2 point, vec3 specular, float shininess) {
  vec3 result = base * uAmbient.rgb;
  for (int i = 0; i < int(uAmbient.w); i++) {
    vec4 position = readLight(i * 4);
    vec2 local = point - position.xy;
    if (length(local) >= position.z) continue;
    vec3 direction = normalize(vec3(-local, position.w));
    float diffuse = max(dot(normal, direction), 0.0);
    // Back-facing light contributes neither diffuse nor specular in this model.
    if (diffuse <= 0.0) continue;
    vec4 color = readLight(i * 4 + 1);
    vec4 cone = readLight(i * 4 + 2);
    vec4 span = readLight(i * 4 + 3);
    float weight = lightWeight(local, vec2(position.z, color.w), cone, span);
    if (weight <= 0.0) continue;
    vec3 halfway = normalize(direction + vec3(0.0, 0.0, 1.0));
    float highlight = pow(max(dot(normal, halfway), 0.0), shininess);
    result += color.rgb * weight * (base * diffuse + specular * highlight);
  }
  return result;
}
`;

/** `GPUShaderStage.FRAGMENT`. The global exists only in browsers with WebGPU. */
const FRAGMENT = 2;

/** Bind group 3 as {@link SURFACE_WGSL} declares it, all read by fragments. */
export const SURFACE_GPU_LAYOUT: readonly GPUBindGroupLayoutEntry[] = [
  { binding: 0, visibility: FRAGMENT, buffer: { type: "uniform" } },
  {
    binding: 1,
    visibility: FRAGMENT,
    texture: { sampleType: "unfilterable-float" },
  },
  {
    binding: 2,
    visibility: FRAGMENT,
    texture: { sampleType: "unfilterable-float" },
  },
];

export const SURFACE_WGSL = /* wgsl */ `
struct LightingUniforms { uAmbient: vec4<f32>, };
@group(3) @binding(0) var<uniform> lightingUniforms: LightingUniforms;
@group(3) @binding(1) var uLights: texture_2d<f32>;
@group(3) @binding(2) var uEdges: texture_2d<f32>;
${LIGHT_VISIBILITY_WGSL}
fn readLight(index: i32) -> vec4<f32> {
  return textureLoad(uLights, vec2<i32>(index & 255, index >> 8), 0);
}
fn evaluateLighting(base: vec3<f32>, normal: vec3<f32>, point: vec2<f32>, specular: vec3<f32>, shininess: f32) -> vec3<f32> {
  var result = base * lightingUniforms.uAmbient.rgb;
  for (var i = 0; i < i32(lightingUniforms.uAmbient.w); i = i + 1) {
    let position = readLight(i * 4);
    let local = point - position.xy;
    if (length(local) >= position.z) { continue; }
    let direction = normalize(vec3<f32>(-local, position.w));
    let diffuse = max(dot(normal, direction), 0.0);
    if (diffuse <= 0.0) { continue; }
    let color = readLight(i * 4 + 1);
    let cone = readLight(i * 4 + 2);
    let span = readLight(i * 4 + 3);
    let weight = lightWeight(local, vec2<f32>(position.z, color.w), cone, span);
    if (weight <= 0.0) { continue; }
    let halfway = normalize(direction + vec3<f32>(0.0, 0.0, 1.0));
    let highlight = pow(max(dot(normal, halfway), 0.0), shininess);
    result += color.rgb * weight * (base * diffuse + specular * highlight);
  }
  return result;
}
`;

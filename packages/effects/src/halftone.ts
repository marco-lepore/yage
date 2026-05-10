import { Filter, GlProgram, GpuProgram } from "pixi.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import type { HalftoneHandle } from "./handles.js";

/** Options for the {@link halftone} preset. */
export interface HalftoneOptions {
  /** Dot grid spacing in pixels — bigger = chunkier dots. Default: 6. */
  size?: number;
  /** Effect mix 0..1 — drives `getIntensity`. Default: 1. */
  amount?: number;
  /** Grid rotation in radians (e.g. `Math.PI/4` for the classic 45°). Default: 0. */
  angle?: number;
}

// ---------------------------------------------------------------------------
// Custom WebGL + WebGPU shader pair: per fragment we look up the underlying
// pixel's luminance, then compute the distance to the nearest dot center on
// a rotated grid. Pixels inside the radius (sized by luminance) survive,
// the rest are pushed to white — producing the comic-print halftone look.
// `uAmount` cross-fades back to the original colour, so intensity 0 reads
// as "filter off" and intensity 1 as "full halftone".
// ---------------------------------------------------------------------------

const VERTEX_GL = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const FRAGMENT_GL = /* glsl */ `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uSize;
uniform float uAmount;
uniform float uAngle;

void main(void) {
  vec4 color = texture(uTexture, vTextureCoord);

  // Pixel-space coordinates so dot grid spacing reads in pixels.
  vec2 px = vTextureCoord / uInputSize.zw;

  // Rotate the grid (cheap mat2). The classic comic-print angle is 45°.
  float c = cos(uAngle);
  float s = sin(uAngle);
  vec2 rotated = mat2(c, -s, s, c) * px;

  // Position inside the cell: 0 in the center, 0.5 at the corners. Guard
  // against a 0/negative uSize so the divide and modulo can't go NaN --
  // public setters clamp on write, but the WGSL backend mirrors this
  // guard and the two should stay symmetric.
  float size = max(uSize, 1.0);
  vec2 cell = mod(rotated, size) / size - 0.5;
  float distToCenter = length(cell);

  // Luminance — Rec. 601 weights are good enough for a stylized effect.
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // Bigger dots in dark regions, smaller in light. 0.5 covers the cell.
  float radius = (1.0 - lum) * 0.5;
  // Pixi v8 doesn't enable OES_standard_derivatives in its GLSL preamble, so
  // fwidth() fails to link on WebGL2 ("no matching overloaded function"); the
  // WGSL backend can't access fwidth in fragment scope either. Match WGSL
  // and use a fixed AA edge — looks fine for the stylized output.
  float edge = 0.02;
  float dot01 = 1.0 - smoothstep(radius - edge, radius + edge, distToCenter);

  vec3 halftoned = mix(vec3(1.0), vec3(0.0), dot01);
  finalColor = vec4(mix(color.rgb, halftoned, uAmount), color.a);
}
`;

const SHADER_WGSL = /* wgsl */ `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct HalftoneUniforms {
  uSize: f32,
  uAmount: f32,
  uAngle: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> halftoneUniforms: HalftoneUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var p = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  p.x = p.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(p, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

// WGSL's % operator on f32 returns a result with the LHS sign --
// '-3.0 % 10.0' is -3.0, not 7.0 like GLSL's mod(). With a rotated grid
// the lookup coords go negative on one side, so we wrap explicitly via
// a floor-based modulo to keep cell coords in [0, size). Without this
// the dot pattern reads as garbage on the negative-rotation half.
fn fmod_pos(x: f32, m: f32) -> f32 {
  return x - floor(x / m) * m;
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @builtin(position) position: vec4<f32>,
) -> @location(0) vec4<f32> {
  let color = textureSample(uTexture, uSampler, uv);

  let px = vec2<f32>(uv.x / gfu.uInputSize.z, uv.y / gfu.uInputSize.w);

  let c = cos(halftoneUniforms.uAngle);
  let s = sin(halftoneUniforms.uAngle);
  let rotated = vec2<f32>(c * px.x - s * px.y, s * px.x + c * px.y);

  let size = max(halftoneUniforms.uSize, 1.0);
  let cell = vec2<f32>(fmod_pos(rotated.x, size), fmod_pos(rotated.y, size)) / size - vec2<f32>(0.5, 0.5);
  let distToCenter = length(cell);

  let lum = dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let radius = (1.0 - lum) * 0.5;
  // WGSL has no fwidth in fragment scope by default — approximate with a
  // small fixed AA edge. Looks fine for the stylized output.
  let edge = 0.02;
  let dot01 = 1.0 - smoothstep(radius - edge, radius + edge, distToCenter);

  let halftoned = mix(vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 0.0, 0.0), dot01);
  let blended = mix(color.rgb, halftoned, halftoneUniforms.uAmount);
  return vec4<f32>(blended.r, blended.g, blended.b, color.a);
}
`;

/** @internal */
class HalftoneFilter extends Filter {
  constructor(size: number, amount: number, angle: number) {
    // The shader divides by `uSize` and modulos against it; a 0 or negative
    // initial value would produce NaN until any setter fired, so clamp at
    // construction.
    const safeSize = Math.max(1, size);
    super({
      glProgram: GlProgram.from({
        vertex: VERTEX_GL,
        fragment: FRAGMENT_GL,
        name: "yage-halftone",
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
        fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
      }),
      resources: {
        halftoneUniforms: {
          uSize: { value: safeSize, type: "f32" },
          uAmount: { value: amount, type: "f32" },
          uAngle: { value: angle, type: "f32" },
        },
      },
    });
  }

  private uniforms(): { uSize: number; uAmount: number; uAngle: number } {
    return this.resources.halftoneUniforms.uniforms as {
      uSize: number;
      uAmount: number;
      uAngle: number;
    };
  }

  get size(): number {
    return this.uniforms().uSize;
  }
  set size(value: number) {
    this.uniforms().uSize = Math.max(1, value);
  }
  get amount(): number {
    return this.uniforms().uAmount;
  }
  set amount(value: number) {
    this.uniforms().uAmount = value;
  }
  get angle(): number {
    return this.uniforms().uAngle;
  }
  set angle(value: number) {
    this.uniforms().uAngle = value;
  }
}

/**
 * Comic-print halftone — convert luminance to a black-and-white dot grid via
 * a custom WebGL+WebGPU shader pair (no `pixi-filters` dep). Distinct from
 * the rest of the palette: not a tint, not a blur, not a noise — a pattern
 * substitution. Useful as a stylization layer on a scene or as a
 * single-component flourish.
 *
 * `setIntensity` cross-fades the original colour back in at intensity 0, so
 * `fadeIn` ramps the dot grid up and `fadeOut` ramps it back to the source.
 */
export const halftone = defineEffect<HalftoneHandle, HalftoneOptions>({
  name: "yage:halftone",
  factory: (options) => {
    let baseAmount = options.amount ?? 1;
    const filter = new HalftoneFilter(
      options.size ?? 6,
      baseAmount,
      options.angle ?? 0,
    );
    const effect: Effect<HalftoneHandle> = {
      filter,
      getIntensity: () => filter.amount / Math.max(baseAmount, 1e-6),
      setIntensity: (v) => {
        filter.amount = baseAmount * v;
      },
      buildExtras: () => ({
        setSize: (value: number) => {
          filter.size = value;
        },
        setAngle: (value: number) => {
          filter.angle = value;
        },
        setAmount: (value: number) => {
          // Preserve the current intensity ratio so a fade in flight keeps
          // animating against the new ceiling instead of snapping back to 1.
          const ratio = filter.amount / Math.max(baseAmount, 1e-6);
          baseAmount = value;
          filter.amount = value * ratio;
        },
      }),
    };
    return effect;
  },
});

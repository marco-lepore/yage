import { Color, Filter, GlProgram, GpuProgram } from "pixi.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import type { ColorizeHandle } from "./handles.js";

/** Options for the {@link colorize} preset. */
export interface ColorizeOptions {
  /**
   * Target colour — the value white maps to. Accepts a numeric hex
   * (`0xf2c14e`) or any string Pixi's `Color` understands (`"#f2c14e"`,
   * `"red"`, `"rgb(255,128,0)"`, …).
   */
  color: number | string;
  /**
   * 0..1 blend between the source and the recoloured output. Drives
   * `getIntensity`. Default: 1 (full replace).
   */
  strength?: number;
}

// ---------------------------------------------------------------------------
// Custom WebGL + WebGPU shader pair. Per fragment we compute the source's
// luminance (Rec. 601), tint that scalar by the target colour, then mix
// back toward the source by `1 - uStrength`. Pixi v8 textures are
// premultiplied alpha, so luminance computed from the sampled RGB already
// folds the source alpha into the result — the output stays correctly
// premultiplied without an explicit `* src.a` on the RGB.
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
uniform vec3 uColor;
uniform float uStrength;

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  vec3 tinted = uColor * lum;
  vec3 mixed = mix(src.rgb, tinted, uStrength);
  finalColor = vec4(mixed, src.a);
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

struct ColorizeUniforms {
  uColor: vec3<f32>,
  uStrength: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> colorizeUniforms: ColorizeUniforms;

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

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @builtin(position) position: vec4<f32>,
) -> @location(0) vec4<f32> {
  let src = textureSample(uTexture, uSampler, uv);
  let lum = dot(src.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let tinted = colorizeUniforms.uColor * lum;
  let mixed = mix(src.rgb, tinted, colorizeUniforms.uStrength);
  return vec4<f32>(mixed, src.a);
}
`;

/** Normalise a `number | string` colour to a `[r, g, b]` triple in 0..1. */
function colorToVec3(color: number | string): [number, number, number] {
  const n = typeof color === "number" ? color : new Color(color).toNumber();
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
  ];
}

/** @internal */
class ColorizeFilter extends Filter {
  constructor(color: number | string, strength: number) {
    super({
      glProgram: GlProgram.from({
        vertex: VERTEX_GL,
        fragment: FRAGMENT_GL,
        name: "yage-colorize",
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
        fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
      }),
      resources: {
        colorizeUniforms: {
          uColor: { value: colorToVec3(color), type: "vec3<f32>" },
          uStrength: { value: strength, type: "f32" },
        },
      },
    });
  }

  private uniforms(): {
    uColor: Float32Array | number[];
    uStrength: number;
  } {
    return this.resources.colorizeUniforms.uniforms as {
      uColor: Float32Array | number[];
      uStrength: number;
    };
  }

  get strength(): number {
    return this.uniforms().uStrength;
  }
  set strength(value: number) {
    this.uniforms().uStrength = value;
  }

  setColor(color: number | string): void {
    const [r, g, b] = colorToVec3(color);
    const u = this.uniforms().uColor;
    u[0] = r;
    u[1] = g;
    u[2] = b;
  }
}

/**
 * Luminance-to-colour recolour — preserves a sprite's value structure (the
 * black/white relationship) while replacing the hue. Pixi's built-in
 * `sprite.tint` MULTIPLIES the source by a tint colour, which turns
 * saturated source pixels into mud (a blue mushroom × yellow tint reads
 * as an olive blob, not a yellow mushroom). `colorize` outputs
 * `mix(sourceRGB, tintColor * L, strength)` instead, where `L` is the
 * standard Rec. 601 luminance — black stays black, white reaches the
 * target colour, midtones blend proportionally. Source alpha is preserved
 * unchanged. Reach for this when pixel-art recolours need to stand out
 * against the existing palette.
 *
 * `setIntensity` cross-fades back to the source at 0, so `fadeIn` ramps
 * the recolour in cleanly. `setColor` / `setStrength` tune the look at
 * runtime.
 */
export const colorize = defineEffect<ColorizeHandle, ColorizeOptions>({
  name: "yage:colorize",
  factory: (options) => {
    let baseStrength = options.strength ?? 1;
    const filter = new ColorizeFilter(options.color, baseStrength);
    const effect: Effect<ColorizeHandle> = {
      filter,
      getIntensity: () => filter.strength / Math.max(baseStrength, 1e-6),
      setIntensity: (v) => {
        filter.strength = baseStrength * v;
      },
      buildExtras: () => ({
        setColor: (color: number | string) => {
          filter.setColor(color);
        },
        setStrength: (value: number) => {
          // Preserve the current intensity ratio so a fade in flight keeps
          // animating against the new ceiling instead of snapping back to 1.
          const ratio = filter.strength / Math.max(baseStrength, 1e-6);
          baseStrength = value;
          filter.strength = value * ratio;
        },
      }),
    };
    return effect;
  },
});

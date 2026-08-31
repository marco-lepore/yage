import { defineEffect } from "@yagejs/renderer";
import type { ColorValue, Effect } from "@yagejs/renderer";
import { Color, Filter, GlProgram, GpuProgram } from "pixi.js";
import type { Container, FilterSystem, RenderSurface, Texture } from "pixi.js";
import type { DissolveHandle } from "./handles.js";
import { validateFinite, validateMinimum, validateRange } from "./validate.js";

/** Options for the {@link dissolve} preset. */
export interface DissolveOptions {
  /** Color of the bright edge at the dissolve boundary. Default: `0x67e8f9`. */
  edgeColor?: ColorValue;
  /** Width of the bright boundary from 0.001 to 0.5. Default: `0.08`. */
  edgeWidth?: number;
  /** Size of the noise cells in host-local pixels. Must be at least 1. Default: `12`. */
  noiseScale?: number;
  /** Softness of the disappearing edge from 0.001 to 0.25. Default: `0.025`. */
  softness?: number;
  /** Finite stable variation of the noise field. Default: `0`. */
  seed?: number;
}

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
uniform vec3 uEdgeColor;
uniform float uProgress;
uniform float uEdgeWidth;
uniform float uNoiseScale;
uniform float uSoftness;
uniform float uSeed;

float hash21(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7)) + uSeed * 17.17) * 43758.5453);
}

float valueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 offset = fract(point);
  vec2 blend = offset * offset * (3.0 - 2.0 * offset);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

void main(void) {
  vec4 source = texture(uTexture, vTextureCoord);
  if (uProgress <= 0.0) {
    finalColor = source;
    return;
  }
  if (uProgress >= 1.0 || source.a <= 0.0) {
    finalColor = vec4(0.0);
    return;
  }

  vec2 pixel = vTextureCoord / uInputSize.zw;
  vec2 noisePoint = pixel / max(uNoiseScale, 1.0);
  float field = valueNoise(noisePoint) * 0.72
    + valueNoise(noisePoint * 2.07 + vec2(19.1, 7.7)) * 0.28;
  float threshold = mix(-uSoftness, 1.0 + uSoftness, uProgress);
  float mask = smoothstep(
    threshold - uSoftness,
    threshold + uSoftness,
    field
  );
  float edge = (1.0 - smoothstep(0.0, uEdgeWidth, abs(field - threshold))) * mask;
  float outputAlpha = source.a * mask;
  vec3 straightSource = source.rgb / max(source.a, 0.00001);
  vec3 straightColor = mix(straightSource, uEdgeColor, edge);
  finalColor = vec4(straightColor * outputAlpha, outputAlpha);
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

struct DissolveUniforms {
  uEdgeColor: vec3<f32>,
  uProgress: f32,
  uEdgeWidth: f32,
  uNoiseScale: f32,
  uSoftness: f32,
  uSeed: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> dissolveUniforms: DissolveUniforms;

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

fn hash21(point: vec2<f32>) -> f32 {
  return fract(sin(
    dot(point, vec2<f32>(127.1, 311.7)) + dissolveUniforms.uSeed * 17.17
  ) * 43758.5453);
}

fn valueNoise(point: vec2<f32>) -> f32 {
  let cell = floor(point);
  let offset = fract(point);
  let blend = offset * offset * (vec2<f32>(3.0) - 2.0 * offset);
  let a = hash21(cell);
  let b = hash21(cell + vec2<f32>(1.0, 0.0));
  let c = hash21(cell + vec2<f32>(0.0, 1.0));
  let d = hash21(cell + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let source = textureSample(uTexture, uSampler, uv);
  if (dissolveUniforms.uProgress <= 0.0) {
    return source;
  }
  if (dissolveUniforms.uProgress >= 1.0 || source.a <= 0.0) {
    return vec4<f32>(0.0);
  }

  let pixel = uv / gfu.uInputSize.zw;
  let noisePoint = pixel / max(dissolveUniforms.uNoiseScale, 1.0);
  let field = valueNoise(noisePoint) * 0.72
    + valueNoise(noisePoint * 2.07 + vec2<f32>(19.1, 7.7)) * 0.28;
  let threshold = mix(-dissolveUniforms.uSoftness, 1.0 + dissolveUniforms.uSoftness, dissolveUniforms.uProgress);
  let mask = smoothstep(
    threshold - dissolveUniforms.uSoftness,
    threshold + dissolveUniforms.uSoftness,
    field
  );
  let edge = (1.0 - smoothstep(0.0, dissolveUniforms.uEdgeWidth, abs(field - threshold))) * mask;
  let outputAlpha = source.a * mask;
  let straightSource = source.rgb / max(source.a, 0.00001);
  let straightColor = mix(straightSource, dissolveUniforms.uEdgeColor, edge);
  return vec4<f32>(straightColor * outputAlpha, outputAlpha);
}
`;

function colorToVec3(color: ColorValue): [number, number, number] {
  const values = new Color(color).toArray();
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

class DissolveFilter extends Filter {
  private noiseScaleLocal: number;
  private yageTarget: Container | undefined;

  constructor(options: DissolveOptions) {
    const edgeWidth = validateRange(
      "dissolve",
      "edgeWidth",
      options.edgeWidth ?? 0.08,
      0.001,
      0.5,
    );
    const noiseScale = validateMinimum(
      "dissolve",
      "noiseScale",
      options.noiseScale ?? 12,
      1,
    );
    const softness = validateRange(
      "dissolve",
      "softness",
      options.softness ?? 0.025,
      0.001,
      0.25,
    );
    const seed = validateFinite("dissolve", "seed", options.seed ?? 0);
    super({
      glProgram: GlProgram.from({
        vertex: VERTEX_GL,
        fragment: FRAGMENT_GL,
        name: "yage-dissolve",
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
        fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
      }),
      resources: {
        dissolveUniforms: {
          uEdgeColor: {
            value: colorToVec3(options.edgeColor ?? 0x67e8f9),
            type: "vec3<f32>",
          },
          uProgress: { value: 0, type: "f32" },
          uEdgeWidth: {
            value: edgeWidth,
            type: "f32",
          },
          uNoiseScale: {
            value: noiseScale,
            type: "f32",
          },
          uSoftness: {
            value: softness,
            type: "f32",
          },
          uSeed: { value: seed, type: "f32" },
        },
      },
    });
    this.noiseScaleLocal = noiseScale;
  }

  private uniforms(): {
    uEdgeColor: Float32Array | number[];
    uProgress: number;
    uEdgeWidth: number;
    uNoiseScale: number;
    uSoftness: number;
    uSeed: number;
  } {
    return this.resources.dissolveUniforms.uniforms as {
      uEdgeColor: Float32Array | number[];
      uProgress: number;
      uEdgeWidth: number;
      uNoiseScale: number;
      uSoftness: number;
      uSeed: number;
    };
  }

  get progress(): number {
    return this.uniforms().uProgress;
  }

  set progress(value: number) {
    this.uniforms().uProgress = clamp(
      validateFinite("dissolve", "intensity", value),
      0,
      1,
    );
  }

  setEdgeColor(color: ColorValue): void {
    const [r, g, b] = colorToVec3(color);
    const target = this.uniforms().uEdgeColor;
    target[0] = r;
    target[1] = g;
    target[2] = b;
  }

  setEdgeWidth(value: number): void {
    this.uniforms().uEdgeWidth = validateRange(
      "dissolve",
      "edgeWidth",
      value,
      0.001,
      0.5,
    );
  }

  setNoiseScale(value: number): void {
    this.noiseScaleLocal = validateMinimum("dissolve", "noiseScale", value, 1);
    this.updateNoiseScale();
  }

  setSoftness(value: number): void {
    this.uniforms().uSoftness = validateRange(
      "dissolve",
      "softness",
      value,
      0.001,
      0.25,
    );
  }

  setSeed(value: number): void {
    this.uniforms().uSeed = validateFinite("dissolve", "seed", value);
  }

  attach(target: Container): void {
    this.yageTarget = target;
    this.updateNoiseScale();
  }

  detach(): void {
    this.yageTarget = undefined;
  }

  private updateNoiseScale(): void {
    const transform = this.yageTarget?.worldTransform;
    const scaleX = transform ? Math.hypot(transform.a, transform.b) : 1;
    const scaleY = transform ? Math.hypot(transform.c, transform.d) : 1;
    this.uniforms().uNoiseScale =
      this.noiseScaleLocal * (scaleX + scaleY) * 0.5;
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    this.updateNoiseScale();
    super.apply(filterManager, input, output, clearMode);
  }
}

/**
 * Remove opaque pixels through a stable noise field with a colored boundary.
 * Primary intensity is dissolve progress: 0 leaves the source intact and 1
 * makes it transparent.
 */
export const dissolve = defineEffect<DissolveHandle, DissolveOptions>({
  name: "yage:dissolve",
  factory: (options) => {
    const filter = new DissolveFilter(options);
    const effect: Effect<DissolveHandle> = {
      filter,
      getIntensity: () => filter.progress,
      setIntensity: (value) => {
        filter.progress = value;
      },
      onAttach: ({ displayObject }) => {
        filter.attach(displayObject);
      },
      onDetach: () => {
        filter.detach();
      },
      buildExtras: () => ({
        setEdgeColor: (value) => filter.setEdgeColor(value),
        setEdgeWidth: (value) => filter.setEdgeWidth(value),
        setNoiseScale: (value) => filter.setNoiseScale(value),
        setSoftness: (value) => filter.setSoftness(value),
        setSeed: (value) => filter.setSeed(value),
      }),
    };
    return effect;
  },
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { Filter, GlProgram, GpuProgram } from "pixi.js";
import type { Container, FilterSystem, RenderSurface, Texture } from "pixi.js";
import type { ImplosionHandle } from "./handles.js";
import {
  validateFinite,
  validateMinimum,
  validatePoint,
  validateRange,
} from "./validate.js";

/** Options for the {@link implosion} preset. */
export interface ImplosionOptions {
  /** Center in the effect host's local coordinates. Omit for the host center. */
  center?: { x: number; y: number };
  /** Effect radius in host-local pixels. Default: 180. */
  radius?: number;
  /** Inward displacement strength. Default: 0.8. */
  strength?: number;
  /** Center darkening from 0 to 1. Default: 0.9. */
  darkness?: number;
  /** Rotation applied near the center, in radians. Default: 0.35. */
  swirl?: number;
  /** Grow the affected radius from the center as intensity rises. Default: false. */
  expandFromCenter?: boolean;
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
uniform vec4 uInputClamp;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uStrength;
uniform float uDarkness;
uniform float uSwirl;
uniform float uIntensity;
uniform float uExpandFromCenter;

void main(void) {
  vec2 pixel = vTextureCoord / uInputSize.zw;
  vec2 delta = pixel - uCenter;
  float distanceFromCenter = length(delta);
  float normalizedDistance = distanceFromCenter / max(uRadius, 1.0);
  float radiusProgress = pow(clamp(uIntensity, 0.0, 1.0), 1.35);
  float movingFront = 1.0 - smoothstep(
    radiusProgress,
    radiusProgress + 0.18,
    normalizedDistance
  );
  float frontMask = mix(1.0, movingFront, uExpandFromCenter);
  float falloff = (1.0 - smoothstep(0.0, 1.0, normalizedDistance)) * frontMask;

  float angle = uSwirl * falloff;
  float c = cos(angle);
  float s = sin(angle);
  vec2 rotated = vec2(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  float pull = 1.0 + uStrength * falloff * (1.5 - 0.5 * normalizedDistance);
  vec2 samplePixel = uCenter + rotated * pull;
  vec2 sampleUv = clamp(samplePixel * uInputSize.zw, uInputClamp.xy, uInputClamp.zw);
  vec4 color = texture(uTexture, sampleUv);

  float core = (1.0 - smoothstep(0.0, 0.32, normalizedDistance)) * frontMask;
  float shade = 1.0 - uDarkness * (0.3 * falloff + 0.7 * core);
  finalColor = vec4(color.rgb * shade, color.a);
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

struct ImplosionUniforms {
  uCenter: vec2<f32>,
  uRadius: f32,
  uStrength: f32,
  uDarkness: f32,
  uSwirl: f32,
  uIntensity: f32,
  uExpandFromCenter: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> implosionUniforms: ImplosionUniforms;

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
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let pixel = uv / gfu.uInputSize.zw;
  let delta = pixel - implosionUniforms.uCenter;
  let distanceFromCenter = length(delta);
  let normalizedDistance = distanceFromCenter / max(implosionUniforms.uRadius, 1.0);
  let radiusProgress = pow(clamp(implosionUniforms.uIntensity, 0.0, 1.0), 1.35);
  let movingFront = 1.0 - smoothstep(
    radiusProgress,
    radiusProgress + 0.18,
    normalizedDistance
  );
  let frontMask = mix(1.0, movingFront, implosionUniforms.uExpandFromCenter);
  let falloff = (1.0 - smoothstep(0.0, 1.0, normalizedDistance)) * frontMask;

  let angle = implosionUniforms.uSwirl * falloff;
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2<f32>(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
  let pull = 1.0 + implosionUniforms.uStrength * falloff * (1.5 - 0.5 * normalizedDistance);
  let samplePixel = implosionUniforms.uCenter + rotated * pull;
  let sampleUv = clamp(samplePixel * gfu.uInputSize.zw, gfu.uInputClamp.xy, gfu.uInputClamp.zw);
  let color = textureSample(uTexture, uSampler, sampleUv);

  let core = (1.0 - smoothstep(0.0, 0.32, normalizedDistance)) * frontMask;
  let shade = 1.0 - implosionUniforms.uDarkness * (0.3 * falloff + 0.7 * core);
  return vec4<f32>(color.rgb * shade, color.a);
}
`;

class ImplosionFilter extends Filter {
  intensity = 1;
  centerLocal: { x: number; y: number } | undefined;
  radiusLocal: number;
  baseStrength: number;
  baseDarkness: number;
  baseSwirl: number;
  expandFromCenter: boolean;
  yageTarget: Container | undefined;
  private readonly centerOut = new Float32Array(2);

  constructor(options: ImplosionOptions) {
    const radius = validateMinimum(
      "implosion",
      "radius",
      options.radius ?? 180,
      1,
    );
    const strength = validateFinite(
      "implosion",
      "strength",
      options.strength ?? 0.8,
    );
    const darkness = validateRange(
      "implosion",
      "darkness",
      options.darkness ?? 0.9,
      0,
      1,
    );
    const swirl = validateFinite("implosion", "swirl", options.swirl ?? 0.35);
    super({
      glProgram: GlProgram.from({
        vertex: VERTEX_GL,
        fragment: FRAGMENT_GL,
        name: "yage-implosion",
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
        fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
      }),
      resources: {
        implosionUniforms: {
          uCenter: { value: new Float32Array(2), type: "vec2<f32>" },
          uRadius: { value: radius, type: "f32" },
          uStrength: { value: strength, type: "f32" },
          uDarkness: { value: darkness, type: "f32" },
          uSwirl: { value: swirl, type: "f32" },
          uIntensity: { value: 1, type: "f32" },
          uExpandFromCenter: {
            value: options.expandFromCenter === true ? 1 : 0,
            type: "f32",
          },
        },
      },
    });
    this.centerLocal = options.center
      ? { ...validatePoint("implosion", "center", options.center) }
      : undefined;
    this.radiusLocal = radius;
    this.baseStrength = strength;
    this.baseDarkness = darkness;
    this.baseSwirl = swirl;
    this.expandFromCenter = options.expandFromCenter ?? false;
  }

  private uniforms(): {
    uCenter: Float32Array;
    uRadius: number;
    uStrength: number;
    uDarkness: number;
    uSwirl: number;
    uIntensity: number;
    uExpandFromCenter: number;
  } {
    return this.resources.implosionUniforms.uniforms as {
      uCenter: Float32Array;
      uRadius: number;
      uStrength: number;
      uDarkness: number;
      uSwirl: number;
      uIntensity: number;
      uExpandFromCenter: number;
    };
  }

  applyIntensity(): void {
    const uniforms = this.uniforms();
    uniforms.uStrength = this.baseStrength * this.intensity;
    uniforms.uDarkness = this.baseDarkness * this.intensity;
    uniforms.uSwirl = this.baseSwirl * this.intensity;
    uniforms.uIntensity = this.intensity;
    uniforms.uExpandFromCenter = this.expandFromCenter ? 1 : 0;
  }

  override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    const target = this.yageTarget;
    const transform = target?.worldTransform;
    const scaleX = transform ? Math.hypot(transform.a, transform.b) : 1;
    const scaleY = transform ? Math.hypot(transform.c, transform.d) : 1;
    const center = this.centerLocal;
    if (target && transform && center) {
      const worldX =
        transform.a * center.x + transform.c * center.y + transform.tx;
      const worldY =
        transform.b * center.x + transform.d * center.y + transform.ty;
      const bounds = (
        filterManager as unknown as {
          _activeFilterData?: { bounds?: { minX: number; minY: number } };
        }
      )._activeFilterData?.bounds;
      this.centerOut[0] = worldX - (bounds?.minX ?? 0);
      this.centerOut[1] = worldY - (bounds?.minY ?? 0);
    } else {
      this.centerOut[0] = input.frame.width * 0.5;
      this.centerOut[1] = input.frame.height * 0.5;
    }
    const uniforms = this.uniforms();
    uniforms.uCenter[0] = this.centerOut[0] ?? 0;
    uniforms.uCenter[1] = this.centerOut[1] ?? 0;
    uniforms.uRadius = this.radiusLocal * (scaleX + scaleY) * 0.5;
    this.applyIntensity();
    super.apply(filterManager, input, output, clearMode);
  }
}

/**
 * Pull pixels inward around a darkened, optionally rotating center. The effect
 * is one visual operation; particles, camera response, sound, and a following
 * burst remain explicit Feel composition.
 */
export const implosion = defineEffect<ImplosionHandle, ImplosionOptions>({
  name: "yage:implosion",
  factory: (options) => {
    const filter = new ImplosionFilter(options);
    const effect: Effect<ImplosionHandle> = {
      filter,
      getIntensity: () => filter.intensity,
      setIntensity: (value) => {
        filter.intensity = validateFinite("implosion", "intensity", value);
        filter.applyIntensity();
      },
      onAttach: ({ displayObject }) => {
        filter.yageTarget = displayObject;
      },
      onDetach: () => {
        filter.yageTarget = undefined;
      },
      buildExtras: () => ({
        setCenter: (x: number, y: number) => {
          filter.centerLocal = validatePoint("implosion", "center", { x, y });
        },
        useHostCenter: () => {
          filter.centerLocal = undefined;
        },
        setRadius: (value: number) => {
          filter.radiusLocal = validateMinimum("implosion", "radius", value, 1);
        },
        setStrength: (value: number) => {
          filter.baseStrength = validateFinite("implosion", "strength", value);
          filter.applyIntensity();
        },
        setDarkness: (value: number) => {
          filter.baseDarkness = validateRange(
            "implosion",
            "darkness",
            value,
            0,
            1,
          );
          filter.applyIntensity();
        },
        setSwirl: (value: number) => {
          filter.baseSwirl = validateFinite("implosion", "swirl", value);
          filter.applyIntensity();
        },
        setExpandFromCenter: (value: boolean) => {
          filter.expandFromCenter = value;
          filter.applyIntensity();
        },
      }),
    };
    return effect;
  },
});

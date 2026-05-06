import { Process } from "@yagejs/core";
import { Filter, GlProgram, GpuProgram } from "pixi.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import type { WaveHandle } from "./handles.js";

/** Options for the {@link wave} preset. */
export interface WaveOptions {
  /** Horizontal displacement amplitude in pixels. Drives `getIntensity`. Default: 6. */
  amplitude?: number;
  /** Wavelength in pixels — distance between successive wave peaks. Default: 40. */
  wavelength?: number;
  /** Animation speed in cycles/second. Default: 1. */
  speed?: number;
}

// ---------------------------------------------------------------------------
// Custom WebGL + WebGPU shader pair: offset every fragment's sample point
// horizontally by `sin(y * 2π / wavelength + time)`. The host JS code
// advances the `uTime` uniform each frame through the engine's process
// scheduler so the wave breathes in scene time.
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

// `uInputSize.zw` is `1 / size`, i.e. how much UV one pixel covers. We
// multiply the per-pixel amplitude by `uInputSize.z` so the wave reads as a
// pixel offset regardless of host size.
const FRAGMENT_GL = /* glsl */ `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform float uAmplitude;
uniform float uWavelength;
uniform float uTime;

void main(void) {
  // y in pixels → wave phase
  float y = vTextureCoord.y / uInputSize.zw.y;
  float phase = (y / max(uWavelength, 1.0)) * 6.2831853 + uTime;
  // Convert pixel-space x offset to UV-space.
  float xOffset = sin(phase) * uAmplitude * uInputSize.z;
  vec2 uv = vec2(vTextureCoord.x + xOffset, vTextureCoord.y);
  finalColor = texture(uTexture, uv);
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

struct WaveUniforms {
  uAmplitude: f32,
  uWavelength: f32,
  uTime: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> waveUniforms: WaveUniforms;

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
  let y: f32 = uv.y / gfu.uInputSize.w;
  let phase: f32 = (y / max(waveUniforms.uWavelength, 1.0)) * 6.2831853 + waveUniforms.uTime;
  let xOffset: f32 = sin(phase) * waveUniforms.uAmplitude * gfu.uInputSize.z;
  let sampledUv: vec2<f32> = vec2<f32>(uv.x + xOffset, uv.y);
  return textureSample(uTexture, uSampler, sampledUv);
}
`;

/** @internal */
class WaveFilter extends Filter {
  constructor(amplitude: number, wavelength: number) {
    super({
      glProgram: GlProgram.from({
        vertex: VERTEX_GL,
        fragment: FRAGMENT_GL,
        name: "yage-wave",
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
        fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
      }),
      resources: {
        waveUniforms: {
          uAmplitude: { value: amplitude, type: "f32" },
          uWavelength: { value: wavelength, type: "f32" },
          uTime: { value: 0, type: "f32" },
        },
      },
    });
    // Padding so the per-row x-shift doesn't get clipped at the host's
    // bounding box. `amplitude` is the full peak-to-rest displacement.
    this.padding = Math.ceil(amplitude) + 2;
  }

  private uniforms(): {
    uAmplitude: number;
    uWavelength: number;
    uTime: number;
  } {
    return this.resources.waveUniforms.uniforms as {
      uAmplitude: number;
      uWavelength: number;
      uTime: number;
    };
  }

  get amplitude(): number {
    return this.uniforms().uAmplitude;
  }
  set amplitude(value: number) {
    this.uniforms().uAmplitude = value;
    this.padding = Math.ceil(value) + 2;
  }
  get wavelength(): number {
    return this.uniforms().uWavelength;
  }
  set wavelength(value: number) {
    this.uniforms().uWavelength = value;
  }
  get time(): number {
    return this.uniforms().uTime;
  }
  set time(value: number) {
    this.uniforms().uTime = value;
  }
}

/**
 * Sinusoidal horizontal-wave distortion — the classic underwater / heat-haze
 * shimmer. Built from scratch via a custom WebGL+WebGPU shader pair, with a
 * scene-time animator scheduled through the engine's process scheduler so
 * the wave pauses with the owning scene and time-scales with it.
 *
 * `setIntensity` scales `amplitude` from 0 to the configured value so
 * `fadeIn` ramps the shimmer in cleanly. Reach for `setAmplitude` /
 * `setWavelength` / `setSpeed` to tune the look at runtime.
 */
export const wave = defineEffect<WaveHandle, WaveOptions>({
  name: "yage:wave",
  factory: (options) => {
    let baseAmplitude = options.amplitude ?? 6;
    let speed = options.speed ?? 1;
    const filter = new WaveFilter(baseAmplitude, options.wavelength ?? 40);
    const effect: Effect<WaveHandle> = {
      filter,
      getIntensity: () => filter.amplitude / Math.max(baseAmplitude, 1e-6),
      setIntensity: (v) => {
        filter.amplitude = baseAmplitude * v;
      },
      buildExtras: () => ({
        setAmplitude: (value: number) => {
          const ratio = filter.amplitude / Math.max(baseAmplitude, 1e-6);
          baseAmplitude = value;
          filter.amplitude = value * ratio;
        },
        setWavelength: (value: number) => {
          filter.wavelength = Math.max(1, value);
        },
        setSpeed: (value: number) => {
          speed = value;
        },
      }),
      onActivate: (base) => {
        // Drive `uTime` from scene time. `speed` is cycles/sec, so per-frame
        // we add `speed * 2π * dt` (radians).
        base.run(
          new Process({
            update: (dt) => {
              filter.time += speed * 2 * Math.PI * (dt / 1000);
            },
          }),
        );
      },
    };
    return effect;
  },
});

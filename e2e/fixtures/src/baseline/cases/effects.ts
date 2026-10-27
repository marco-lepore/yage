import { Entity, Transform, Vec2 } from "@yagejs/core";
import { Filter, GlProgram, GpuProgram } from "pixi.js";
import { GraphicsComponent, defineEffect } from "@yagejs/renderer";
import type { Effect, EffectHandle } from "@yagejs/renderer";
import { outline } from "@yagejs/effects";
import { CaseProbe } from "../probe.js";
import type { CaseReading } from "../probe.js";

// A fragment shader the fixture owns, so a run shows whether a custom shader
// compiles on the backend the shell gave the page. Per fragment it scales the
// source colour by a uniform, which keeps the WebGL and WebGPU programs short.
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
uniform float uScale;

void main(void) {
  vec4 src = texture(uTexture, vTextureCoord);
  finalColor = vec4(src.rgb * uScale, src.a);
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

struct TintUniforms {
  uScale: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> tintUniforms: TintUniforms;

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
  let src = textureSample(uTexture, uSampler, uv);
  return vec4<f32>(src.rgb * tintUniforms.uScale, src.a);
}
`;

/** Options for the fixture's own effect. */
interface TintOptions {
  /** What the source colour is multiplied by. */
  scale: number;
}

/** The fixture's effect, built on its own shader pair. */
const baselineTint = defineEffect<EffectHandle, TintOptions>({
  name: "baseline:tint",
  factory: (options) => {
    const filter = new Filter({
      glProgram: GlProgram.from({
        vertex: VERTEX_GL,
        fragment: FRAGMENT_GL,
        name: "baseline-tint",
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: SHADER_WGSL, entryPoint: "mainVertex" },
        fragment: { source: SHADER_WGSL, entryPoint: "mainFragment" },
      }),
      resources: {
        tintUniforms: {
          uScale: { value: options.scale, type: "f32" },
        },
      },
    });
    const uniforms = filter.resources["tintUniforms"].uniforms as {
      uScale: number;
    };
    const effect: Effect = {
      filter,
      getIntensity: () => uniforms.uScale,
      setIntensity: (value) => {
        uniforms.uScale = value;
      },
    };
    return effect;
  },
});

/** What the effects case reports. */
export interface EffectsReading extends CaseReading {
  effects: string[];
  frames: number;
}

/** Reports which of the attached effects the stack still holds. */
export class EffectsProbe extends CaseProbe {
  private readonly art = this.sibling(GraphicsComponent);
  private frames = 0;

  update(): void {
    this.frames += 1;
  }

  get settled(): boolean {
    return this.frames >= 2;
  }

  reading(): EffectsReading {
    const attached: string[] = [];
    if (this.art.fx.findEffect(outline) !== null) attached.push(outline.name);
    if (this.art.fx.findEffect(baselineTint) !== null) {
      attached.push(baselineTint.name);
    }
    return { effects: attached, frames: this.frames };
  }
}

/** A drawn shape carrying a shipped preset and the fixture's own shader. */
export class EffectsCase extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(560, 90) }));
    const art = this.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 28).fill({ color: 0xf97316 });
      }),
    );
    art.fx.addEffect(outline({ thickness: 4, color: 0x000000 }));
    art.fx.addEffect(baselineTint({ scale: 0.75 }));
    this.add(new EffectsProbe());
  }
}

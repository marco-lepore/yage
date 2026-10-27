import type { HostSupport } from "@yagejs/core";
import type { Renderer, WebGLRenderer, WebGPURenderer } from "pixi.js";

/** The graphics API the renderer draws with. */
export type GraphicsBackend = "webgl1" | "webgl2" | "webgpu";

/** What the context can do with one texture format. */
export interface GraphicsFormatSupport {
  /** A shader can read texels of this format. */
  readonly sample: HostSupport;
  /** A shader can read it with linear filtering between texels. */
  readonly filter: HostSupport;
  /** A render target of this format can be drawn into. */
  readonly render: HostSupport;
}

/**
 * What the graphics context the renderer draws with reports about itself.
 * `"unknown"` means only drawing would tell, and YAGE draws nothing to find
 * out.
 */
export interface GraphicsCapabilities {
  readonly backend: GraphicsBackend;
  /** Largest texture width or height, in texels. */
  readonly maxTextureSize: number;
  /** Largest render target width or height, in texels. */
  readonly maxRenderTargetSize: number;
  /** Largest drawable width, in device pixels. */
  readonly maxViewportWidth: number;
  /** Largest drawable height, in device pixels. */
  readonly maxViewportHeight: number;
  /**
   * Samples one antialiased render target can take. `0` where `antialias` on
   * a render target has no effect.
   */
  readonly maxSamples: number;
  /** Whether fragment shaders compute at high float precision. */
  readonly highpFragment: HostSupport;
  /** Whether the `"min"` and `"max"` blend modes draw as named. */
  readonly blendMinMax: HostSupport;
  /** Four half-float channels. */
  readonly rgba16float: GraphicsFormatSupport;
  /** Four full-float channels. */
  readonly rgba32float: GraphicsFormatSupport;
}

/**
 * The sample counts WebGPU defines for a multisampled texture are 1 and 4, so
 * a device that multisamples at all takes 4.
 */
const WEBGPU_MAX_SAMPLES = 4;

/**
 * @internal Read the capabilities of Pixi's initialized renderer. The result
 * and its nested objects are frozen, so one read can be handed to every
 * reader.
 */
export function readGraphicsCapabilities(pixi: Renderer): GraphicsCapabilities {
  if (pixi.name === "webgl") return readWebGL(pixi as WebGLRenderer);
  if (pixi.name === "webgpu") return readWebGPU(pixi as WebGPURenderer);
  // The renderer asks Pixi for WebGL or WebGPU only, so no other backend can
  // reach this read.
  throw new Error(
    `RendererPlugin: Pixi started its ${JSON.stringify(pixi.name)} renderer, ` +
      "but the renderer asked for WebGL or WebGPU only.",
  );
}

function readWebGL(pixi: WebGLRenderer): GraphicsCapabilities {
  const gl = pixi.gl;
  const webgl2 = pixi.context.webGLVersion === 2;
  const extension = (name: string): HostSupport =>
    gl.getExtension(name) ? "supported" : "unsupported";
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRenderbufferSize = gl.getParameter(
    gl.MAX_RENDERBUFFER_SIZE,
  ) as number;
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as
    | Int32Array
    | number[];
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);

  const halfFloat = extension("OES_texture_half_float");
  const halfFloatLinear = extension("OES_texture_half_float_linear");
  const colorBufferHalfFloat = extension("EXT_color_buffer_half_float");
  const float = extension("OES_texture_float");
  const floatLinear = extension("OES_texture_float_linear");
  const colorBufferFloat = extension("EXT_color_buffer_float");

  return freeze({
    backend: webgl2 ? "webgl2" : "webgl1",
    maxTextureSize,
    maxRenderTargetSize: Math.min(maxTextureSize, maxRenderbufferSize),
    maxViewportWidth: viewport[0] ?? 0,
    maxViewportHeight: viewport[1] ?? 0,
    // WebGL 1 has no multisampled render target, whatever the driver reports.
    maxSamples: webgl2 ? (gl.getParameter(gl.MAX_SAMPLES) as number) : 0,
    highpFragment:
      highp !== null && highp.precision > 0 ? "supported" : "unsupported",
    blendMinMax: webgl2 ? "supported" : extension("EXT_blend_minmax"),
    rgba16float: webgl2
      ? {
          sample: "supported",
          filter: "supported",
          render: either(colorBufferFloat, colorBufferHalfFloat),
        }
      : {
          sample: halfFloat,
          filter: halfFloatLinear,
          render: renderableWebGL1(colorBufferHalfFloat, halfFloat),
        },
    rgba32float: webgl2
      ? {
          sample: "supported",
          filter: floatLinear,
          render: colorBufferFloat,
        }
      : {
          sample: float,
          filter: both(float, floatLinear),
          render: renderableWebGL1(
            extension("WEBGL_color_buffer_float"),
            float,
          ),
        },
  });
}

function readWebGPU(pixi: WebGPURenderer): GraphicsCapabilities {
  const device = pixi.gpu.device;
  const size = device.limits.maxTextureDimension2D;
  // The device holds the features Pixi asked for, which is what the renderer
  // draws with; the adapter may have more.
  const float32Filterable: HostSupport = device.features.has(
    "float32-filterable",
  )
    ? "supported"
    : "unsupported";
  return freeze({
    backend: "webgpu",
    maxTextureSize: size,
    maxRenderTargetSize: size,
    maxViewportWidth: size,
    maxViewportHeight: size,
    maxSamples: WEBGPU_MAX_SAMPLES,
    highpFragment: "supported",
    blendMinMax: "supported",
    rgba16float: {
      sample: "supported",
      filter: "supported",
      render: "supported",
    },
    rgba32float: {
      sample: "supported",
      filter: float32Filterable,
      render: "supported",
    },
  });
}

/** `"supported"` when either extension is present. */
function either(a: HostSupport, b: HostSupport): HostSupport {
  return a === "supported" || b === "supported" ? "supported" : "unsupported";
}

/** `"supported"` when both extensions are present. */
function both(a: HostSupport, b: HostSupport): HostSupport {
  return a === "supported" && b === "supported" ? "supported" : "unsupported";
}

/**
 * Whether a WebGL 1 context draws into a float render target. Some WebGL 1
 * implementations do so with the sampling extension alone, which only a draw
 * would settle, so the answer is `"unknown"` rather than either certainty.
 */
function renderableWebGL1(
  colorBuffer: HostSupport,
  sample: HostSupport,
): HostSupport {
  if (colorBuffer === "supported") return "supported";
  return sample === "supported" ? "unknown" : "unsupported";
}

/** Freeze the snapshot and the two format objects inside it. */
function freeze(capabilities: GraphicsCapabilities): GraphicsCapabilities {
  Object.freeze(capabilities.rgba16float);
  Object.freeze(capabilities.rgba32float);
  return Object.freeze(capabilities);
}

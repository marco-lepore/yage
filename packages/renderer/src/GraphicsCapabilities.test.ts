import { describe, it, expect } from "vitest";
import type { Renderer } from "pixi.js";
import { readGraphicsCapabilities } from "./GraphicsCapabilities.js";

/** The parameter names the read asks a WebGL context for. */
const GL = {
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_VIEWPORT_DIMS: 0x0d3a,
  MAX_SAMPLES: 0x8d57,
  FRAGMENT_SHADER: 0x8b30,
  HIGH_FLOAT: 0x8df2,
} as const;

/** Every extension a WebGL 2 context in a desktop browser offers. */
const WEBGL2_EXTENSIONS = [
  "EXT_color_buffer_float",
  "OES_texture_float_linear",
];

/** Every extension a WebGL 1 context needs for the formats YAGE reads. */
const WEBGL1_EXTENSIONS = [
  "EXT_blend_minmax",
  "OES_texture_float",
  "OES_texture_float_linear",
  "WEBGL_color_buffer_float",
  "OES_texture_half_float",
  "OES_texture_half_float_linear",
  "EXT_color_buffer_half_float",
];

interface GlOptions {
  readonly webGLVersion: 1 | 2;
  readonly extensions: readonly string[];
  readonly textureSize?: number;
  readonly renderbufferSize?: number;
  readonly viewport?: readonly [number, number];
  readonly samples?: number;
  readonly highFloat?: number;
}

function webglRenderer(options: GlOptions): Renderer {
  const present = new Set(options.extensions);
  const gl = {
    ...GL,
    getParameter(name: number): unknown {
      if (name === GL.MAX_TEXTURE_SIZE) return options.textureSize ?? 8192;
      if (name === GL.MAX_RENDERBUFFER_SIZE) {
        return options.renderbufferSize ?? 8192;
      }
      if (name === GL.MAX_VIEWPORT_DIMS) {
        return options.viewport ?? [8192, 4096];
      }
      if (name === GL.MAX_SAMPLES) return options.samples ?? 4;
      return 0;
    },
    getExtension(name: string): object | null {
      return present.has(name) ? {} : null;
    },
    getShaderPrecisionFormat(): { precision: number } {
      return { precision: options.highFloat ?? 23 };
    },
  };
  return {
    name: "webgl",
    context: { webGLVersion: options.webGLVersion },
    gl,
  } as unknown as Renderer;
}

function webgpuRenderer(features: readonly string[], size = 8192): Renderer {
  return {
    name: "webgpu",
    gpu: {
      device: {
        limits: { maxTextureDimension2D: size },
        features: new Set(features),
      },
    },
  } as unknown as Renderer;
}

describe("readGraphicsCapabilities", () => {
  it("reports a WebGL 2 context with every float extension", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({ webGLVersion: 2, extensions: WEBGL2_EXTENSIONS }),
    );

    expect(capabilities).toEqual({
      backend: "webgl2",
      maxTextureSize: 8192,
      maxRenderTargetSize: 8192,
      maxViewportWidth: 8192,
      maxViewportHeight: 4096,
      maxSamples: 4,
      highpFragment: "supported",
      blendMinMax: "supported",
      rgba16float: {
        sample: "supported",
        filter: "supported",
        render: "supported",
      },
      rgba32float: {
        sample: "supported",
        filter: "supported",
        render: "supported",
      },
    });
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.isFrozen(capabilities.rgba16float)).toBe(true);
    expect(Object.isFrozen(capabilities.rgba32float)).toBe(true);
  });

  it("reports a WebGL 2 context that draws into no float buffer", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({ webGLVersion: 2, extensions: [] }),
    );

    expect(capabilities.rgba32float).toEqual({
      sample: "supported",
      filter: "unsupported",
      render: "unsupported",
    });
    expect(capabilities.rgba16float).toEqual({
      sample: "supported",
      filter: "supported",
      render: "unsupported",
    });
  });

  it("reports a WebGL 2 context whose half-float buffers come from the half-float extension", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({
        webGLVersion: 2,
        extensions: ["EXT_color_buffer_half_float"],
      }),
    );

    expect(capabilities.rgba16float.render).toBe("supported");
    expect(capabilities.rgba32float.render).toBe("unsupported");
  });

  it("reports a WebGL 1 context with every extension", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({ webGLVersion: 1, extensions: WEBGL1_EXTENSIONS }),
    );

    expect(capabilities.backend).toBe("webgl1");
    expect(capabilities.maxSamples).toBe(0);
    expect(capabilities.blendMinMax).toBe("supported");
    expect(capabilities.rgba16float).toEqual({
      sample: "supported",
      filter: "supported",
      render: "supported",
    });
    expect(capabilities.rgba32float).toEqual({
      sample: "supported",
      filter: "supported",
      render: "supported",
    });
  });

  it("reports a WebGL 1 context with none", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({ webGLVersion: 1, extensions: [] }),
    );

    expect(capabilities.blendMinMax).toBe("unsupported");
    expect(capabilities.rgba16float).toEqual({
      sample: "unsupported",
      filter: "unsupported",
      render: "unsupported",
    });
    expect(capabilities.rgba32float).toEqual({
      sample: "unsupported",
      filter: "unsupported",
      render: "unsupported",
    });
  });

  it("leaves a WebGL 1 float buffer unknown where only sampling is promised", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({
        webGLVersion: 1,
        extensions: ["OES_texture_float", "OES_texture_half_float"],
      }),
    );

    expect(capabilities.rgba32float).toEqual({
      sample: "supported",
      filter: "unsupported",
      render: "unknown",
    });
    expect(capabilities.rgba16float).toEqual({
      sample: "supported",
      filter: "unsupported",
      render: "unknown",
    });
  });

  it("reports a context whose fragment shaders have no high precision", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({
        webGLVersion: 2,
        extensions: WEBGL2_EXTENSIONS,
        highFloat: 0,
      }),
    );

    expect(capabilities.highpFragment).toBe("unsupported");
  });

  it("takes the smaller of the two limits a render target must fit", () => {
    const capabilities = readGraphicsCapabilities(
      webglRenderer({
        webGLVersion: 2,
        extensions: WEBGL2_EXTENSIONS,
        textureSize: 16384,
        renderbufferSize: 4096,
      }),
    );

    expect(capabilities.maxTextureSize).toBe(16384);
    expect(capabilities.maxRenderTargetSize).toBe(4096);
  });

  it("reports a WebGPU device, whose float filtering is a feature it holds", () => {
    const withFiltering = readGraphicsCapabilities(
      webgpuRenderer(["float32-filterable"], 4096),
    );
    expect(withFiltering).toEqual({
      backend: "webgpu",
      maxTextureSize: 4096,
      maxRenderTargetSize: 4096,
      maxViewportWidth: 4096,
      maxViewportHeight: 4096,
      maxSamples: 4,
      highpFragment: "supported",
      blendMinMax: "supported",
      rgba16float: {
        sample: "supported",
        filter: "supported",
        render: "supported",
      },
      rgba32float: {
        sample: "supported",
        filter: "supported",
        render: "supported",
      },
    });

    const without = readGraphicsCapabilities(webgpuRenderer([]));
    expect(without.rgba32float.filter).toBe("unsupported");
    expect(Object.isFrozen(without)).toBe(true);
  });

  it("refuses a renderer the engine does not draw with", () => {
    expect(() =>
      readGraphicsCapabilities({ name: "canvas" } as unknown as Renderer),
    ).toThrow(
      'RendererPlugin: Pixi started its "canvas" renderer, but the renderer ' +
        "asked for WebGL or WebGPU only.",
    );
  });
});

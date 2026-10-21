import { describe, expect, it } from "vitest";
import {
  SURFACE_GL,
  SURFACE_GPU_LAYOUT,
  SURFACE_WGSL,
} from "./surface-shader.js";

describe("surface shader inputs", () => {
  it("lays out one bind-group entry per resource the WGSL binds in group 3", () => {
    const declared = [
      ...SURFACE_WGSL.matchAll(
        /@group\(3\) @binding\((\d+)\) var(?:<\w+>)? (\w+)/g,
      ),
    ].map(([, binding, name]) => ({ binding: Number(binding), name }));
    expect(declared.map((entry) => entry.name)).toEqual([
      "lightingUniforms",
      "uLights",
      "uEdges",
    ]);
    expect(SURFACE_GPU_LAYOUT.map((entry) => entry.binding)).toEqual(
      declared.map((entry) => entry.binding),
    );
  });

  it("declares the same textures to GLSL and defines evaluateLighting in both", () => {
    expect(SURFACE_GL).toMatch(/uniform sampler2D uLights;/);
    expect(SURFACE_GL).toMatch(/uniform sampler2D uEdges;/);
    expect(SURFACE_GL).toMatch(/vec3 evaluateLighting\(/);
    expect(SURFACE_WGSL).toMatch(/fn evaluateLighting\(/);
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { GraphicsCapabilities, RendererPlugin } from "@yagejs/renderer";
import { lightShaderVerdict } from "./shader-probe.js";

interface GlOptions {
  /** `null` from `createShader` and `createProgram`, as a dead context gives. */
  readonly buildsNothing?: boolean;
  readonly links?: boolean;
  readonly programLog?: string | null;
  readonly fragmentLog?: string | null;
  readonly vertexLog?: string | null;
  /** The context is already lost when the probe reads it. */
  readonly contextLost?: boolean;
  /** The context goes away while the program is being built. */
  readonly losesContext?: boolean;
}

/** A renderer whose context answers a link test the way `options` says. */
function fakeRenderer(options: GlOptions = {}): RendererPlugin {
  const deleted = { shaders: 0, programs: 0 };
  let lost = options.contextLost === true;
  const gl = {
    deleted,
    isContextLost: () => lost,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS: 0x8b82,
    createShader: () => (options.buildsNothing === true ? null : {}),
    createProgram: () => (options.buildsNothing === true ? null : {}),
    shaderSource: () => {},
    compileShader: () => {},
    attachShader: () => {},
    linkProgram: () => {
      if (options.losesContext === true) lost = true;
    },
    getProgramParameter: () => options.links !== false,
    getProgramInfoLog: () => options.programLog ?? "",
    getShaderInfoLog: (shader: unknown) =>
      shader === null ? "" : (options.fragmentLog ?? options.vertexLog ?? ""),
    deleteShader: () => {
      deleted.shaders++;
    },
    deleteProgram: () => {
      deleted.programs++;
    },
  };
  return {
    // A new object per renderer, as the renderer reads one per context.
    capabilities: Object.freeze({
      backend: "webgl2",
    }) as unknown as GraphicsCapabilities,
    application: { renderer: { gl } },
  } as unknown as RendererPlugin;
}

function deletions(renderer: RendererPlugin): {
  shaders: number;
  programs: number;
} {
  return (
    renderer.application.renderer as unknown as {
      gl: { deleted: { shaders: number; programs: number } };
    }
  ).gl.deleted;
}

describe("lightShaderVerdict", () => {
  it("reports a program the driver built, and leaves nothing behind", () => {
    const renderer = fakeRenderer();

    expect(lightShaderVerdict(renderer)).toEqual({ outcome: "linked" });
    expect(deletions(renderer)).toEqual({ shaders: 2, programs: 1 });
  });

  it("answers once per graphics context", () => {
    const renderer = fakeRenderer();

    lightShaderVerdict(renderer);
    lightShaderVerdict(renderer);

    expect(deletions(renderer)).toEqual({ shaders: 2, programs: 1 });
  });

  it("keeps the driver's own words for a refusal", () => {
    expect(
      lightShaderVerdict(
        fakeRenderer({ links: false, programLog: "  too many varyings  " }),
      ),
    ).toEqual({ outcome: "rejected", log: "too many varyings" });
  });

  it("falls back to a shader's log where the program has none", () => {
    expect(
      lightShaderVerdict(
        fakeRenderer({
          links: false,
          programLog: "",
          fragmentLog: "no 300 es",
        }),
      ),
    ).toEqual({ outcome: "rejected", log: "no 300 es" });
  });

  it("reports a refusal the driver said nothing about", () => {
    expect(
      lightShaderVerdict(
        fakeRenderer({ links: false, programLog: null, fragmentLog: null }),
      ),
    ).toEqual({ outcome: "rejected", log: null });
  });

  it("takes a context that builds nothing for one that cannot draw the shader", () => {
    const renderer = fakeRenderer({ buildsNothing: true });

    expect(lightShaderVerdict(renderer)).toEqual({
      outcome: "rejected",
      log: null,
    });
    expect(deletions(renderer)).toEqual({ shaders: 0, programs: 0 });
  });

  it("builds nothing on a context that is already lost", () => {
    const renderer = fakeRenderer({ contextLost: true });

    expect(lightShaderVerdict(renderer)).toEqual({ outcome: "context-lost" });
    expect(deletions(renderer)).toEqual({ shaders: 0, programs: 0 });
  });

  it("reports a context lost during the link rather than a refusal", () => {
    const renderer = fakeRenderer({ losesContext: true, links: false });

    expect(lightShaderVerdict(renderer)).toEqual({ outcome: "context-lost" });
  });

  it("keeps no verdict taken from a lost context", () => {
    const renderer = fakeRenderer({ contextLost: true });

    lightShaderVerdict(renderer);
    lightShaderVerdict(renderer);

    expect(deletions(renderer)).toEqual({ shaders: 0, programs: 0 });
  });
});

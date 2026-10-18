import type { GraphicsCapabilities, RendererPlugin } from "@yagejs/renderer";
import type { WebGLRenderer } from "pixi.js";
import { lightProgramSources } from "./light-shader.js";

/**
 * What a driver said about the light program: it linked, it rejected the
 * program with a log, or the context went away while the program was built
 * and said nothing about the driver.
 */
export type LightShaderVerdict =
  | { readonly outcome: "linked" }
  | { readonly outcome: "rejected"; readonly log: string | null }
  | { readonly outcome: "context-lost" };

const CONTEXT_LOST: LightShaderVerdict = { outcome: "context-lost" };

/**
 * One verdict per graphics context. A restore brings a new capability
 * snapshot, and with it a fresh test on the replacement context.
 */
const verdicts = new WeakMap<GraphicsCapabilities, LightShaderVerdict>();

/**
 * @internal Whether the light program builds on the context the renderer
 * draws with. Linking the same sources Pixi would compile takes a few
 * milliseconds once, and leaves the compiled program in the browser's own
 * cache for the draw that follows.
 */
export function lightShaderVerdict(
  renderer: RendererPlugin,
): LightShaderVerdict {
  const capabilities = renderer.capabilities;
  const cached = verdicts.get(capabilities);
  if (cached) return cached;
  const gl = (renderer.application.renderer as WebGLRenderer).gl;
  // A context is marked lost as soon as it goes, and the page is told from a
  // later task. In between it builds nothing, so what it answers says nothing
  // about the driver and is neither reported nor kept.
  if (gl.isContextLost()) return CONTEXT_LOST;
  const verdict = linkLightProgram(gl);
  if (verdict.outcome === "context-lost") return verdict;
  verdicts.set(capabilities, verdict);
  return verdict;
}

/**
 * Compile and link the light program on its own, then throw away everything
 * it created. Nothing is bound and no program is made current, so the state
 * Pixi left behind is the state it finds again.
 */
function linkLightProgram(gl: WebGL2RenderingContext): LightShaderVerdict {
  const sources = lightProgramSources();
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  try {
    if (vertex === null || fragment === null || program === null) {
      if (gl.isContextLost()) return CONTEXT_LOST;
      // A context that builds nothing at all is a context that cannot draw
      // this renderer either.
      return { outcome: "rejected", log: null };
    }
    gl.shaderSource(vertex, sources.vertex);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, sources.fragment);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) {
      return { outcome: "linked" };
    }
    // A link that fails because the context went away during it reports the
    // same empty result as a driver that refused the program.
    if (gl.isContextLost()) return CONTEXT_LOST;
    return {
      outcome: "rejected",
      log: firstLog([
        gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(fragment),
        gl.getShaderInfoLog(vertex),
      ]),
    };
  } finally {
    if (program !== null) gl.deleteProgram(program);
    if (vertex !== null) gl.deleteShader(vertex);
    if (fragment !== null) gl.deleteShader(fragment);
  }
}

/** The first log with anything in it, trimmed. */
function firstLog(logs: Array<string | null>): string | null {
  for (const log of logs) {
    const text = log?.trim();
    if (text) return text;
  }
  return null;
}

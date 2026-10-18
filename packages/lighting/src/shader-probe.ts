import type { GraphicsCapabilities, RendererPlugin } from "@yagejs/renderer";
import type { WebGLRenderer } from "pixi.js";
import { lightProgramSources } from "./light-shader.js";

/** Whether a driver built the light program, and what it said when it did not. */
export type LightShaderVerdict =
  | { readonly linked: true }
  | { readonly linked: false; readonly log: string | null };

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
  const verdict = linkLightProgram(gl);
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
      // A context that builds nothing at all is a context that cannot draw
      // this renderer either.
      return { linked: false, log: null };
    }
    gl.shaderSource(vertex, sources.vertex);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, sources.fragment);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) {
      return { linked: true };
    }
    return {
      linked: false,
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

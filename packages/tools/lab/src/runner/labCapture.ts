import type { Engine } from "@yagejs/core";
import { RendererKey, type RendererPlugin } from "@yagejs/renderer";

export type CaptureView = "content" | "camera";

export interface LabCaptureResult {
  /** A `data:image/png;base64,...` URL. */
  readonly dataUrl: string;
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function positiveLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** GPU capabilities come from browser-owned objects and may be unavailable. */
function textureLimit(renderer: unknown): number | undefined {
  if (!isRecord(renderer)) return undefined;

  try {
    const gl = renderer["gl"];
    if (isRecord(gl) && typeof gl["getParameter"] === "function") {
      const parameter = gl["MAX_TEXTURE_SIZE"];
      if (parameter !== undefined) {
        const value = Reflect.apply(gl["getParameter"], gl, [parameter]);
        const limit = positiveLimit(value);
        if (limit !== undefined) return limit;
      }
    }
  } catch {
    // A limit that cannot be read leaves no warning. Guessing one would fire
    // on runs that were never going to exceed it.
  }

  const gpu = renderer["gpu"];
  if (!isRecord(gpu)) return undefined;
  const device = gpu["device"];
  if (!isRecord(device)) return undefined;
  const limits = device["limits"];
  if (!isRecord(limits)) return undefined;
  return positiveLimit(limits["maxTextureDimension2D"]);
}

function contentWarning(engine: Engine): string | undefined {
  try {
    const renderer = engine.context.tryResolve(RendererKey);
    if (!renderer) return undefined;
    const limit = textureLimit(renderer.application.renderer);
    if (limit === undefined) return undefined;

    const bounds = renderer.application.stage.getLocalBounds();
    const resolution = renderer.application.renderer.resolution;
    const width = Math.ceil(bounds.width * resolution);
    const height = Math.ceil(bounds.height * resolution);
    if (width <= limit && height <= limit) return undefined;

    // Named by view rather than by CLI flag: the panel captures through the
    // same call and has no command line to pass one on.
    return (
      `Content screenshot size ${width}×${height} exceeds the GPU texture ` +
      `limit of ${limit} pixels per side, which captures blank. Take the ` +
      `camera view instead — it captures at the game's virtual resolution.`
    );
  } catch {
    return undefined;
  }
}

function requireRenderer(engine: Engine): RendererPlugin {
  const renderer = engine.context.tryResolve(RendererKey);
  if (!renderer) {
    throw new Error(
      "Camera-view capture requires RendererPlugin to be active.",
    );
  }
  return renderer;
}

/** Captures either all drawn content or the camera's virtual viewport. */
export async function captureLab(
  engine: Engine,
  view: CaptureView = "content",
): Promise<LabCaptureResult> {
  if (view === "content") {
    const warning = contentWarning(engine);
    return {
      dataUrl: await engine.inspector.capture.dataURL(),
      warnings: warning === undefined ? [] : [warning],
    };
  }

  const renderer = requireRenderer(engine);
  const { application, virtualSize, worldRoot } = renderer;
  // Pixi calls `copyTo` on the frame. Cloning the screen keeps a real
  // Rectangle without making the lab depend directly on pixi.js.
  const frame = application.renderer.screen.clone();
  frame.x = 0;
  frame.y = 0;
  frame.width = virtualSize.width;
  frame.height = virtualSize.height;
  // Rendering a container promotes it to a render group and leaves it one.
  // The renderer keeps the fit container out of a render group on purpose, and
  // a render-group root's own mask and filters are skipped when the scene is
  // collected, so the capture restores what it found.
  const wasRenderGroup = Boolean(worldRoot.renderGroup);
  let canvas;
  try {
    canvas = application.renderer.extract.canvas({
      target: worldRoot,
      frame,
      resolution: 1,
    });
  } finally {
    if (!wasRenderGroup) worldRoot.disableRenderGroup();
  }
  if (canvas.toDataURL === undefined) {
    throw new Error("Camera-view capture requires a canvas with toDataURL().");
  }
  return { dataUrl: canvas.toDataURL("image/png"), warnings: [] };
}

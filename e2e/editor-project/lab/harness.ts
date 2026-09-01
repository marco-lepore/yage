import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { exposeLevelFacts } from "../src/inspect.js";

/** What the editor's preview draws in, in virtual pixels. */
const VIEW = { width: 960, height: 600 };

/**
 * The engine the editor's preview runs.
 *
 * `debug: true` is what exposes `window.__yage__.inspector`, which the E2E path
 * reads the preview through.
 */
export default {
  engine: () => {
    const engine = new Engine({ debug: true });
    exposeLevelFacts(engine);
    return engine;
  },
  plugins: ({ container }: { container: HTMLElement }) => {
    const renderer = new RendererPlugin({
      width: VIEW.width,
      height: VIEW.height,
      backgroundColor: 0x0f172a,
      container,
    });
    // The E2E path asks this for the mapping between client pixels and the
    // renderer's virtual pixels, so it can say what a drag of N pixels should
    // be worth in world units, and where on the canvas a placement is, without
    // modelling the fit itself.
    (window as unknown as { __editorTest__?: unknown }).__editorTest__ = {
      view: VIEW,
      canvasToVirtual: (x: number, y: number) => {
        const point = renderer.canvasToVirtual(x, y);
        return { x: point.x, y: point.y };
      },
      virtualToCanvas: (x: number, y: number) => {
        const point = renderer.virtualToCanvas(x, y);
        return { x: point.x, y: point.y };
      },
    };
    return [renderer];
  },
};

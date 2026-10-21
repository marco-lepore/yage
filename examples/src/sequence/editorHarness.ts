import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { HEIGHT, WIDTH } from "./constants.js";

/** The engine and plugins the editor's preview runs the actors in. */
export default {
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }: { container: HTMLElement }) => [
    new RendererPlugin({
      container,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x121820,
    }),
  ],
};

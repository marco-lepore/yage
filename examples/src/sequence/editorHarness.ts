import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
export default {
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }: { container: HTMLElement }) => [
    new RendererPlugin({
      container,
      width: 960,
      height: 540,
      backgroundColor: 0x121820,
    }),
  ],
};

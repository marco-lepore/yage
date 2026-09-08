import { defineHarness } from "@yagejs-tools/lab";
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { InputPlugin } from "@yagejs/input";
import { FeedbackPlugin } from "../../src/index.js";

export default defineHarness({
  width: 800,
  height: 450,
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }) => [
    new RendererPlugin({
      width: 800,
      height: 450,
      backgroundColor: 0x172b38,
      container,
    }),
    new InputPlugin({ actions: { signal: ["Space"] } }),
    new DebugPlugin(),
    new FeedbackPlugin({
      enabled: true,
      context: () => ({
        host: "lab",
        experiment: "formation",
        source: "demo/formation.scenario.ts",
      }),
    }),
  ],
});

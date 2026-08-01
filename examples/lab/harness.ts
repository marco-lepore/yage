import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { PhysicsPlugin } from "@yagejs/physics";
import { DebugPlugin } from "@yagejs/debug";
import { defineHarness } from "@yagejs-tools/lab";

export const WIDTH = 640;
export const HEIGHT = 420;

/**
 * One harness for every scenario on the page, so they all run against the same
 * plugin set the examples themselves use.
 */
export default defineHarness({
  width: WIDTH,
  height: HEIGHT,
  engine: () => new Engine({ debug: true }),
  plugins: ({ container }) => [
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0f172a,
      container,
    }),
    new PhysicsPlugin({ gravity: { x: 0, y: 980 } }),
    // `Inspector.time` throws without it, so a harness that wants frame
    // stepping has to declare it.
    new DebugPlugin({ deterministicSeed: 1 }),
  ],
});

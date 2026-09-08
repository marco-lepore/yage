import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { InputPlugin } from "@yagejs/input";
import { FeedbackPlugin } from "../src/index.js";
import { FormationScene } from "./formation.js";

const debug = new URLSearchParams(location.search).get("debug") !== "false";
const engine = new Engine({ debug });
const container = document.querySelector<HTMLElement>("#game")!;
engine.use(
  new RendererPlugin({
    width: 800,
    height: 450,
    backgroundColor: 0x172b38,
    container,
  }),
);
engine.use(new InputPlugin({ actions: { signal: ["Space"] } }));
engine.use(new DebugPlugin());
engine.use(
  new FeedbackPlugin({
    enabled: debug,
    context: () => ({
      host: "runtime",
      example: "formation",
      source: "demo/formation.ts",
    }),
  }),
);
await engine.start();
await engine.scenes.push(new FormationScene());
document.querySelector<HTMLButtonElement>("#destroy")!.onclick = () => {
  engine.destroy();
};

import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { SequenceDemo, SequenceScene } from "./scene.js";

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: 960,
    height: 540,
    backgroundColor: 0x0b1525,
    container: setupGameContainer(960, 540),
  }),
);
await installDebugFromUrl(engine);
await engine.start();
await engine.scenes.push(new SequenceScene());
const demo = engine.scenes
  .active!.findByKey("sequence-host")!
  .get(SequenceDemo);
const controls = document.querySelector<HTMLElement>("#sequence-controls")!;
const replay = document.createElement("button");
replay.textContent = "Replay";
replay.addEventListener("click", () => demo.play());
controls.append(replay);
const label = document.createElement("label");
label.textContent = " Play a saved clip or sequence workspace ";
const file = document.createElement("input");
file.type = "file";
file.accept = ".json";
file.setAttribute("aria-label", "Play saved sequence");
label.append(file);
controls.append(label);
const status = document.createElement("p");
status.setAttribute("role", "alert");
controls.append(status);
file.addEventListener("change", () => {
  const selected = file.files?.[0];
  if (selected)
    void selected
      .text()
      .then((text) => {
        const data: unknown = JSON.parse(text);
        demo.play(
          typeof data === "object" &&
            data !== null &&
            "format" in data &&
            data.format === "yage-sequence-workspace" &&
            "sequence" in data
            ? data.sequence
            : data,
        );
        status.textContent = "Sequence loaded with runtime actor bindings";
      })
      .catch((error: unknown) => {
        status.textContent = String(error);
      });
});
demo.play();

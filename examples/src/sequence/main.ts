/**
 * Sequence addon example — one authored clip plays on two actors, and a
 * director pauses it while an actor greets. The page's file input plays a
 * workspace saved by the editor's Sequence mode, or an exported runtime clip.
 *
 * The layout follows the platformer example:
 * - `constants.ts` — sizes, the stage rectangle, the actors, the gesture event.
 * - `actor.ts` — the actor entity and the target a clip slot binds to.
 * - `director.ts` — the host entity that plays clips.
 * - `scene.ts` — the `Scene` subclass; `onEnter` only spawns.
 * - `main.ts` — engine, plugins, and the page controls.
 */
import { Engine } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import {
  installDebugFromUrl,
  setupGameContainer,
} from "../shared/bootstrap.js";
import { HEIGHT, WIDTH } from "./constants.js";
import { DIRECTOR_KEY } from "./director.js";
import type { DirectorEntity } from "./director.js";
import { SequenceScene } from "./scene.js";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0b1525,
    container: setupGameContainer(WIDTH, HEIGHT),
  }),
);
await installDebugFromUrl(engine);
await engine.start();
const scene = new SequenceScene();
await engine.scenes.push(scene);
const director = scene.findByKey<DirectorEntity>(DIRECTOR_KEY)!.director;
director.play();

// ---------------------------------------------------------------------------
// Page controls
// ---------------------------------------------------------------------------
const status = document.querySelector<HTMLElement>("#sequence-status")!;
const file = document.querySelector<HTMLInputElement>("#sequence-file")!;

document
  .querySelector<HTMLButtonElement>("#sequence-replay")!
  .addEventListener("click", () => director.replay());

file.addEventListener("change", () => {
  void file.files?.[0]?.text().then(playFile);
});

/**
 * Play a saved workspace or runtime clip. A file the director refuses leaves
 * the current clip playing and shows the error.
 */
function playFile(text: string): void {
  try {
    const data: unknown = JSON.parse(text);
    // A workspace file holds the runtime clip in its `sequence` field.
    director.play(
      typeof data === "object" &&
        data !== null &&
        "format" in data &&
        data.format === "yage-sequence-workspace" &&
        "sequence" in data
        ? data.sequence
        : data,
    );
    status.textContent = "Sequence loaded with runtime actor bindings";
  } catch (error) {
    status.textContent = String(error);
  }
}

import { Component, Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, SplitTextComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 480;
const HEIGHT = 270;
const REVEAL = "Hello world";
const container = setupContainer(WIDTH, HEIGHT);

/**
 * Typewriter reveal: hides every glyph up front, then makes one more glyph
 * visible per frame by toggling `chars[i].visible`. The component's string
 * stays the full "Hello world"; only the live display objects change.
 * The E2E reads the actual revealed glyphs via the Inspector render facet
 * (`snapshotScene().entities[].facets.render.glyphs` / `.visibleText`).
 */
class Typewriter extends Component {
  private revealed = 0;

  constructor(private readonly target: SplitTextComponent) {
    super();
  }

  onAdd(): void {
    for (const char of this.target.chars) char.visible = false;
  }

  update(): void {
    if (this.revealed >= this.target.chars.length) return;
    const char = this.target.chars[this.revealed];
    if (char) char.visible = true;
    this.revealed++;
  }
}

class RevealScene extends Scene {
  readonly name = "split-text-reveal-scene";

  onEnter(): void {
    const entity = this.spawn("reveal-label");
    entity.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    const text = entity.add(
      new SplitTextComponent({
        text: REVEAL,
        charAnchor: 0.5,
        style: {
          fontFamily: "monospace",
          fontSize: 24,
          fill: 0xffffff,
        },
      }),
    );
    entity.add(new Typewriter(text));
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new RevealScene());

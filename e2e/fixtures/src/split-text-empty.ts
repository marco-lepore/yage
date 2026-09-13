import { Engine, Scene, Transform, Vec2 } from "@yagejs/core";
import { RendererPlugin, SplitTextComponent } from "@yagejs/renderer";
import { DebugPlugin } from "@yagejs/debug";
import { UIPlugin, UISplitText, UISurface } from "@yagejs/ui";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();

const WIDTH = 480;
const HEIGHT = 270;
const container = setupContainer(WIDTH, HEIGHT);

const STYLE = { fontFamily: "monospace", fontSize: 24, fill: 0xffffff };

/**
 * Both split-text paths against real Pixi, with the empty string every unit
 * test has to fake: the component mounts empty, is given text, is cleared, and
 * is given text again. Each of those steps runs Pixi's split for real.
 */
class EmptySplitScene extends Scene {
  readonly name = "split-text-empty-scene";

  onEnter(): void {
    const entity = this.spawn("empty-label");
    entity.add(new Transform({ position: new Vec2(WIDTH / 2, 80) }));
    const component = entity.add(
      new SplitTextComponent({ text: "", style: STYLE }),
    );

    const surface = this.spawn("empty-ui").add(new UISurface());
    const uiText = new UISplitText({ children: "", style: STYLE });
    surface.addElement(uiText);

    window.__splitEmpty__ = {
      run() {
        const seen: number[] = [];
        for (const value of ["", "Hello", "", "world"]) {
          component.setText(value);
          uiText.setText(value);
          seen.push(component.chars.length, uiText.chars.length);
        }
        return seen;
      },
    };
  }
}

declare global {
  interface Window {
    __splitEmpty__?: { run(): number[] };
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
engine.use(new UIPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new EmptySplitScene());

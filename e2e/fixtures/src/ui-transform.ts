import {
  Component,
  Engine,
  Scene,
  Transform,
  InspectorKey,
} from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputPlugin } from "@yagejs/input";
import { UIPlugin, UISurface, Anchor } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const container = setupContainer(320, 180);

/** Counts the clicks the button's own `onClick` received. */
class ClickProbe extends Component {
  spinClicks = 0;
}

class TransformScene extends Scene {
  readonly name = "ui-transform";

  onEnter(): void {
    const probeEntity = this.spawn("probe");
    probeEntity.add(new Transform());
    const probe = probeEntity.add(new ClickProbe());

    // An 80 x 30 button turned an eighth about its centre at 1.25x. Its
    // layout box is (60, 60)–(140, 90); it draws around the centre (100, 75).
    const spin = this.spawn("spin").add(
      new UISurface({ anchor: Anchor.TopLeft, offset: { x: 60, y: 60 } }),
    );
    spin.button("Spin", {
      width: 80,
      height: 30,
      transformOrigin: 0.5,
      scale: 1.25,
      rotation: Math.PI / 4,
      onClick: () => {
        probe.spinClicks += 1;
      },
    });
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: 320,
    height: 180,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new InputPlugin());
engine.use(new UIPlugin());
engine.use(new DebugPlugin());

await engine.start();
engine.context.resolve(InspectorKey).time.freeze();
await engine.scenes.push(new TransformScene());

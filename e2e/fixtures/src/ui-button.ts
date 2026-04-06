import { Anchor, Component, Scene, UIPanel, createGame } from "yage";
import { injectStyles } from "./shared.js";

injectStyles();

class ClickTracker extends Component {
  clicks = 0;
}

class UIButtonScene extends Scene {
  readonly name = "ui-button-scene";

  onEnter(): void {
    const entity = this.spawn("ui-state");
    const tracker = entity.add(new ClickTracker());
    const panel = entity.add(
      new UIPanel({
        anchor: Anchor.TopLeft,
        offset: { x: 20, y: 20 },
        width: 220,
        height: 120,
        padding: 20,
        background: { color: 0x1f2937, alpha: 1, radius: 8 },
      }),
    );

    panel.button("Click Me", {
      width: 160,
      height: 60,
      onClick: () => {
        tracker.clicks += 1;
      },
    });
  }
}

await createGame({
  width: 320,
  height: 180,
  backgroundColor: 0x0a0a0a,
  renderer: { resolution: 1 },
  ui: true,
  debug: { manualClock: true },
  scene: new UIButtonScene(),
});

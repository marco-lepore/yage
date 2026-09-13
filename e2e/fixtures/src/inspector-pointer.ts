import { Component, Engine, Scene, Transform } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { UIPlugin, UISurface, Anchor } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

const params = new URLSearchParams(window.location.search);
/** An off-aspect host, so the letterbox fit scales the canvas and adds bars. */
const letterbox = params.has("letterbox");
/** Boot with Pixi's ticker stopped, so no frame has been drawn. */
const startFrozen = params.has("frozen");

injectStyles();
const container = letterbox
  ? setupContainer(400, 300)
  : setupContainer(320, 180);

/**
 * Counts what each click reached: a button's own `onClick`, and the `fire`
 * action bound to `MouseLeft`. The two answer different questions — the
 * handler runs during dispatch, the action edge one drain later.
 */
class ClickProbe extends Component {
  private readonly input = this.service(InputManagerKey);
  plainClicks = 0;
  disabledClicks = 0;
  coveredClicks = 0;
  fireDowns = 0;
  private off: (() => void) | undefined;

  override onAdd(): void {
    this.off = this.input.onAction("fire", () => {
      this.fireDowns += 1;
    });
  }

  override onDestroy(): void {
    this.off?.();
    this.off = undefined;
  }
}

class PointerScene extends Scene {
  readonly name = "inspector-pointer";

  onEnter(): void {
    const probeEntity = this.spawn("probe");
    probeEntity.add(new Transform());
    const probe = probeEntity.add(new ClickProbe());

    // A plain button, top-left. A click here must run its handler.
    const plain = this.spawn("plain").add(
      new UISurface({
        anchor: Anchor.TopLeft,
        offset: { x: 10, y: 10 },
        width: 120,
        height: 40,
        background: { color: 0x1f2937, alpha: 1 },
      }),
    );
    plain.button("Play", {
      width: 120,
      height: 40,
      onClick: () => {
        probe.plainClicks += 1;
      },
    });

    // A disabled button, top-right. Its pointer mode is off, so the hit falls
    // through to the surface panel behind it.
    const disabled = this.spawn("disabled").add(
      new UISurface({
        anchor: Anchor.TopRight,
        offset: { x: 10, y: 10 },
        width: 120,
        height: 40,
        background: { color: 0x312e81, alpha: 1 },
      }),
    );
    disabled.button("Locked", {
      width: 120,
      height: 40,
      disabled: true,
      onClick: () => {
        probe.disabledClicks += 1;
      },
    });

    // A button under an opaque overlay, bottom-left. The overlay is a later
    // sibling, so it draws on top and takes the click.
    const covered = this.spawn("covered").add(
      new UISurface({
        anchor: Anchor.BottomLeft,
        offset: { x: 10, y: 10 },
        width: 120,
        height: 40,
        background: { color: 0x1f2937, alpha: 1 },
      }),
    );
    covered.button("Buy", {
      width: 120,
      height: 40,
      onClick: () => {
        probe.coveredClicks += 1;
      },
    });
    covered.panel({
      position: "absolute",
      left: 0,
      top: 0,
      width: 120,
      height: 40,
      background: { color: 0x7f1d1d, alpha: 1 },
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
engine.use(new InputPlugin({ actions: { fire: ["MouseLeft"] } }));
engine.use(new UIPlugin());
engine.use(new DebugPlugin(startFrozen ? { startFrozen: true } : {}));

await engine.start();
if (!startFrozen) engine.inspector.time.freeze();
await engine.scenes.push(new PointerScene());

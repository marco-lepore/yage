import {
  Component,
  Engine,
  Scene,
  Transform,
} from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { InputManagerKey, InputPlugin } from "@yagejs/input";
import { UIPlugin, UIPanel, Anchor } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const container = setupContainer(320, 180);

/**
 * Counts action / pointer / wheel signals so the spec can assert what fired
 * for each click without inspecting Pixi internals. The component reads from
 * `InputManagerKey` and ticks once per frame; the spec drives Playwright
 * mouse / wheel events and steps frames between assertions.
 */
class ConsumeProbe extends Component {
  private readonly input = this.service(InputManagerKey);
  /** Rising-edge count for the `fire` action (bound to `MouseLeft`). */
  fireDowns = 0;
  /** Falling-edge count for the `fire` action. */
  fireUps = 0;
  /** Sticky "is fire currently held" — used by the drag-through-up assertion. */
  fireHeldThisFrame = false;
  /** Total `pointerdown` events (any pointer, regardless of consumed status). */
  pointerDowns = 0;
  /** Frame-counted `WheelUp` rising edges. */
  wheelUps = 0;
  /** Frame-counted `WheelDown` rising edges. */
  wheelDowns = 0;
  private disposers: Array<() => void> = [];

  override onAdd(): void {
    this.disposers.push(
      this.input.onAction("fire", () => {
        this.fireDowns += 1;
      }),
      this.input.onActionReleased("fire", () => {
        this.fireUps += 1;
      }),
      this.input.onPointerDown(() => {
        this.pointerDowns += 1;
      }),
      this.input.onKeyDown("WheelUp", () => {
        this.wheelUps += 1;
      }),
      this.input.onKeyDown("WheelDown", () => {
        this.wheelDowns += 1;
      }),
    );
  }

  override onDestroy(): void {
    for (const off of this.disposers) off();
    this.disposers.length = 0;
  }

  override update(): void {
    this.fireHeldThisFrame = this.input.isPressed("fire");
  }
}

class ConsumeScene extends Scene {
  readonly name = "input-ui-consume";

  onEnter(): void {
    // Probe entity reads action / wheel state each frame.
    const probeEntity = this.spawn("probe");
    probeEntity.add(new Transform());
    probeEntity.add(new ConsumeProbe());

    // Default-consume UI panel covering the top-left quadrant.
    // Default `consumeInput: true` — clicks here MUST NOT fire `fire`.
    this.spawn("ui-default").add(
      new UIPanel({
        anchor: Anchor.TopLeft,
        offset: { x: 0, y: 0 },
        width: 100,
        height: 60,
        background: { color: 0x1f2937, alpha: 0.95, radius: 0 },
      }),
    );

    // Escape-hatch panel in the top-right. `consumeInput: false` makes the
    // panel transparent to the action map — clicks here SHOULD fire `fire`.
    this.spawn("ui-passthrough").add(
      new UIPanel({
        anchor: Anchor.TopRight,
        offset: { x: 0, y: 0 },
        width: 100,
        height: 60,
        background: { color: 0x4b1d3f, alpha: 0.95, radius: 0 },
        consumeInput: false,
      }),
    );
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
engine.use(
  new InputPlugin({
    actions: {
      fire: ["MouseLeft"],
      jump: ["Space"],
    },
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin());

await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new ConsumeScene());

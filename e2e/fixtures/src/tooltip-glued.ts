/**
 * E2E fixture for the imperative `attachTooltip` (non-React) floating layer.
 * Driven by `e2e/specs/tooltip-glued.spec.ts`.
 *
 * Mirrors the `examples/src/world-ui.ts` diegetic namecard case: a screen-
 * following trigger above a moving target, with an `attachTooltip` stats
 * card. The camera-followed target drifts so the trigger traverses the
 * screen; the test asserts the bubble stays glued a fixed gap above the
 * trigger across samples (the overlay re-anchors it every frame against the
 * camera-transformed trigger — with no `<UIRoot>` / React present).
 */
import { Engine, Scene, Transform, Vec2, Component } from "@yagejs/core";
import { RendererPlugin, CameraEntity, ScreenFollow } from "@yagejs/renderer";
import {
  UIPlugin,
  UIPanel,
  PanelNode,
  UIText,
  attachTooltip,
  FloatingOverlayKey,
} from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;
injectStyles();
const container = setupContainer(WIDTH, HEIGHT);

// A target that drifts right each frame so the namecard traverses the
// screen under the following camera.
class Drift extends Component {
  private readonly transform = this.sibling(Transform);
  update(dt: number): void {
    this.transform.translate(150 * dt, 0);
  }
}

class TooltipScene extends Scene {
  readonly name = "tooltip-scene";

  onEnter(): void {
    const camera = this.spawn(CameraEntity, { position: new Vec2(400, 300) });

    const target = this.spawn("target");
    target.add(new Transform({ position: new Vec2(150, 300) }));
    target.add(new Drift());

    const nameplate = this.spawn("nameplate");
    nameplate.add(new Transform());
    nameplate.add(
      new ScreenFollow({ target, camera, offset: new Vec2(0, -40) }),
    );
    const panel = nameplate.add(
      new UIPanel({
        positioning: "transform",
        padding: 4,
        background: { color: 0x000000, alpha: 0.6, radius: 4 },
      }),
    );
    panel.text("Goblin", { fontSize: 11, fill: 0xffffff });

    const tip = attachTooltip(panel, this, {
      placement: "top",
      offset: 8,
      maxWidth: 200,
      content: () => {
        const card = new PanelNode({
          padding: 6,
          gap: 4,
          background: { color: 0x111827, alpha: 0.95, radius: 6 },
        });
        card.addElement(
          new UIText({ children: "Goblin", style: { fontSize: 13, fill: 0xffffff } }),
        );
        card.addElement(
          new UIText({ children: "HP 100 / 100", style: { fontSize: 11, fill: 0xe5e7eb } }),
        );
        return card;
      },
    });
    // attachTooltip wires no input itself — drive it from the trigger's hover.
    panel.setPointerHandlers({ onHover: tip.setActive });

    const overlay = this._resolveScoped(FloatingOverlayKey)!;
    const triggerContainer = panel.container;

    // Probe for the spec. `show`/`hide` fire the trigger's Pixi pointer
    // events, which run the `onHover` wired above to `tip.setActive` — no real
    // cursor needed. `probe()` reports the bubble + trigger boxes in the
    // overlay's own coordinate space so the spec can assert the gap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__tooltip__ = {
      show: () => triggerContainer.emit("pointerover"),
      hide: () => triggerContainer.emit("pointerout"),
      probe: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const layer = (overlay as any).layer as {
          children: Array<{
            visible: boolean;
            position: { x: number; y: number };
            getLocalBounds(): { width: number; height: number };
          }>;
          toLocal(p: { x: number; y: number }, from: unknown): { x: number; y: number };
        };
        const bubble = layer.children.find((c) => c.visible) ?? null;
        const triggerDO = panel._node.displayObject;
        const w = panel._node.yogaNode.getComputedWidth();
        const h = panel._node.yogaNode.getComputedHeight();
        const a = layer.toLocal({ x: 0, y: 0 }, triggerDO);
        const b = layer.toLocal({ x: w, y: h }, triggerDO);
        const trigger = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
        };
        return bubble
          ? {
              bubble: {
                x: bubble.position.x,
                y: bubble.position.y,
                width: bubble.getLocalBounds().width,
                height: bubble.getLocalBounds().height,
              },
              trigger,
            }
          : { bubble: null, trigger };
      },
    };
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
engine.use(new UIPlugin());
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new TooltipScene());

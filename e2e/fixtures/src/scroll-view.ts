import { Engine, Component, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin, UISurface, UIButton, Anchor } from "@yagejs/ui";
import type { UIScrollView } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const container = setupContainer(360, 260);

// Module refs the probe reads each frame (set in onEnter). The controls and
// row coordinates expose both programmatic scrolling and pointer dragging.
let svNode: UIScrollView | null = null;
let scrollBtn: UIButton | null = null;
let endBtn: UIButton | null = null;
let orderSeq = 0;
let orderClicks = 0;

const CTRL_W = 110;
const CTRL_H = 32;

function fillOrders(sv: UIScrollView, n: number): void {
  for (const c of [...sv.children]) sv.removeElement(c);
  for (let i = 0; i < n; i++) {
    orderSeq += 1;
    sv.addElement(
      new UIButton({
        children: `Order #${orderSeq}`,
        width: 220,
        height: 36,
        onClick: () => {
          orderClicks += 1;
        },
      }),
    );
  }
}

/**
 * Mirrors ScrollView state + control-button screen positions into
 * inspectable fields. Lives on the UI entity; `Component.update()` runs each
 * frame via ComponentUpdateSystem.
 */
class ScrollProbe extends Component {
  offset = 0;
  maxScroll = 0;
  orderCount = 0;
  scrollBtnX = 0;
  scrollBtnY = 0;
  endX = 0;
  endY = 0;
  rowX = 0;
  rowY = 0;
  orderClicks = 0;

  update(): void {
    if (svNode) {
      this.offset = svNode.scrollOffset;
      this.maxScroll = svNode.maxScroll;
      this.orderCount = svNode.children.length;
      const first = svNode.children[0];
      if (first) {
        const p = first.displayObject.getGlobalPosition();
        this.rowX = p.x;
        this.rowY = p.y;
      }
      this.orderClicks = orderClicks;
    }
    if (scrollBtn) {
      const p = scrollBtn.displayObject.getGlobalPosition();
      this.scrollBtnX = p.x;
      this.scrollBtnY = p.y;
    }
    if (endBtn) {
      const p = endBtn.displayObject.getGlobalPosition();
      this.endX = p.x;
      this.endY = p.y;
    }
  }
}

class ScrollViewScene extends Scene {
  readonly name = "scroll-view-scene";

  onEnter(): void {
    const entity = this.spawn("ui-state");
    entity.add(new ScrollProbe());

    const panel = entity.add(
      new UISurface({
        anchor: Anchor.Center,
        direction: "column",
        width: 260,
        height: 220,
        padding: 10,
        gap: 8,
        background: { color: 0x111827, alpha: 1, radius: 8 },
      }),
    );

    const sv = panel.scrollView({
      flexGrow: 1,
      gap: 6,
      background: { color: 0x0b1220, alpha: 1, radius: 4 },
    });
    svNode = sv;
    fillOrders(sv, 8);

    // Fixed sibling control row. These buttons stay put while the list
    // scrolls (position-invariance assertion) and drive scrolling via the
    // public API on click.
    const controls = panel.panel({ direction: "row", gap: 8 });
    scrollBtn = controls.button("Scroll", {
      width: CTRL_W,
      height: CTRL_H,
      onClick: () => sv.scrollBy(60),
    });
    controls.button("Top", {
      width: CTRL_W,
      height: CTRL_H,
      onClick: () => sv.scrollTo(0),
    });

    // Rebuilds children on the SAME ScrollView instance — simulates a
    // store-driven refresh; the scroll offset must survive (re-clamped).
    endBtn = panel.button("End Day", {
      width: CTRL_W,
      height: CTRL_H,
      onClick: () => fillOrders(sv, 8),
    });
  }
}

const engine = new Engine({ debug: true });
engine.use(
  new RendererPlugin({
    width: 360,
    height: 260,
    virtualWidth: 360,
    virtualHeight: 260,
    backgroundColor: 0x0a0a0a,
    resolution: 1,
    container,
  }),
);
engine.use(new UIPlugin());
engine.use(new DebugPlugin());
await engine.start();
engine.inspector.time.freeze();
await engine.scenes.push(new ScrollViewScene());

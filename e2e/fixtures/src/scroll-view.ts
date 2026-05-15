import { Engine, Component, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin, UIPanel, UIButton, Anchor } from "@yagejs/ui";
import type { ScrollViewNode } from "@yagejs/ui";
import { DebugPlugin } from "@yagejs/debug";
import { injectStyles, setupContainer } from "./shared.js";

injectStyles();
const container = setupContainer(360, 260);

// Module refs the probe reads each frame (set in onEnter).
let svNode: ScrollViewNode | null = null;
let footerNode: UIButton | null = null;
let orderSeq = 0;

function fillOrders(sv: ScrollViewNode, n: number): void {
  for (const c of [...sv.children]) sv.removeElement(c);
  for (let i = 0; i < n; i++) {
    orderSeq += 1;
    sv.addElement(
      new UIButton({
        children: `Order #${orderSeq}`,
        width: 220,
        height: 36,
      }),
    );
  }
}

/**
 * Mirrors ScrollView state into inspectable component fields. Lives on the
 * UI entity; `Component.update()` runs each frame via ComponentUpdateSystem.
 */
class ScrollProbe extends Component {
  offset = 0;
  maxScroll = 0;
  orderCount = 0;
  footerX = 0;
  footerY = 0;

  update(): void {
    if (svNode) {
      this.offset = svNode.scrollOffset;
      this.maxScroll = svNode.maxScroll;
      this.orderCount = svNode.children.length;
    }
    if (footerNode) {
      const p = footerNode.displayObject.getGlobalPosition();
      this.footerX = p.x;
      this.footerY = p.y;
    }
  }
}

class ScrollViewScene extends Scene {
  readonly name = "scroll-view-scene";

  onEnter(): void {
    const entity = this.spawn("ui-state");
    entity.add(new ScrollProbe());

    const panel = entity.add(
      new UIPanel({
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

    // The fixed sibling. Clicking it simulates a store-driven refresh:
    // the children are rebuilt on the SAME ScrollView instance, so the
    // scroll offset must survive (re-clamped to the new content height).
    footerNode = panel.button("End Day", {
      height: 36,
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

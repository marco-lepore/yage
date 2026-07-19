import { useState } from "react";
import { Engine, Scene } from "@yagejs/core";
import { RendererPlugin } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import {
  UIReactPlugin,
  UIRoot,
  Panel,
  Button,
  ScrollView,
  Text,
  Tooltip,
  Anchor,
} from "@yagejs/ui-react";
import { installDebugFromUrl, setupGameContainer } from "./shared/bootstrap";

// ---------------------------------------------------------------------------
// A right-rail "Orders" panel: a declarative, scrollable list of card
// components that mutates on every user action. The list scrolls past ~4
// rows inside a fixed-height panel; the "End Day" button is a sibling of
// <ScrollView> so it stays put while the list scrolls; scroll position is
// preserved across the re-renders driven by fulfilling / refilling orders.
// ---------------------------------------------------------------------------

interface Order {
  id: number;
  label: string;
}

let nextId = 1;
function makeOrders(n: number): Order[] {
  return Array.from({ length: n }, () => {
    const id = nextId++;
    return { id, label: `Order #${id}` };
  });
}

function OrderRow({
  order,
  onFulfill,
}: {
  order: Order;
  onFulfill: () => void;
}): React.JSX.Element {
  return (
    <Panel
      direction="row"
      width="100%"
      height={36}
      padding={{ left: 8, right: 6 }}
      alignItems="center"
      justifyContent="space-between"
      bg={{ color: 0x243042, alpha: 1, radius: 4 }}
    >
      <Text style={{ fill: 0xe5e7eb, fontSize: 14 }}>{order.label}</Text>
      <Tooltip
        content={`Fulfill ${order.label}`}
        placement="left"
        bg={{ color: 0x243042, alpha: 1, radius: 4 }}
        padding={{ left: 10, right: 10, top: 6, bottom: 6 }}
        textStyle={{ fill: 0xe5e7eb, fontSize: 12 }}
      >
        <Button
          height={24}
          onClick={onFulfill}
          bg={{ color: 0x2563eb, alpha: 1, radius: 3 }}
          hoverBg={{ color: 0x3b82f6, alpha: 1, radius: 3 }}
          textStyle={{ fill: 0xffffff, fontSize: 12 }}
        >
          Fulfill
        </Button>
      </Tooltip>
    </Panel>
  );
}

function OrdersPanel(): React.JSX.Element {
  const [orders, setOrders] = useState<Order[]>(() => makeOrders(8));

  return (
    <Panel
      direction="column"
      width={300}
      height={220}
      padding={10}
      gap={10}
      bg={{ color: 0x111827, alpha: 1, radius: 8 }}
    >
      <Text style={{ fill: 0x93c5fd, fontSize: 16 }}>Orders</Text>

      <ScrollView
        flexGrow={1}
        gap={6}
        bg={{ color: 0x0b1220, alpha: 1, radius: 4 }}
      >
        {orders.map((o) => (
          <OrderRow
            key={o.id}
            order={o}
            onFulfill={() =>
              setOrders((cur) => cur.filter((x) => x.id !== o.id))
            }
          />
        ))}
      </ScrollView>

      <Button
        height={36}
        onClick={() => setOrders(makeOrders(8))}
        bg={{ color: 0x16a34a, alpha: 1, radius: 4 }}
        hoverBg={{ color: 0x22c55e, alpha: 1, radius: 4 }}
        textStyle={{ fill: 0xffffff, fontSize: 15 }}
      >
        End Day
      </Button>
    </Panel>
  );
}

class ScrollViewScene extends Scene {
  readonly name = "scroll-view-scene";

  onEnter(): void {
    const entity = this.spawn("orders-ui");
    const root = entity.add(new UIRoot({ anchor: Anchor.Center }));
    root.render(<OrdersPanel />);
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });
  engine.use(
    new RendererPlugin({
      width: 640,
      height: 480,
      virtualWidth: 640,
      virtualHeight: 480,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(640, 480),
    }),
  );
  engine.use(new UIPlugin());
  engine.use(new UIReactPlugin());
  await installDebugFromUrl(engine);
  await engine.start();
  await engine.scenes.push(new ScrollViewScene());
}

main().catch(console.error);

// ---------------------------------------------------------------------------
// Non-React (imperative) equivalent — the same node is available without the
// reconciler via the UIPanel `.scrollView()` builder:
//
//   const panel = entity.add(new UISurface({ width: 300, height: 220 }));
//   const list = panel.scrollView({ gap: 6, flexGrow: 1 });
//   for (const o of orders) {
//     const row = new UIButton({ children: o.label, height: 36 });
//     list.addElement(row);
//   }
//   panel.button("End Day", { height: 36, onClick: refill });
//
// `list.scrollBy(dy)` / `list.scrollTo(0)` drive it programmatically.
// ---------------------------------------------------------------------------

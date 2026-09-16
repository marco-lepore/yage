import { Component } from "@yagejs/core";
import type { Inspector, UINodeSnapshot } from "@yagejs/core";
import { Anchor, UISurface } from "@yagejs/ui";
import { defineScenario } from "@yagejs-tools/lab";

const BUTTON_X = 24;
const BUTTON_Y = 24;
const BUTTON_WIDTH = 200;
const BUTTON_HEIGHT = 64;

/** How many times the HUD button's own handler ran. */
class BuildOrders extends Component {
  placed = 0;
}

/**
 * The engine publishes the Inspector here when it runs with `debug: true`,
 * which this lab's harness does. The drive context carries the pointer verbs
 * but no snapshot reader, so a scenario addressing a node by id reads the
 * snapshot from the global.
 */
function inspector(): Inspector {
  const found = (window as unknown as { __yage__?: { inspector: Inspector } })
    .__yage__?.inspector;
  if (!found)
    throw new Error("the harness runs the engine without debug: true");
  return found;
}

/** The first node of `type` in the scene's user-interface snapshot. */
function findUINode(type: string): UINodeSnapshot {
  const visit = (node: UINodeSnapshot): UINodeSnapshot | undefined => {
    if (node.type === type) return node;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  for (const scene of inspector().snapshot().scenes) {
    const found = scene.ui ? visit(scene.ui.root) : undefined;
    if (found) return found;
  }
  throw new Error(`no ${type} in the user-interface snapshot`);
}

export default defineScenario({
  describe:
    "A HUD button driven by real pointer events, which `input` cannot reach.",

  setup(scene) {
    const hud = scene.spawn("hud", { key: "hud" });
    const orders = hud.add(new BuildOrders());
    const surface = hud.add(
      new UISurface({
        anchor: Anchor.TopLeft,
        offset: { x: BUTTON_X, y: BUTTON_Y },
        width: BUTTON_WIDTH,
        height: BUTTON_HEIGHT,
        background: { color: 0x1f2937, alpha: 1, radius: 8 },
      }),
    );
    surface.button("Build", {
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      onClick: () => {
        orders.placed += 1;
      },
    });
  },

  async drive({ scene, pointer, step, expect }) {
    const hud = scene.findByKey("hud");
    if (!hud) throw new Error("the scenario spawned no hud");
    const orders = hud.get(BuildOrders);

    // The verbs need a drawn frame: the renderer roots its hit test at the
    // last object rendered.
    await step(1);

    // Addressing the button by its snapshot id, so a layout change moves the
    // click with it. The click lands on the centre of the node's `bounds`.
    const hit = pointer.click(findUINode("UIButton").id);

    // The label is a node of its own and sits on top of the button, so the
    // innermost node hit is the label and the button is further along.
    expect(hit.path.some((node) => node.type === "UIButton")).toBe(true);
    expect(hit.consumed).toBe(true);
    // No frame between the click and this read: delivery is synchronous.
    expect(orders.placed).toBe(1);

    // Clear of the HUD: nothing to hit, and the button stays untouched.
    const miss = pointer.click({ x: 400, y: 300 });
    expect(miss.path).toEqual([]);
    expect(orders.placed).toBe(1);
  },
});

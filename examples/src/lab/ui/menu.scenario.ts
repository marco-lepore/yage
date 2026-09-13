import { Component } from "@yagejs/core";
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

    const centre = {
      x: BUTTON_X + BUTTON_WIDTH / 2,
      y: BUTTON_Y + BUTTON_HEIGHT / 2,
    };
    const hit = pointer.click(centre);

    // The label sits on top of the button, so the button is a link in the
    // chain rather than the innermost hit.
    expect(hit.path.some((node) => node.type === "UIButton")).toBe(true);
    expect(hit.consumed).toBe(true);
    // No frame between the click and this read: delivery is synchronous.
    expect(orders.placed).toBe(1);

    // Clear of the HUD: nothing to hit, and the button stays untouched.
    const miss = pointer.click({ x: 400, y: 300 });
    expect(miss.nodeId).toBe(null);
    expect(orders.placed).toBe(1);
  },
});

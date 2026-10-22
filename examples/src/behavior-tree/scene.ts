import { Scene } from "@yagejs/core";
import type { LayerDef } from "@yagejs/renderer";
import { HUD_LAYER, LANE_Y } from "./constants.js";
import { DemonstrationEntity } from "./demonstration.js";
import { GuardEntity } from "./guard.js";
import { GuardPanelEntity } from "./hud.js";
import { GateEntity, LaneEntity } from "./level.js";

// ---------------------------------------------------------------------------
// BehaviorScene
// ---------------------------------------------------------------------------

export class BehaviorScene extends Scene {
  readonly name = "behavior-tree";
  readonly layers: readonly LayerDef[] = [
    { name: "world", order: 0 },
    { name: HUD_LAYER, order: 1000, space: "screen" },
  ];

  // The scene only assembles the lanes. Rules live in components: each
  // guard's tree decides, its gate reacts to strikes, its panel reports.
  onEnter(): void {
    const [firstY, secondY] = LANE_Y;
    // Lanes first: entities on one layer draw in spawn order.
    for (const y of LANE_Y) this.spawn(LaneEntity, { y });
    const first = this.spawn(
      GuardEntity,
      { lane: "Guard A", x: 570, y: firstY },
      { key: "guard-a" },
    );
    const second = this.spawn(
      GuardEntity,
      { lane: "Guard B", x: 180, y: secondY },
      { key: "guard-b" },
    );
    for (const [guard, y] of [
      [first, firstY],
      [second, secondY],
    ] as const) {
      this.spawn(GateEntity, { y, guard });
      this.spawn(GuardPanelEntity, { y: y - 115, guard });
    }
    this.spawn(DemonstrationEntity, { first, second });
  }
}

import { Component } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import {
  LedgeProbe,
  type LedgeContact,
  type PlatformerCharacter,
} from "@yagejs-addons/character-controller/platformer";

/** Example-owned climb sequencing over the addon's ledge and motion primitives. */
export class LedgeClimb extends Component {
  // Submit before the default controller and its final motion reconciliation.
  static override updatePriority = -1;
  private readonly input = this.service(InputManagerKey);
  private contact: LedgeContact | undefined;
  private phase: "hang" | "raised" | "stand" = "hang";
  available = false;
  climbs = 0;
  get active(): boolean {
    return this.contact !== undefined;
  }

  constructor(
    private readonly character: PlatformerCharacter,
    private readonly probe: LedgeProbe,
  ) {
    super();
  }

  fixedUpdate(dt: number): void {
    if (dt <= 0) return;
    const { body, controller, moves, motion, stance } = this.character;
    const candidate =
      !controller.grounded && !stance.crouched
        ? this.probe.find(controller.facing)
        : undefined;
    this.available = candidate !== undefined;
    if (!this.input.isPressed("ledge") || stance.crouched) {
      this.contact = undefined;
      return;
    }
    if (!this.contact && candidate) {
      this.contact = candidate;
      this.phase = "hang";
      moves.cancel();
    }
    const contact = this.contact;
    if (!contact) return;
    if (!contact.entity.isActive) {
      this.contact = undefined;
      return;
    }
    const from = body.position;
    const target = this.probe.points(contact, dt)[this.phase];
    const dx = target.x - from.x,
      dy = target.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.2) {
      if (this.phase === "stand") {
        this.contact = undefined;
        this.climbs++;
      } else this.phase = this.phase === "hang" ? "raised" : "stand";
    }
    const fraction = distance > 0 ? Math.min(1, (180 * dt) / distance) : 0;
    const to = { x: from.x + dx * fraction, y: from.y + dy * fraction };
    if (!this.probe.clearStep(from, to, contact, dt)) {
      this.contact = undefined;
      return;
    }
    for (const axis of ["x", "y"] as const) {
      motion.submit({
        source: "example:ledge-climb",
        axis,
        target: (to[axis] - from[axis]) / dt,
        acceleration: Infinity,
        priority: 20,
      });
    }
  }
}

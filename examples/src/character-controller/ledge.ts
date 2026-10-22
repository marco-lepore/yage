import { Component, ProcessComponent, type ProcessSlot } from "@yagejs/core";
import {
  type LedgeContact,
  type LedgeProbe,
  type PlatformerCharacter,
} from "@yagejs-addons/character-controller";

/** Speed of the body between the hang, raised, and standing points, px/s. */
const CLIMB_SPEED = 180;
/** How long after letting go a ledge cannot be caught again, seconds. */
const REGRAB_DELAY = 0.25;
/** Outranks the character's own moves, which submit at priority 10. */
const PRIORITY = 20;

type Phase = "hang" | "raised" | "stand";

/**
 * The example's ledge move, built on the addon's `LedgeProbe`. Falling past
 * a ledge while holding toward it catches the ledge and hangs from it. Jump
 * climbs up, down lets go. The probe finds the ledge and checks that the
 * climb is clear; this component decides when to catch and moves the body.
 */
export class LedgeClimb extends Component {
  private readonly processes = this.sibling(ProcessComponent);
  private regrab!: ProcessSlot;
  private contact: LedgeContact | undefined;
  private phase: Phase = "hang";

  constructor(
    private readonly character: PlatformerCharacter,
    private readonly probe: LedgeProbe,
  ) {
    super();
  }

  onAdd(): void {
    this.regrab = this.processes.slot({
      duration: REGRAB_DELAY,
      clock: "fixed",
    });
  }

  /** Whether the body is hanging from or climbing a ledge. */
  get active(): boolean {
    return this.contact !== undefined;
  }

  get hanging(): boolean {
    return this.active && this.phase === "hang";
  }

  fixedUpdate(dt: number): void {
    if (dt === 0) return;
    const contact = this.contact ?? this.catch();
    if (!contact) return;
    if (!contact.entity.isActive) {
      this.letGo();
      return;
    }
    const { body, controller, moves, motion } = this.character;
    if (this.phase === "hang" && controller.down) {
      this.regrab.restart();
      this.letGo();
      return;
    }

    const from = body.position;
    const target = this.probe.points(contact, dt)[this.phase];
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.2) {
      if (this.phase === "stand") {
        this.letGo();
        return;
      }
      if (this.phase === "raised") this.phase = "stand";
      // A jump press from any input device climbs. The standard moves are
      // blocked while hanging, so the press waits in their buffer.
      else if (moves.consumeJumpPress()) this.phase = "raised";
    }
    const fraction =
      distance > 0 ? Math.min(1, (CLIMB_SPEED * dt) / distance) : 0;
    const to = { x: from.x + dx * fraction, y: from.y + dy * fraction };
    if (!this.probe.clearStep(from, to, contact, dt)) {
      this.letGo();
      return;
    }
    for (const axis of ["x", "y"] as const) {
      motion.submit({
        source: "example:ledge-climb",
        axis,
        target: (to[axis] - from[axis]) / dt,
        acceleration: Infinity,
        priority: PRIORITY,
      });
    }
  }

  /** Catches a ledge on the held side while falling, and stops the character's own moves. */
  private catch(): LedgeContact | undefined {
    const { controller, stance, motion, moves } = this.character;
    if (
      controller.grounded ||
      stance.crouched ||
      motion.velocityY < 0 ||
      controller.direction === 0 ||
      this.regrab.running
    )
      return undefined;
    this.contact = this.probe.find(controller.direction > 0 ? 1 : -1);
    if (this.contact) {
      this.phase = "hang";
      moves.cancel();
    }
    return this.contact;
  }

  private letGo(): void {
    this.contact = undefined;
  }
}

import { Component } from "@yagejs/core";
import type { ProcessComponent, ProcessSlot, Vec2 } from "@yagejs/core";
import type { BehaviorExit } from "@yagejs-addons/behavior-tree";
import { GuardStruck } from "./constants.js";

export type GuardPhase =
  | "idle"
  | "approach"
  | "react"
  | "attack"
  | "recover"
  | "retreat"
  | "rest";

// ---------------------------------------------------------------------------
// GuardState — one guard's game state and the commands that change it
// ---------------------------------------------------------------------------

/** Game state stays on this component; the tree reads it and calls its methods. */
export class GuardState extends Component {
  health = 100;
  phase: GuardPhase = "idle";
  attacks = 0;
  heavyAttacks = 0;
  calls = 0;
  tactic: "normal" | "heavy" = "normal";
  interruptions = 0;
  lastInterruption = "none";
  readonly attack: ProcessSlot;
  readonly recovery: ProcessSlot;
  /** Running while the latest call for help is shown. */
  readonly shout: ProcessSlot;

  constructor(
    readonly lane: string,
    readonly target: Vec2,
    readonly home: Vec2,
    processes: ProcessComponent,
  ) {
    super();
    this.attack = processes.slot({ clock: "fixed", duration: 1.4 });
    this.recovery = processes.slot({ clock: "fixed", duration: 0.8 });
    this.shout = processes.slot({ clock: "fixed", duration: 0.4 });
  }

  damage(): void {
    this.health = 20;
  }

  heal(): void {
    this.health = 100;
  }

  setPhase(phase: GuardPhase): void {
    this.phase = phase;
  }

  prepareAttack(tactic: "normal" | "heavy"): void {
    this.phase = "attack";
    this.tactic = tactic;
    this.attack.restart({ duration: tactic === "heavy" ? 2 : 1.4 });
  }

  strike(): void {
    this.attacks++;
    if (this.tactic === "heavy") this.heavyAttacks++;
    this.entity.emit(GuardStruck, { heavy: this.tactic === "heavy" });
  }

  callForHelp(): void {
    this.calls++;
    this.shout.restart();
  }

  /** Every action reports how it ended; cancellations count as interruptions. */
  finishAction(action: string, result: BehaviorExit): void {
    if (result.status !== "cancelled") return;
    this.interruptions++;
    this.lastInterruption = `${action}: ${result.reason}`;
  }
}

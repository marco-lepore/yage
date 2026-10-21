import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { SteeringAgent } from "@yagejs-addons/steering";
import { BehaviorTreeAgent } from "@yagejs-addons/behavior-tree";
import type { BehaviorExit } from "@yagejs-addons/behavior-tree";
import { guardBehavior, type GuardContext } from "./behavior.js";
import { GuardStruck, HOME_X, STRIKE_X } from "./constants.js";

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

// ---------------------------------------------------------------------------
// GuardView — the guard's body and the label above it
// ---------------------------------------------------------------------------

class GuardView extends Component {
  private readonly state = this.sibling(GuardState);
  private readonly body = this.sibling(GraphicsComponent);
  private color = -1;
  private caption = "";

  constructor(private readonly label: TextComponent) {
    super();
  }

  update(): void {
    const color =
      this.state.health < 30
        ? 0xfb7185
        : this.state.phase === "attack"
          ? 0xfbbf24
          : 0x38bdf8;
    if (color !== this.color) {
      this.color = color;
      this.body.draw((g) => {
        g.circle(0, 0, 16).fill({ color });
        g.circle(5, -4, 3).fill({ color: 0x0f172a });
      });
    }
    const caption = this.state.shout.running
      ? "HELP!"
      : this.state.phase.toUpperCase();
    if (caption !== this.caption) {
      this.caption = caption;
      this.label.setText(caption);
    }
  }
}

// ---------------------------------------------------------------------------
// GuardEntity
// ---------------------------------------------------------------------------

/** A guard that attacks the gate at the end of its lane and retreats when hurt. */
export class GuardEntity extends Entity {
  state!: GuardState;
  brain!: BehaviorTreeAgent<GuardContext>;

  setup(params: { lane: string; x: number; y: number }): void {
    const position = this.add(
      new Transform({ position: new Vec2(params.x, params.y) }),
    );
    const processes = this.add(new ProcessComponent());
    const movement = this.add(
      new SteeringAgent({ maxSpeed: 140, maxAcceleration: Infinity }),
    );
    this.state = this.add(
      new GuardState(
        params.lane,
        new Vec2(STRIKE_X, params.y),
        new Vec2(HOME_X, params.y),
        processes,
      ),
    );
    // Each guard gets its own agent and context over the shared definition.
    this.brain = this.add(
      new BehaviorTreeAgent(guardBehavior, {
        read: () => this.state,
        commands: this.state,
        movement,
        position,
        attack: this.state.attack,
        recovery: this.state.recovery,
      }),
    );
    this.add(new GraphicsComponent());
    const labelHost = this.spawnChild("phase");
    labelHost.add(new Transform({ position: new Vec2(0, -36) }));
    const label = labelHost.add(
      new TextComponent({
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "monospace", fontSize: 13, fill: 0xffffff },
      }),
    );
    this.add(new GuardView(label));
  }
}

import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  defineEvent,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { arrive, SteeringAgent } from "@yagejs-addons/steering";
import {
  BehaviorTree,
  BehaviorTreeAgent,
  behaviorNodes,
} from "@yagejs-addons/behavior-tree";
import type { BehaviorExit } from "@yagejs-addons/behavior-tree";

export const GuardAttack = defineEvent<{ lane: string }>("guard:attack");

/** Game state stays on this component; the tree receives its reference. */
export class GuardState extends Component {
  health = 100;
  phase = "idle";
  attacks = 0;
  interruptions = 0;
  lastInterruption = "none";
  readonly attack: ProcessSlot;
  readonly recovery: ProcessSlot;

  constructor(
    readonly lane: string,
    readonly target: Vec2,
    readonly home: Vec2,
    readonly movement: SteeringAgent,
    readonly position: Transform,
    processes: ProcessComponent,
  ) {
    super();
    this.attack = processes.slot({ clock: "fixed", duration: 1.4 });
    this.recovery = processes.slot({ clock: "fixed", duration: 0.8 });
  }

  damage(): void {
    this.health = 20;
  }

  finishAction(phase: string, result: BehaviorExit): void {
    if (result.status === "cancelled") {
      this.interruptions++;
      this.lastInterruption = `${phase}: ${result.reason}`;
    }
  }

  strike(): void {
    this.attacks++;
    this.entity.emit(GuardAttack, { lane: this.lane });
  }
}

const bt = behaviorNodes<GuardState>();

function travel(id: string, destination: (guard: GuardState) => Vec2) {
  return bt.action(id, (guard) => ({
    enter: () => {
      guard.phase = id;
      guard.movement.setBehaviors([
        arrive(destination(guard), { slowRadius: 40, arriveRadius: 3 }),
      ]);
    },
    tick: () =>
      guard.position.position.distance(destination(guard)) < 4
        ? "success"
        : "running",
    exit: (result) => {
      guard.movement.setBehaviors([]);
      guard.movement.stop();
      guard.finishAction(id, result);
    },
  }));
}

const attackCycle = bt.sequence("attack-cycle", [
  travel("approach", (guard) => guard.target),
  bt.action("attack", (guard) => ({
    enter: () => {
      guard.phase = "attack";
      guard.attack.restart();
    },
    tick: () => {
      if (guard.attack.running) return "running";
      guard.strike();
      return "success";
    },
    exit: (result) => {
      guard.attack.cancel();
      guard.finishAction("attack", result);
    },
  })),
  bt.action("recover", (guard) => ({
    enter: () => {
      guard.phase = "recover";
      guard.recovery.restart();
    },
    tick: () => (guard.recovery.running ? "running" : "success"),
    exit: (result) => {
      guard.recovery.cancel();
      guard.finishAction("recover", result);
    },
  })),
]);

/** One immutable definition used by every GuardEntity. */
const guardBehavior = bt.selector(
  "guard",
  [
    bt.guard(
      "low-health",
      (guard) => guard.health < 30,
      bt.sequence("safety", [
        travel("retreat", (guard) => guard.home),
        bt.action("rest", (guard) => ({
          tick: () => {
            guard.phase = "rest";
            return "success";
          },
        })),
        bt.wait("heal-delay", 2),
        bt.action("heal", (guard) => ({
          tick: () => {
            guard.health = 100;
            return "success";
          },
        })),
      ]),
    ),
    bt.subtree("combat", attackCycle),
  ],
  { reactive: true },
);

class GuardView extends Component {
  private color = -1;
  private phase = "";
  private summary = "";
  constructor(
    private readonly state: GuardState,
    private readonly visual: GraphicsComponent,
    private readonly label: TextComponent,
    private readonly panel: TextComponent,
  ) {
    super();
  }

  update(): void {
    const state = this.state;
    const color =
      state.health < 30
        ? 0xfb7185
        : state.phase === "attack"
          ? 0xfbbf24
          : 0x38bdf8;
    if (color !== this.color) {
      this.color = color;
      this.visual.draw((g) => {
        g.circle(0, 0, 16).fill({ color });
        g.circle(5, -4, 3).fill({ color: 0x0f172a });
      });
    }
    if (state.phase !== this.phase) {
      this.phase = state.phase;
      this.label.setText(state.phase.toUpperCase());
    }
    const summary = `${state.lane}   HP ${state.health}   attacks ${state.attacks}\nInterrupted ${state.interruptions} · ${state.lastInterruption}`;
    if (summary !== this.summary) {
      this.summary = summary;
      this.panel.setText(summary);
    }
  }
}

export class GuardEntity extends Entity {
  state!: GuardState;
  brain!: BehaviorTreeAgent<GuardState>;

  setup(params: {
    lane: string;
    x: number;
    y: number;
    panel: TextComponent;
  }): void {
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
        new Vec2(660, params.y),
        new Vec2(100, params.y),
        movement,
        position,
        processes,
      ),
    );
    this.brain = this.add(
      new BehaviorTreeAgent(new BehaviorTree(guardBehavior, this.state)),
    );
    const visual = this.add(new GraphicsComponent());
    const labelHost = this.spawnChild("phase");
    labelHost.add(new Transform({ position: new Vec2(0, -36) }));
    const label = labelHost.add(
      new TextComponent({
        text: "",
        anchor: { x: 0.5, y: 0.5 },
        style: { fontFamily: "monospace", fontSize: 13, fill: 0xffffff },
      }),
    );
    this.add(new GuardView(this.state, visual, label, params.panel));
  }
}

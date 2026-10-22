import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
} from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { SteeringAgent } from "@yagejs-addons/steering";
import { BehaviorTreeAgent } from "@yagejs-addons/behavior-tree";
import { guardBehavior, type GuardContext } from "./behavior.js";
import { HOME_X, STRIKE_X } from "./constants.js";
import { GuardState } from "./state.js";

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

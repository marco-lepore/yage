import { Component, Entity, ProcessComponent, Sequence } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import type { GuardEntity } from "./guard.js";

// ---------------------------------------------------------------------------
// Demonstration — scripted damage at the start, then keyboard control
// ---------------------------------------------------------------------------

class Demonstration extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly processes = this.sibling(ProcessComponent);

  constructor(
    private readonly first: GuardEntity,
    private readonly second: GuardEntity,
  ) {
    super();
  }

  onAdd(): void {
    // Hurt A while it attacks and B while it approaches, so both kinds of
    // interruption show without input.
    this.processes.run(
      new Sequence()
        .wait(1.8)
        .call(() => this.first.state.damage())
        .wait(1)
        .call(() => this.second.state.damage())
        .build(),
    );
  }

  update(): void {
    if (this.input.isJustPressed("hurt-first")) this.first.state.damage();
    if (this.input.isJustPressed("hurt-second")) this.second.state.damage();
    // Disabling the agent cancels the running action; enabling it again
    // starts the tree from the root. Cooldowns keep their remaining time.
    if (this.input.isJustPressed("toggle-first"))
      this.first.brain.enabled = !this.first.brain.enabled;
  }
}

export class DemonstrationEntity extends Entity {
  setup(params: { first: GuardEntity; second: GuardEntity }): void {
    this.add(new ProcessComponent());
    this.add(new Demonstration(params.first, params.second));
  }
}

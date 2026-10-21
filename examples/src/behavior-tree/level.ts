import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { GATE_X, GuardStruck, HOME_X } from "./constants.js";
import type { GuardEntity } from "./guard.js";

// ---------------------------------------------------------------------------
// LaneEntity — one guard's track, with its home circle
// ---------------------------------------------------------------------------

export class LaneEntity extends Entity {
  setup(params: { y: number }): void {
    this.add(new Transform({ position: new Vec2(0, params.y) }));
    this.add(
      new GraphicsComponent().draw((g) => {
        g.roundRect(55, -45, 690, 90, 12).fill({ color: 0x1e293b });
        g.circle(HOME_X, 0, 26).stroke({ color: 0x4ade80, width: 2 });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// GateEntity — the target at the end of a lane; flashes when struck
// ---------------------------------------------------------------------------

class GateFlash extends Component {
  private readonly body = this.sibling(GraphicsComponent);
  private flash!: ProcessSlot;
  private heavy = false;
  private drawn = "";

  constructor(private readonly guard: GuardEntity) {
    super();
  }

  onAdd(): void {
    this.flash = this.sibling(ProcessComponent).slot({ duration: 0.25 });
    // The guard emits on itself; this gate listens to its own guard only.
    this.listen(this.guard, GuardStruck, ({ heavy }) => {
      this.heavy = heavy;
      this.flash.restart();
    });
  }

  update(): void {
    const look = !this.flash.running ? "idle" : this.heavy ? "heavy" : "hit";
    if (look === this.drawn) return;
    this.drawn = look;
    const color =
      look === "idle" ? 0x64748b : look === "heavy" ? 0xf97316 : 0xfde68a;
    this.body.draw((g) => {
      g.rect(-10, -22, 20, 44).fill({ color });
    });
  }
}

export class GateEntity extends Entity {
  setup(params: { y: number; guard: GuardEntity }): void {
    this.add(new Transform({ position: new Vec2(GATE_X, params.y) }));
    this.add(new ProcessComponent());
    this.add(new GraphicsComponent());
    this.add(new GateFlash(params.guard));
  }
}

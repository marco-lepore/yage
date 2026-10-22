import {
  Component,
  Entity,
  ProcessComponent,
  Sequence,
  Transform,
  Vec2,
} from "@yagejs/core";
import type { ProcessSlot } from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import {
  DummyStrike,
  FLOOR_Y,
  Notice,
  STRIKE_DAMAGE,
  STRIKE_PERIOD,
  TARGET_X,
  WORLD_LAYER,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Dummy — counts hits, flashes when struck, and hits the player back
// ---------------------------------------------------------------------------

export class Dummy extends Component {
  hits = 0;
  damageTaken = 0;
  private readonly art: GraphicsComponent;
  private flash!: ProcessSlot;
  /** Where the last hit came from, relative to the dummy. */
  private from = new Vec2(0, 0);
  private lit = false;

  constructor(art: GraphicsComponent) {
    super();
    this.art = art;
  }

  onAdd(): void {
    const processes = this.entity.get(ProcessComponent);
    this.flash = processes.slot({ duration: 0.2 });
    processes.run(
      new Sequence()
        .wait(STRIKE_PERIOD)
        .call(() => this.strike())
        .loop()
        .build(),
    );
    this.draw();
  }

  /** Called by the player's ability steps. */
  hit(damage: number, source: Vec2): void {
    this.hits += 1;
    this.damageTaken += damage;
    this.from = source.sub(this.entity.get(Transform).position);
    this.flash.restart();
    this.draw();
    this.entity.emit(Notice, `Target hit for ${damage}`);
  }

  update(): void {
    if (this.lit !== this.flash.running) this.draw();
  }

  private strike(): void {
    this.entity.emit(DummyStrike, STRIKE_DAMAGE);
    this.entity.emit(Notice, `The dummy strikes back for ${STRIKE_DAMAGE}`);
  }

  private draw(): void {
    this.lit = this.flash.running;
    this.art.draw((g) => {
      g.clear();
      g.circle(0, 0, 40)
        .fill(this.lit ? 0x66e3c4 : 0x38516d)
        .stroke({ color: 0x8da8c7, width: 3 });
      g.circle(0, 0, 16).stroke({ color: 0xe4efff, width: 3 });
      if (this.lit)
        g.moveTo(this.from.x, this.from.y)
          .lineTo(0, 0)
          .stroke({ color: 0x66e3c4, width: 6 });
    });
  }
}

// ---------------------------------------------------------------------------
// TargetEntity
// ---------------------------------------------------------------------------

export class TargetEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(TARGET_X, FLOOR_Y - 40) }));
    this.add(new ProcessComponent());
    const art = this.add(new GraphicsComponent({ layer: WORLD_LAYER }));
    this.add(new Dummy(art));
  }
}

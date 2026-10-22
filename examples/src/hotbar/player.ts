import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
} from "@yagejs/core";
import { GraphicsComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import { Abilities, defineStep } from "@yagejs-addons/abilities";
import type { AbilityDef } from "@yagejs-addons/abilities";
import { Inventory } from "@yagejs-addons/inventory";
import {
  Hotbar,
  HotbarController,
  hotbarAbility,
  hotbarControls,
  hotbarItem,
} from "@yagejs-addons/hotbar";
import type {
  HotbarActionResult,
  HotbarControls,
  HotbarSnapshot,
} from "@yagejs-addons/hotbar";
import { HotbarView } from "@yagejs-addons/hotbar/presenters";
import {
  BEAM_FULL_CHARGE,
  DummyStrike,
  FLOOR_Y,
  ITEMS,
  MAX_HEALTH,
  MAX_POTIONS,
  Notice,
  PLAYER_MAX_X,
  PLAYER_MIN_X,
  PLAYER_START_X,
  POTION_HEAL,
  RESTOCK_POTIONS,
  START_HEALTH,
  TARGET_KEY,
  WALK_SPEED,
  WORLD_LAYER,
} from "./constants.js";
import type { BarAction } from "./constants.js";
import { Dummy } from "./target.js";

// ---------------------------------------------------------------------------
// Abilities — a tap ability with a cooldown and a hold-to-charge ability
// ---------------------------------------------------------------------------

/** Hits the dummy. `perChargeSecond` adds damage for each second spent in the `charge` phase. */
const strikeTarget = defineStep<{ damage: number; perChargeSecond?: number }>(
  "hotbar-demo/strike",
  {
    fire: (params, ctx) => {
      const charged = Math.min(
        BEAM_FULL_CHARGE,
        ctx.activation.elapsedIn("charge"),
      );
      const damage = Math.round(
        params.damage + (params.perChargeSecond ?? 0) * charged,
      );
      const source = ctx.entity.get(Transform).position.add(new Vec2(0, -20));
      ctx.entity.scene.findByKey(TARGET_KEY)?.get(Dummy).hit(damage, source);
    },
  },
);

const ZAP: AbilityDef = {
  id: "zap",
  duration: 0.3,
  cooldown: 2,
  timeline: [strikeTarget({ at: 0, damage: 15 })],
};

/** Holding the slot's key stays in `charge`; letting go moves to `fire`. */
const BEAM: AbilityDef = {
  id: "beam",
  cooldown: 3,
  phases: {
    charge: { hold: { max: 3 }, next: "fire", timeline: [] },
    fire: {
      duration: 0.3,
      timeline: [strikeTarget({ at: 0, damage: 10, perChargeSecond: 30 })],
    },
  },
};

// ---------------------------------------------------------------------------
// Vitals — the player's health
// ---------------------------------------------------------------------------

export class Vitals extends Component {
  health = START_HEALTH;

  get full(): boolean {
    return this.health >= MAX_HEALTH;
  }

  onAdd(): void {
    this.listenScene(DummyStrike, (damage) => this.hurt(damage));
  }

  heal(amount: number): void {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }

  hurt(amount: number): void {
    this.health = Math.max(0, this.health - amount);
  }
}

// ---------------------------------------------------------------------------
// Backpack — the bag and what its items do
// ---------------------------------------------------------------------------

export class Backpack extends Component {
  readonly bag: Inventory<"potion">;
  private readonly vitals: Vitals;

  constructor(vitals: Vitals) {
    super();
    this.vitals = vitals;
    this.bag = new Inventory({
      catalog: ITEMS,
      capacity: 1,
      // A potion offers "drink" only while the player is hurt.
      actions: [
        {
          id: "drink",
          label: "Drink",
          consumes: true,
          available: () => !vitals.full,
        },
      ],
    });
    this.bag.add("potion", RESTOCK_POTIONS);
  }

  get potions(): number {
    return this.bag.count("potion");
  }

  onAdd(): void {
    // The inventory removes the potion; the game applies its effect.
    this.addCleanup(
      this.bag.on("action", (event) => {
        if (event.actionId === "drink") this.vitals.heal(POTION_HEAL);
      }),
    );
  }

  restock(): HotbarActionResult {
    const result = this.bag.add("potion", RESTOCK_POTIONS);
    return result.added > 0 ? { ok: true } : { ok: false, reason: "bag full" };
  }
}

// ---------------------------------------------------------------------------
// Walker — A/D movement. The hotbar view stays on screen while the player
// that owns it moves.
// ---------------------------------------------------------------------------

export class Walker extends Component {
  private readonly input = this.service(InputManagerKey);

  update(dt: number): void {
    const direction =
      Number(this.input.isPressed("walk-right")) -
      Number(this.input.isPressed("walk-left"));
    if (direction === 0) return;
    const transform = this.entity.get(Transform);
    const x = Math.min(
      PLAYER_MAX_X,
      Math.max(
        PLAYER_MIN_X,
        transform.position.x + direction * WALK_SPEED * dt,
      ),
    );
    transform.setPosition(x, transform.position.y);
  }
}

// ---------------------------------------------------------------------------
// PlayerBody — draws the player and the beam's charge ring
// ---------------------------------------------------------------------------

export class PlayerBody extends Component {
  private readonly art: GraphicsComponent;
  private abilities!: Abilities;
  private charge = -1;

  constructor(art: GraphicsComponent) {
    super();
    this.art = art;
  }

  onAdd(): void {
    this.abilities = this.entity.get(Abilities);
  }

  update(): void {
    const run = this.abilities.active();
    const charge =
      run?.def.id === "beam" && run.isHolding
        ? Math.min(1, run.phaseElapsed / BEAM_FULL_CHARGE)
        : 0;
    if (charge === this.charge) return;
    this.charge = charge;
    this.art.draw((g) => {
      g.clear();
      g.roundRect(-18, -40, 36, 40, 6).fill(0xe4efff);
      if (charge > 0)
        g.circle(0, -20, 28 + 12 * charge).stroke({
          color: 0x66e3c4,
          width: 2 + 4 * charge,
        });
    });
  }
}

// ---------------------------------------------------------------------------
// LayoutKeys — game-side assignment, edit mode, save and restore
// ---------------------------------------------------------------------------

/**
 * P puts the next action into the selected slot, the way an ability book or
 * inventory screen would. E switches edit mode, where dragging between slots
 * swaps them; outside it, a pointer press holds a slot like its key. S saves
 * the layout; L restores it.
 */
export class LayoutKeys extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly bar: Hotbar<BarAction>;
  private readonly controls: HotbarControls;
  private saved: HotbarSnapshot | undefined;

  constructor(bar: Hotbar<BarAction>, controls: HotbarControls) {
    super();
    this.bar = bar;
    this.controls = controls;
  }

  get editing(): boolean {
    return this.controls.dragToSwap;
  }

  update(): void {
    const bar = this.bar;
    if (this.input.isJustPressed("edit-mode")) {
      this.controls.setDragToSwap(!this.editing);
      this.notify(
        this.editing
          ? "Edit mode: drag between slots to swap them"
          : "Play mode: press or hold a slot to use it",
      );
    }
    if (this.input.isJustPressed("next-action")) {
      const ids = bar.bindingIds;
      const current = bar.snapshot().slots[bar.selection] ?? null;
      const index = current === null ? -1 : ids.indexOf(current);
      const next = ids[(index + 1) % ids.length];
      if (next !== undefined) {
        bar.assign(bar.selection, next);
        this.notify(`Slot ${bar.selection + 1} now holds ${next}`);
      }
    }
    if (this.input.isJustPressed("save-layout")) {
      this.saved = bar.snapshot();
      this.notify("Layout saved");
    }
    if (this.input.isJustPressed("load-layout")) {
      if (!this.saved) this.notify("Nothing saved yet");
      else {
        bar.restore(this.saved);
        this.notify("Layout restored");
      }
    }
  }

  private notify(message: string): void {
    this.entity.emit(Notice, message);
  }
}

// ---------------------------------------------------------------------------
// PlayerEntity — owns the abilities, the bag and the hotbar over both
// ---------------------------------------------------------------------------

export class PlayerEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(PLAYER_START_X, FLOOR_Y) }));
    this.add(new ProcessComponent());
    const art = this.add(new GraphicsComponent({ layer: WORLD_LAYER }));
    const abilities = this.add(new Abilities([ZAP, BEAM]));
    const vitals = this.add(new Vitals());
    const backpack = this.add(new Backpack(vitals));
    this.add(new Walker());
    this.add(new PlayerBody(art));

    const bar = new Hotbar({
      slotCount: 5,
      slots: ["zap", "beam", "potion", "restock"],
      bindings: {
        zap: hotbarAbility(abilities, "zap", { label: "Zap" }),
        beam: hotbarAbility(abilities, "beam", { label: "Beam (hold)" }),
        potion: hotbarItem(backpack.bag, "potion", { action: "drink" }),
        restock: {
          label: "Restock",
          read: () => ({
            available: backpack.potions < MAX_POTIONS,
            reason: "bag full",
          }),
          activate: () => backpack.restock(),
        },
      },
    });
    // Kept to switch drag-to-swap in edit mode.
    const controls = hotbarControls();
    this.add(
      new HotbarController({
        model: bar,
        presenter: new HotbarView({ slotWidth: 130 }),
        input: controls,
      }),
    );
    this.add(new LayoutKeys(bar, controls));
  }
}

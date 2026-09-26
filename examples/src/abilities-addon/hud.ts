import { Component, Entity, Transform, Vec2 } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import type { TextComponentOptions } from "@yagejs/renderer";
import {
  Abilities,
  Health,
  HealthDamaged,
  HealthDied,
  HealthHealed,
  HitGuarded,
} from "@yagejs-addons/abilities";
import { HEIGHT, HUD_LAYER, PLAYER_KEY, WIDTH } from "./constants.js";
import { statsOf } from "./stats.js";
import { PlayerController } from "./player.js";
import { GUARD_HOLD_ID } from "./player-abilities.js";

/** One line of HUD text as a child entity of `parent`, on the screen-space
 *  HUD layer. `position` is relative to the parent's Transform, or in screen
 *  pixels when the parent has none. */
function spawnHudText(
  parent: Entity,
  name: string,
  position: Vec2,
  options: TextComponentOptions,
): TextComponent {
  const child = parent.spawnChild(name);
  child.add(new Transform({ position }));
  return child.add(new TextComponent({ ...options, layer: HUD_LAYER }));
}

// ---------------------------------------------------------------------------
// Death banner
// ---------------------------------------------------------------------------

/** Shows the banner texts when the player dies. */
export class DeadBanner extends Component {
  constructor(private readonly texts: readonly TextComponent[]) {
    super();
  }

  onAdd(): void {
    this.listenScene(HealthDied, (_data, entity) => {
      if (!entity?.tags.has("player")) return;
      for (const text of this.texts) text.visible = true;
    });
  }
}

/** The centered "You Died" banner, hidden until the player dies. An R reset
 *  rebuilds the scene, so every run starts with the banner hidden. */
export class DeadBannerEntity extends Entity {
  setup(): void {
    const title = spawnHudText(
      this,
      "dead-banner",
      new Vec2(WIDTH / 2, HEIGHT / 2 - 12),
      {
        text: "You Died",
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 30,
          fill: 0xef4444,
          fontWeight: "bold",
        },
        visible: false,
      },
    );
    const hint = spawnHudText(
      this,
      "dead-banner-sub",
      new Vec2(WIDTH / 2, HEIGHT / 2 + 18),
      {
        text: "Press R to try again",
        anchor: { x: 0.5, y: 0.5 },
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fill: 0x94a3b8,
        },
        visible: false,
      },
    );
    this.add(new DeadBanner([title, hint]));
  }
}

// ---------------------------------------------------------------------------
// Combat log — a scene-wide listener on the addon's own events, so the HUD
// never pokes at component internals to know what happened.
// ---------------------------------------------------------------------------

export function label(entity: Entity): string {
  return entity.tags.has("player") ? "Player" : "Enemy";
}

export class CombatLog extends Component {
  private lines: string[] = [];

  onAdd(): void {
    this.listenScene(HealthDamaged, ({ amount }, entity) => {
      if (entity) this.push(`${label(entity)} took ${amount} dmg`);
    });
    this.listenScene(HealthHealed, ({ amount }, entity) => {
      if (entity) this.push(`${label(entity)} healed ${amount}`);
    });
    this.listenScene(HealthDied, (_data, entity) => {
      if (entity) this.push(`${label(entity)} died`);
    });
    this.listenScene(HitGuarded, ({ outcome }, entity) => {
      if (entity) this.push(`${label(entity)} ${outcome} an attack`);
    });
  }

  private push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > 3) this.lines.shift();
  }

  get text(): string {
    return this.lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export class Hud extends Component {
  private readonly log: CombatLog;
  private readonly text: TextComponent;

  constructor(text: TextComponent, log: CombatLog) {
    super();
    this.text = text;
    this.log = log;
  }

  update(): void {
    const player = this.scene.findByKey(PLAYER_KEY);
    const health = player?.tryGet(Health);
    const controller = player?.tryGet(PlayerController);
    const stats = player && statsOf(player);
    const statsLine = stats
      ? `LVL ${stats.level} · ATK ${stats.atk} · DEF ${stats.def} · SPD ${stats.atkSpeed.toFixed(2)}x · kills ${stats.kills}`
      : "";
    this.text.setText(
      [
        `HP ${health ? Math.ceil(health.hp) : 0} / ${health?.max ?? 0}`,
        `LOADOUT ${controller?.loadoutName ?? "—"} · ${statsLine}`,
        "WASD/arrows move · Space tap combo / hold charge · E swap FISTS/KICKS ·",
        "Shift tap dash / hold run · F hold block / tap parry · Q potion ·",
        "gems boost stats · H hitbox debug · R reset",
        "",
        this.log.text,
      ].join("\n"),
    );
  }
}

/** The status text in the top-left corner: HP, loadout, stats, controls and
 *  the combat log. */
export class HudEntity extends Entity {
  setup(): void {
    const log = this.add(new CombatLog());
    // The e2e tests read this text by its entity name, "hud".
    const text = spawnHudText(this, "hud", new Vec2(16, 16), {
      text: "",
      style: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        fill: 0xe2e8f0,
        lineHeight: 18,
      },
    });
    this.add(new Hud(text, log));
  }
}

// ---------------------------------------------------------------------------
// Hotbar — a bottom-center row of 4 slots (loadout attack+charge, dash/run,
// guard, potion), each a rounded square with a key label, an ability name,
// and a clock-wipe: a semi-opaque pie overlay that shrinks via an arc sweep
// as the ability comes off cooldown, plus the remaining seconds as `X.X`
// text ("0.0" at ready).
// ---------------------------------------------------------------------------

export type HotbarKind = "attack" | "dash" | "guard" | "potion";

export interface HotbarSlotDef {
  kind: HotbarKind;
  key: string;
  name: string;
}

export const HOTBAR_SLOTS: readonly HotbarSlotDef[] = [
  { kind: "attack", key: "SPACE", name: "ATTACK" },
  { kind: "dash", key: "SHIFT", name: "DASH" },
  { kind: "guard", key: "F", name: "BLOCK" },
  { kind: "potion", key: "Q", name: "POTION" },
];

export const HOTBAR_SLOT_SIZE = 58;
export const HOTBAR_GAP = 10;
export const HOTBAR_RADIUS = HOTBAR_SLOT_SIZE / 2 - 4;

/** Ability id the hotbar polls cooldown for, keyed by slot kind (the
 *  "attack" slot is special-cased through `attackSlotState` instead — see
 *  `HotbarSlot.update`). The "guard" slot shows the hold-block's own
 *  cooldown — `GUARD_HOLD_ID`, not the literal kind string — since that's
 *  the actual gate on whether pressing the key does anything; the parry it
 *  can cancel into shares the same press and isn't shown separately. */
export const HOTBAR_COOLDOWN_ID: Record<
  Exclude<HotbarKind, "attack">,
  string
> = {
  dash: "dash",
  guard: GUARD_HOLD_ID,
  potion: "potion",
};

export class HotbarSlot extends Component {
  private readonly gfx = this.sibling(GraphicsComponent);
  private readonly kind: HotbarKind;
  private readonly countdown: TextComponent;

  constructor(kind: HotbarKind, countdown: TextComponent) {
    super();
    this.kind = kind;
    this.countdown = countdown;
  }

  update(): void {
    const player = this.scene.findByKey(PLAYER_KEY);
    const abilities = player?.tryGet(Abilities);
    const controller = player?.tryGet(PlayerController);
    if (!abilities || !controller) return;

    const { ratio, label } =
      this.kind === "attack"
        ? controller.attackSlotState()
        : {
            ratio: abilities.cooldownRatio(HOTBAR_COOLDOWN_ID[this.kind]),
            label: abilities
              .cooldownRemaining(HOTBAR_COOLDOWN_ID[this.kind])
              .toFixed(1),
          };

    this.redraw(ratio);
    this.countdown.setText(label);
  }

  private redraw(ratio: number): void {
    const r = HOTBAR_RADIUS;
    this.gfx.graphics
      .clear()
      .roundRect(-r - 4, -r - 4, (r + 4) * 2, (r + 4) * 2, 10)
      .fill({ color: 0x0f172a, alpha: 0.88 })
      .stroke({ color: 0x334155, width: 1.5 });
    if (ratio < 1) {
      const angle = (1 - ratio) * Math.PI * 2;
      this.gfx.graphics
        .moveTo(0, 0)
        .arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + angle)
        .lineTo(0, 0)
        .fill({ color: 0x000000, alpha: 0.62 });
    }
  }
}

/** One hotbar slot: the panel with its cooldown wipe, the key and ability
 *  name above center, and the `X.X` countdown below it. */
export class HotbarSlotEntity extends Entity {
  setup(params: { def: HotbarSlotDef; position: Vec2 }): void {
    const { def } = params;
    this.add(new Transform({ position: params.position }));
    // Added before the texts: a layer draws in the order visuals join it, so
    // the panel stays behind the label and the countdown.
    this.add(new GraphicsComponent({ layer: HUD_LAYER }));
    spawnHudText(this, `hotbar-${def.kind}-label`, new Vec2(0, -15), {
      text: `${def.key}\n${def.name}`,
      style: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 8,
        fill: 0x94a3b8,
        align: "center",
        lineHeight: 9,
      },
      anchor: { x: 0.5, y: 0.5 },
    });
    // The e2e tests read the countdown by its entity name,
    // `hotbar-<kind>-time`.
    const countdown = spawnHudText(
      this,
      `hotbar-${def.kind}-time`,
      new Vec2(0, 7),
      {
        text: "0.0",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          fontWeight: "bold",
          fill: 0xf8fafc,
          align: "center",
        },
        anchor: { x: 0.5, y: 0.5 },
      },
    );
    this.add(new HotbarSlot(def.kind, countdown));
  }
}

/** The bottom-center hotbar: one `HotbarSlotEntity` child per
 *  `HOTBAR_SLOTS` entry. */
export class HotbarEntity extends Entity {
  setup(): void {
    const totalWidth =
      HOTBAR_SLOTS.length * HOTBAR_SLOT_SIZE +
      (HOTBAR_SLOTS.length - 1) * HOTBAR_GAP;
    const startX = WIDTH / 2 - totalWidth / 2 + HOTBAR_SLOT_SIZE / 2;
    const y = HEIGHT - 44;
    HOTBAR_SLOTS.forEach((def, i) => {
      this.spawnChild(`hotbar-${def.kind}`, HotbarSlotEntity, {
        def,
        position: new Vec2(startX + i * (HOTBAR_SLOT_SIZE + HOTBAR_GAP), y),
      });
    });
  }
}

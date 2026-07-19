import { Component, Transform, Vec2 } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import {
  Abilities,
  Health,
  HealthDamaged,
  HealthDied,
  HealthHealed,
  HitGuarded,
} from "@yagejs-addons/abilities";
import { HEIGHT, HUD_LAYER, WIDTH } from "./constants.js";
import { statsOf } from "./stats.js";
import { PlayerController } from "./player.js";
import { GUARD_HOLD_ID } from "./player-abilities.js";
import { createOverlay } from "../shared/win-overlay.js";

export const deadBanner = createOverlay({
  title: "You Died",
  subtitle: "Reload to try again",
  accent: "#ef4444",
  subtitleColor: "#94a3b8",
});

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
    const player = this.scene.findEntity("PlayerEntity");
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
export const HOTBAR_COOLDOWN_ID: Record<Exclude<HotbarKind, "attack">, string> = {
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
    const player = this.scene.findEntity("PlayerEntity");
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

export function spawnHotbar(scene: Scene): void {
  const totalWidth =
    HOTBAR_SLOTS.length * HOTBAR_SLOT_SIZE +
    (HOTBAR_SLOTS.length - 1) * HOTBAR_GAP;
  const startX = WIDTH / 2 - totalWidth / 2 + HOTBAR_SLOT_SIZE / 2;
  const y = HEIGHT - 44;

  HOTBAR_SLOTS.forEach((def, i) => {
    const x = startX + i * (HOTBAR_SLOT_SIZE + HOTBAR_GAP);

    const countdownEntity = scene.spawn(`hotbar-${def.kind}-time`);
    countdownEntity.add(new Transform({ position: new Vec2(x, y + 7) }));
    const countdown = countdownEntity.add(
      new TextComponent({
        text: "0.0",
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          fontWeight: "bold",
          fill: 0xf8fafc,
          align: "center",
        },
        anchor: { x: 0.5, y: 0.5 },
        layer: HUD_LAYER,
      }),
    );

    const labelEntity = scene.spawn(`hotbar-${def.kind}-label`);
    labelEntity.add(new Transform({ position: new Vec2(x, y - 15) }));
    labelEntity.add(
      new TextComponent({
        text: `${def.key}\n${def.name}`,
        style: {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 8,
          fill: 0x94a3b8,
          align: "center",
          lineHeight: 9,
        },
        anchor: { x: 0.5, y: 0.5 },
        layer: HUD_LAYER,
      }),
    );

    const slotEntity = scene.spawn(`hotbar-${def.kind}`);
    slotEntity.add(new Transform({ position: new Vec2(x, y) }));
    slotEntity.add(new GraphicsComponent({ layer: HUD_LAYER }));
    slotEntity.add(new HotbarSlot(def.kind, countdown));
  });
}

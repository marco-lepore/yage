import { Scene, Transform, Vec2 } from "@yagejs/core";
import {
  CameraEntity,
  GraphicsComponent,
  TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import type { DialogueScript } from "@yagejs-addons/dialogue";
import {
  defaultDialogueTheme,
  type DialogueTheme,
} from "@yagejs-addons/dialogue/presenters";
import {
  WIDTH,
  HEIGHT,
  WORLD_WIDTH,
  GATE_X,
  ROOM_LAYER,
  LAYERS,
  PLAYER_KEY,
  DIALOGUE_KEY,
} from "./constants.js";
import {
  CAPTAIN,
  MIRA,
  QUARTERMASTER,
  LOCKSMITH,
  MERCHANT,
  ROOK,
  GUARD,
  SAGE,
  GOSSIP,
} from "./scripts.js";
import { PlayerEntity, NpcEntity, GateEntity } from "./town.js";
import { HudEntity } from "./hud.js";
import { DialogueHostEntity, GossipEntity } from "./dialogue.js";
import { VOICE } from "./channels.js";

// ── scene ────────────────────────────────────────────────────────────────────

export class RoomScene extends Scene {
  readonly name = "dialogue-addon";
  readonly layers = LAYERS;
  /** Preload Sage's voice clips so `audio.play` resolves them synchronously. */
  readonly preload = Object.values(VOICE);

  /** `themeBuild` picks the look (cycled by the Theme button); `bitmapFont` (the
   *  Font button) layers a baked atlas on top. Both rebuild the scene. */
  constructor(
    private readonly themeBuild: () => DialogueTheme = defaultDialogueTheme,
    private readonly bitmapFont?: string,
  ) {
    super();
  }

  // The scene only assembles the town. The rules live in components: the
  // player stops itself while busy, NPCs start their own conversations, and
  // the dialogue host bridges the scripts into the purse and the gate.
  onEnter(): void {
    const theme = this.theme();
    this.drawTown();

    const player = this.spawn(PlayerEntity, { key: PLAYER_KEY });
    // Follow camera, clamped to the world so it never shows past the edges.
    const camera = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
      follow: player.get(Transform),
      smoothing: 0.14,
      bounds: { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: HEIGHT },
    });
    this.use(InputManagerKey).setCamera(camera);

    const { gate } = this.spawn(GateEntity);
    const { purse } = this.spawn(HudEntity);
    this.spawn(
      DialogueHostEntity,
      { theme, camera, purse, gate },
      { key: DIALOGUE_KEY },
    );
    // Ann & Bert chat on their own when you get close.
    this.spawn(GossipEntity, {
      theme,
      script: GOSSIP,
      x: 1145,
      y: 310,
      radius: 120,
    });
    this.spawnTownsfolk();
  }

  onExit(): void {
    this.use(InputManagerKey).clearCamera();
  }

  /** The Theme button's preset, with the Font button's bitmap font on top. */
  private theme(): DialogueTheme {
    const base = this.themeBuild();
    return this.bitmapFont !== undefined
      ? { ...base, bitmapFont: this.bitmapFont, textSize: 14, lineHeight: 19 }
      : base;
  }

  /** Left to right. Sage, Ann and Bert have speaker ids, so their lines float
   *  in bubbles; everyone else talks in the box. */
  private spawnTownsfolk(): void {
    const talker = (
      x: number,
      color: number,
      name: string,
      label: string,
      script: DialogueScript,
    ): void => {
      this.spawn(NpcEntity, {
        x,
        y: 215,
        color,
        name,
        talk: { label, script },
      });
    };
    talker(200, 0x86c5ff, "Vow", "Captain Vow (F)", CAPTAIN);
    talker(320, 0xffd866, "Mira", "Talk to Mira (F)", MIRA);
    talker(
      520,
      0x9ad17e,
      "Quinn",
      "Talk to the Quartermaster (F)",
      QUARTERMASTER,
    );
    talker(640, 0xffb86b, "Pip", "Talk to Pip the Locksmith (F)", LOCKSMITH);
    talker(760, 0xe6a3ff, "Vex", "Trade with Vex (F)", MERCHANT);
    talker(1040, 0xff6b6b, "Rook", "Talk to Rook (F)", ROOK);
    talker(GATE_X - 70, 0xff9a6b, "Bron", "Talk to the Guard (F)", GUARD);

    // Sage (bubble) on his own bench.
    this.spawn(NpcEntity, {
      x: 980,
      y: 300,
      color: 0x7ec8ff,
      name: "Sage",
      speaker: "sage",
      talk: { label: "Talk to Sage (F)", script: SAGE },
    });
    // The gossiping pair (see GossipEntity).
    this.spawn(NpcEntity, {
      x: 1110,
      y: 300,
      color: 0xf5a168,
      name: "Ann",
      speaker: "ann",
    });
    this.spawn(NpcEntity, {
      x: 1180,
      y: 300,
      color: 0xaaaaaa,
      name: "Bert",
      speaker: "bert",
    });
  }

  /** A long floor that scrolls under the camera, plus a brighter "vault" patch
   *  past the gate as the payoff for unlocking it. */
  private drawTown(): void {
    const floor = this.spawn("room");
    floor.add(new Transform());
    floor.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(24, 70, WORLD_WIDTH - 48, 320, 12)
          .fill({ color: 0x16181f })
          .stroke({ color: 0x33384a, width: 2 });
        // The vault, east of the gate.
        g.roundRect(GATE_X + 30, 80, WORLD_WIDTH - GATE_X - 70, 300, 10).fill({
          color: 0x1d2233,
        });
        for (let x = 24; x <= WORLD_WIDTH - 24; x += 48) {
          g.moveTo(x, 70).lineTo(x, 390);
        }
        for (let y = 70; y <= 390; y += 48) {
          g.moveTo(24, y).lineTo(WORLD_WIDTH - 24, y);
        }
        g.stroke({ color: 0x222634, width: 1, alpha: 0.6 });
      }),
    );

    // A little "VAULT" sparkle beyond the gate, with its label as a child.
    const vault = this.spawn("vault");
    vault.add(new Transform({ position: new Vec2(WORLD_WIDTH - 110, 225) }));
    vault.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-26, -18, 52, 36, 5)
          .fill({ color: 0xcaa24a })
          .stroke({ color: 0xffe08a, width: 2 });
        g.rect(-26, -4, 52, 4).fill({ color: 0x7a5e22 });
      }),
    );
    const tag = vault.spawnChild("tag");
    tag.add(new Transform({ position: new Vec2(0, -30) }));
    tag.add(
      new TextComponent({
        text: "The Vault",
        style: { fontSize: 12, fill: 0xffe08a, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

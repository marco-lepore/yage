import { Component, Entity, MathUtils, Transform, Vec2 } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import type { DialogueScript } from "@yagejs-addons/dialogue";
import { DialogueActor } from "@yagejs-addons/dialogue/presenters";
import {
  PLAYER_SPEED,
  TALK_RADIUS,
  GATE_X,
  WALK_BOUNDS,
  OPEN_GATE_MAX_X,
  BUBBLE_LAYER,
  ROOM_LAYER,
  PLAYER_KEY,
  DIALOGUE_KEY,
  GateOpened,
} from "./constants.js";
import type { DialogueHostEntity } from "./dialogue.js";

// ── world entities (all Graphics, no assets) ─────────────────────────────────

/** WASD/arrow movement inside the walkable area. The player stands still while
 *  a conversation owns the input or the town is paused; overhearing the gossip
 *  doesn't stop them. */
export class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private maxX: number = WALK_BOUNDS.maxX;

  onAdd(): void {
    // The gate emits GateOpened on itself; the event bubbles to the scene.
    this.listenScene(GateOpened, () => {
      this.maxX = OPEN_GATE_MAX_X;
    });
  }

  update(dt: number): void {
    if (this.scene.findByKey<DialogueHostEntity>(DIALOGUE_KEY)?.busy) return;
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, WALK_BOUNDS.minX, this.maxX),
      MathUtils.clamp(
        p.y + (dy / len) * step,
        WALK_BOUNDS.minY,
        WALK_BOUNDS.maxY,
      ),
    );
  }
}

/** The player: a green dot, and the "you" speaker for bubble lines. Spawn it
 *  with `{ key: PLAYER_KEY }`. */
export class PlayerEntity extends Entity {
  setup(): void {
    this.add(new Transform({ position: new Vec2(140, 300) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.circle(0, 0, 13).fill({ color: 0x6be08a });
        g.circle(0, 0, 13).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
      }),
    );
    this.add(new DialogueActor({ speaker: "you", anchor: { x: 0, y: -20 } }));
    this.add(new PlayerMover());
  }
}

/** Shows an NPC's "(F)" prompt while the player stands close and isn't busy,
 *  and starts the NPC's conversation when they press F. */
export class TalkPrompt extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);
  private near = false;

  constructor(
    private readonly prompt: TextComponent,
    private readonly script: DialogueScript,
  ) {
    super();
  }

  update(): void {
    const dialogue = this.scene.findByKey<DialogueHostEntity>(DIALOGUE_KEY);
    const player = this.scene.findByKey<PlayerEntity>(PLAYER_KEY);
    if (!dialogue || !player) return;
    const near =
      !dialogue.busy &&
      this.transform.position.distance(player.get(Transform).position) <=
        TALK_RADIUS;
    if (near !== this.near) {
      this.near = near;
      this.prompt.visible = near;
    }
    if (near && this.input.isJustPressed("interact")) {
      dialogue.controller.play(this.script);
    }
  }
}

export interface NpcParams {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  /** Shown on the tag under the dot. */
  readonly name: string;
  /** Registers a `DialogueActor`, so this speaker's lines float in a bubble
   *  above the NPC. */
  readonly speaker?: string;
  /** For an NPC the player can talk to: the prompt text and the script. */
  readonly talk?: { readonly label: string; readonly script: DialogueScript };
}

/** A coloured dot with a name tag, so the wide town stays legible. */
export class NpcEntity extends Entity {
  setup({ x, y, color, name, speaker, talk }: NpcParams): void {
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.circle(0, 0, 16).fill({ color });
        g.circle(0, 0, 16).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
      }),
    );
    // Child positions are relative to the NPC.
    const tag = this.spawnChild("tag");
    tag.add(new Transform({ position: new Vec2(0, 26) }));
    tag.add(
      new TextComponent({
        text: name,
        style: { fontSize: 11, fill: color, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    if (speaker !== undefined) {
      this.add(new DialogueActor({ speaker, anchor: { x: 0, y: -22 } }));
    }
    if (talk) {
      const prompt = this.spawnChild("prompt");
      prompt.add(new Transform({ position: new Vec2(0, -40) }));
      const text = prompt.add(
        new TextComponent({
          text: talk.label,
          style: { fontSize: 12, fill: 0xffffff, fontFamily: "sans-serif" },
          layer: BUBBLE_LAYER,
          anchor: { x: 0.5, y: 0.5 },
          visible: false,
        }),
      );
      this.add(new TalkPrompt(text, talk.script));
    }
  }
}

/** The locked gate. `open()` redraws it ajar and emits `GateOpened`, which
 *  lets the player walk on to the vault. The `open-gate` command calls it. */
export class Gate extends Component {
  private readonly graphics = this.sibling(GraphicsComponent);
  private opened = false;

  onAdd(): void {
    this.redraw();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.redraw();
    this.entity.emit(GateOpened);
  }

  private redraw(): void {
    this.graphics.draw((g) => {
      g.clear();
      if (this.opened) {
        // Two side posts with a clear gap to walk through.
        for (const x of [-26, 26]) {
          g.rect(x - 4, -135, 8, 270).fill({ color: 0x3a6b3a });
        }
        g.rect(-26, -138, 52, 6).fill({ color: 0x5fae5f });
      } else {
        // A barred red gate filling the walkable band.
        g.rect(-26, -135, 52, 270)
          .fill({ color: 0x5a2424, alpha: 0.92 })
          .stroke({
            color: 0xc05a5a,
            width: 2,
          });
        for (let y = -126; y < 135; y += 26) {
          g.rect(-26, y, 52, 4).fill({ color: 0x3a1414 });
        }
      }
    });
  }
}

export class GateEntity extends Entity {
  gate!: Gate;

  setup(): void {
    this.add(new Transform({ position: new Vec2(GATE_X, 225) }));
    this.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    this.gate = this.add(new Gate());
  }
}

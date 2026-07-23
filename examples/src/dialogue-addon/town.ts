import { Component, MathUtils, Transform, Vec2, type Entity, type Scene } from "@yagejs/core";
import { InputManagerKey } from "@yagejs/input";
import { GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { DialogueActor } from "@yagejs-addons/dialogue/presenters";
import { PLAYER_SPEED, BUBBLE_LAYER, ROOM_LAYER, type Bounds } from "./constants.js";

// ── world entities (all Graphics, no assets) ─────────────────────────────────

/** WASD/arrow movement, clamped to the (mutable) walkable bounds; idles while a
 *  conversation owns input (you can still walk while merely eavesdropping). */
export class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(
    private readonly bounds: Bounds,
    private readonly isBusy: () => boolean,
  ) {
    super();
  }

  update(dt: number): void {
    if (this.isBusy()) return;
    const dx = this.input.getAxis("move-left", "move-right");
    const dy = this.input.getAxis("move-up", "move-down");
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy) || 1;
    const step = PLAYER_SPEED * dt;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, this.bounds.minX, this.bounds.maxX),
      MathUtils.clamp(p.y + (dy / len) * step, this.bounds.minY, this.bounds.maxY),
    );
  }
}

/** Floating "press F" prompt + interact trigger when the player is in range. */
export class ProximityInteract extends Component {
  private readonly input = this.service(InputManagerKey);
  private prompt!: TextComponent;
  private near = false;

  constructor(
    private readonly cfg: {
      readonly label: string;
      readonly radius: number;
      readonly onInteract: () => void;
      readonly isBusy: () => boolean;
      readonly playerPos: () => Vec2;
    },
  ) {
    super();
  }

  onAdd(): void {
    const here = this.entity.get(Transform).position;
    const tip = this.scene.spawn("npc-prompt");
    tip.add(new Transform({ position: new Vec2(here.x, here.y - 40) }));
    this.prompt = tip.add(
      new TextComponent({
        text: this.cfg.label,
        style: { fontSize: 12, fill: 0xffffff, fontFamily: "sans-serif" },
        layer: BUBBLE_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.prompt.text.visible = false;
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    const pp = this.cfg.playerPos();
    const near =
      !this.cfg.isBusy() && Math.hypot(me.x - pp.x, me.y - pp.y) <= this.cfg.radius;
    if (near !== this.near) {
      this.near = near;
      this.prompt.text.visible = near;
    }
    if (near && this.input.isJustPressed("interact")) this.cfg.onInteract();
  }
}

/** Distance-gated zone: fires onEnter/onExit as the player crosses its radius. */
export class ProximityZone extends Component {
  private inside = false;

  constructor(
    private readonly cfg: {
      readonly radius: number;
      readonly onEnter: () => void;
      readonly onExit: () => void;
      readonly playerPos: () => Vec2;
    },
  ) {
    super();
  }

  update(): void {
    const me = this.entity.get(Transform).position;
    const pp = this.cfg.playerPos();
    const now = Math.hypot(me.x - pp.x, me.y - pp.y) <= this.cfg.radius;
    if (now && !this.inside) {
      this.inside = true;
      this.cfg.onEnter();
    } else if (!now && this.inside) {
      this.inside = false;
      this.cfg.onExit();
    }
  }
}

/** The locked gate. `open()` redraws it ajar and runs the supplied effect
 *  (extending the walkable bounds). The `open-gate` command calls it. */
export class Gate extends Component {
  private gfx!: GraphicsComponent;
  private opened = false;

  constructor(private readonly onOpen: () => void) {
    super();
  }

  onAdd(): void {
    this.gfx = this.sibling(GraphicsComponent);
    this.redraw();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.redraw();
    this.onOpen();
  }

  private redraw(): void {
    this.gfx.graphics.clear();
    this.gfx.draw((g) => {
      if (this.opened) {
        // Two side posts with a clear gap to walk through.
        for (const x of [-26, 26]) {
          g.rect(x - 4, -135, 8, 270).fill({ color: 0x3a6b3a });
        }
        g.rect(-26, -138, 52, 6).fill({ color: 0x5fae5f });
      } else {
        // A barred red gate filling the walkable band.
        g.rect(-26, -135, 52, 270).fill({ color: 0x5a2424, alpha: 0.92 }).stroke({
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

/** Spawn a coloured dot NPC (+ optional speaker actor for bubbles) with a name
 *  tag, so the wider town stays legible. */
export function spawnNpc(
  scene: Scene,
  opts: {
    readonly x: number;
    readonly y: number;
    readonly color: number;
    readonly name?: string;
    readonly speaker?: string;
  },
): Entity {
  const npc = scene.spawn("npc");
  npc.add(new Transform({ position: new Vec2(opts.x, opts.y) }));
  npc.add(
    new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
      g.circle(0, 0, 16).fill({ color: opts.color });
      g.circle(0, 0, 16).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
    }),
  );
  if (opts.name) {
    const tag = scene.spawn("npc-tag");
    tag.add(new Transform({ position: new Vec2(opts.x, opts.y + 26) }));
    tag.add(
      new TextComponent({
        text: opts.name,
        style: { fontSize: 11, fill: opts.color, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
  if (opts.speaker) {
    npc.add(new DialogueActor({ speaker: opts.speaker, anchor: { x: 0, y: -22 } }));
  }
  return npc;
}

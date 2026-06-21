/**
 * @yagejs-addons/dialogue — a walkable town that drives the game-state model.
 *
 * Zero bundled assets: the town, the player, and the NPCs are all Graphics; the
 * dialogue presenters are `defaultTheme()` (Graphics chrome + canvas text). The
 * level is wider than the canvas, so a **follow camera** scrolls as you walk.
 *
 * The interactive controller installs a `VariableStorage` ONCE, then every NPC's
 * `play(script)` is content-only and shares it:
 *
 *   • `storage`   — `compose(cells({ gold }), MemoryVariableStorage())`. `gold`
 *                   is a two-way `cells` accessor into the game's purse; declared
 *                   flags/counters (`paid`, `opened`, `timesTalked`) live in the
 *                   in-memory store and **persist across conversations**.
 *   • `functions` — `has_item("rusty-key")` (argument-capable reads for gates).
 *   • `commands`  — `give-gold` / `give-item` / `take-item` / `open-gate` (the
 *                   game decides what they do; rules-in / consequences-out).
 *
 * Walk up to an NPC and press F:
 *   • Mira (box)        — markup effects + a **cycling counter** (`timesTalked`
 *                         persists, so she greets you differently each visit).
 *   • Quartermaster     — pays a one-time stipend via `give-gold`, gated on a
 *                         declared `paid` flag (a second visit knows you're paid).
 *   • Vex the trader    — sells the rusty key for 50g: the buy option appears only
 *                         when an **expression condition** (`gold >= 50 and not
 *                         has_item("rusty-key")`) holds, then `set gold = gold - 50`
 *                         writes through the cell and `give-item` hands you the key.
 *   • Rook              — a **timed choice** (a recipe, not an engine feature):
 *                         decide within 5s or the host commits a default ("Freeze
 *                         up"). A `choice-timer` command arms a host-owned countdown
 *                         (ChoiceTimer) on the GAME clock — so P pauses it too.
 *   • Gate Guard        — opens the gate only with the key; the unlock option is
 *                         shown **disabled** ("needs the rusty key") until you hold
 *                         one. On unlock it spends the key (`take-item`) and runs
 *                         `open-gate` (a world consequence that extends the
 *                         walkable area).
 *   • Sage (bubble)     — a long line the speech bubble grows to fit.
 *   • Ann & Bert        — stand near them to **eavesdrop** an ambient gossip loop
 *                         (a second controller kept alive but input-disabled via
 *                         `setInputEnabled(false)` — the focus seam).
 *
 * The HUD shows your live gold + items. Hold **J** to fast-forward, hold **X** to
 * skip, press **V** to toggle auto-advance; the pointer works too. The three
 * lifecycle levers ride two keys: **P** pauses (the conversation freezes
 * intact behind a dim overlay — `setPaused`) and **H** hides the dialogue UI
 * mid-line, restoring it at the same reveal point (`setHidden`). The
 * **Font** button swaps every presenter to a baked bitmap font and back.
 *
 * Export split: runner / controller / events / input / the storage kit come from
 * the pixi-free root entry; presenters + theme come from `/presenters`.
 */

import {
  Engine,
  Scene,
  Component,
  MathUtils,
  Transform,
  Vec2,
  type Entity,
} from "@yagejs/core";
import {
  RendererPlugin,
  CameraEntity,
  GraphicsComponent,
  TextComponent,
  installBitmapFont,
  type LayerDef,
} from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueEndedEvent,
  cells,
  compose,
  fullControls,
  MemoryVariableStorage,
  type BinaryOp,
  type CommandHandler,
  type DialogueFunction,
  type DialogueScript,
  type Expr,
  type VariableStorage,
} from "@yagejs-addons/dialogue";
import {
  defaultTheme,
  createMixedDialogue,
  createBubbleDialogue,
  DialogueActor,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import { injectStyles, setupGameContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;
const WORLD_WIDTH = 1600; // wider than the canvas → the camera scrolls

const SKIP_HOLD_MS = 600; // hold X this long to confirm a skip
const AUTO_ADVANCE_MS = 1500; // delay between lines when auto-advance is on
const PLAYER_SPEED = 165; // px/sec

const KEY_PRICE = 50;
const GATE_X = 1410; // the locked gate; blocks progress until unlocked
const ROOK_TIMEOUT_MS = 5000; // Rook's timed choice: decide within 5s or freeze

/** World-space render layers (under the camera) + the screen-space HUD. The
 *  dialogue box rides DIALOGUE_LAYERS (screen); bubbles ride BUBBLE_LAYER. */
const ROOM_LAYER = "room";
const BUBBLE_LAYER = "dialogue-bubble";
const HUD_LAYER = "hud";
const LAYERS: LayerDef[] = [
  { name: ROOM_LAYER, order: 10, space: "world" },
  { name: BUBBLE_LAYER, order: 50, space: "world" },
  ...DIALOGUE_LAYERS,
  { name: HUD_LAYER, order: 1200, space: "screen" },
];

/** Mutable walkable area (world coords). `maxX` starts at the gate and extends
 *  when it opens; leaves headroom at the bottom for the dialogue box. */
interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ── shared game state (the "game" the dialogue bridges into) ──────────────────

/** The host owns this; the dialogue reads/writes it only through the storage
 *  cell (`gold`) and the command handlers (`inventory`). */
interface GameState {
  gold: number;
  readonly inventory: Set<string>;
}

// ── expression helpers (keep the JSON-able IR readable) ──────────────────────

const lit = (value: string | number | boolean): Expr => ({ kind: "literal", value });
const ref = (name: string): Expr => ({ kind: "varRef", name });
const call = (fn: string, ...args: Expr[]): Expr => ({ kind: "call", fn, args });
const bin = (op: BinaryOp, left: Expr, right: Expr): Expr => ({ kind: "binary", op, left, right });

// ── scripts (all content-only; storage/functions/commands live on the host) ───

/** Mira — markup effects + a persistent visit counter (cycling NPC). */
const MIRA: DialogueScript = {
  id: "mira",
  start: "n",
  declare: { timesTalked: 0 },
  speakers: { mira: { id: "mira", name: "Mira", color: 0xffd866 } },
  nodes: {
    n: {
      id: "n",
      steps: [
        // Count this visit, then branch on the (persisted) prior count.
        {
          kind: "command",
          commands: [{ type: "set", var: "timesTalked", value: bin("+", ref("timesTalked"), lit(1)) }],
        },
        { kind: "command", commands: [], condition: { var: "timesTalked", op: ">", value: 1 }, target: "again" },
        {
          kind: "say",
          speaker: "mira",
          text: "Welcome to town! This box can [wave]wave[/wave] and [shake]shout[/shake].",
        },
        {
          kind: "say",
          speaker: "mira",
          text: "Timing matters:[pause=400] this part is [speed=0.4]slow[/speed].",
        },
        { kind: "end" },
      ],
    },
    again: {
      id: "again",
      steps: [
        {
          kind: "say",
          speaker: "mira",
          text: "Back again? We've spoken [b]{timesTalked}[/b] times — the count [wave]persists[/wave].",
        },
        { kind: "end" },
      ],
    },
  },
};

/** Quartermaster — a one-time stipend via `give-gold`, gated on a declared flag. */
const QUARTERMASTER: DialogueScript = {
  id: "quartermaster",
  start: "n",
  declare: { paid: false },
  speakers: { quinn: { id: "quinn", name: "Quartermaster Quinn", color: 0x9ad17e } },
  nodes: {
    n: {
      id: "n",
      steps: [
        { kind: "command", commands: [], condition: "paid", target: "already" },
        { kind: "say", speaker: "quinn", text: "New recruit? Here's your stipend — 50 gold. Spend it well." },
        {
          kind: "command",
          commands: [
            { type: "give-gold", amount: 50 },
            { type: "set", var: "paid", value: true },
          ],
        },
        { kind: "say", speaker: "quinn", text: "You're carrying {gold} gold now. Vex sells a key you'll want." },
        { kind: "end" },
      ],
    },
    already: {
      id: "already",
      steps: [
        { kind: "say", speaker: "quinn", text: "I already paid you — {gold} gold should be plenty for a key." },
        { kind: "end" },
      ],
    },
  },
};

/** Vex — buys the rusty key for gold: an expression-gated option that writes
 *  through the two-way `gold` cell and hands over the item. */
const MERCHANT: DialogueScript = {
  id: "merchant",
  start: "n",
  speakers: { vex: { id: "vex", name: "Vex the Trader", color: 0xe6a3ff } },
  nodes: {
    n: {
      id: "n",
      steps: [
        { kind: "say", speaker: "vex", text: "A rusty key? Fifty gold. You've got [b]{gold}[/b]." },
        {
          kind: "choice",
          speaker: "vex",
          text: "Well?",
          options: [
            {
              text: "Buy the rusty key (50g)",
              target: "bought",
              // gold >= 50 AND you don't already own the key
              condition: bin(
                "and",
                bin(">=", ref("gold"), lit(KEY_PRICE)),
                { kind: "unary", op: "not", operand: call("has_item", lit("rusty-key")) },
              ),
              commands: [
                // The script owns the arithmetic; the cell writes it back to the game.
                { type: "set", var: "gold", value: bin("-", ref("gold"), lit(KEY_PRICE)) },
                { type: "give-item", id: "rusty-key" },
              ],
            },
            {
              text: "(You already hold the key)",
              target: "have",
              condition: call("has_item", lit("rusty-key")),
            },
            { text: "Maybe later", target: "bye" },
          ],
        },
      ],
    },
    bought: {
      id: "bought",
      steps: [
        { kind: "say", speaker: "vex", text: "Pleasure doing business — {gold} gold left. The gate's east of here." },
        { kind: "end" },
      ],
    },
    have: {
      id: "have",
      steps: [{ kind: "say", speaker: "vex", text: "You've got it already. Go find that gate." }, { kind: "end" }],
    },
    bye: {
      id: "bye",
      steps: [
        { kind: "say", speaker: "vex", text: "Gold talks. Come back when you have fifty." },
        { kind: "end" },
      ],
    },
  },
};

/** Bron — opens the gate only with the key (a function gate), spends it, and
 *  fires a world-consequence command. */
const GUARD: DialogueScript = {
  id: "guard",
  start: "n",
  declare: { opened: false },
  speakers: { bron: { id: "bron", name: "Gate Guard Bron", color: 0xff9a6b } },
  nodes: {
    n: {
      id: "n",
      steps: [
        { kind: "command", commands: [], condition: "opened", target: "thanks" },
        { kind: "say", speaker: "bron", text: "This gate's locked. Got a key?" },
        {
          kind: "choice",
          speaker: "bron",
          options: [
            {
              text: "Unlock it with the rusty key",
              target: "open",
              condition: call("has_item", lit("rusty-key")),
              // Show the gate greyed-out before you own the key (Disco-Elysium
              // style), so the player learns what's needed instead of seeing it
              // vanish. "Not yet" stays enabled, so the step never soft-locks.
              presentation: "disabled",
              disabledReason: "needs the rusty key",
            },
            { text: "Not yet", target: "bye" },
          ],
        },
      ],
    },
    open: {
      id: "open",
      steps: [
        { kind: "say", speaker: "bron", text: "That's the one. Stand back…" },
        {
          kind: "command",
          commands: [
            { type: "take-item", id: "rusty-key" },
            { type: "open-gate" },
            { type: "set", var: "opened", value: true },
          ],
        },
        { kind: "say", speaker: "bron", text: "Gate's open. The vault's all yours." },
        { kind: "end" },
      ],
    },
    thanks: {
      id: "thanks",
      steps: [{ kind: "say", speaker: "bron", text: "Gate's already open, friend. Mind the step." }, { kind: "end" }],
    },
    bye: {
      id: "bye",
      steps: [{ kind: "say", speaker: "bron", text: "No key, no passage." }, { kind: "end" }],
    },
  },
};

/** Rook — a TIMED choice (a recipe, not an engine feature). A non-blocking
 *  `choice-timer` command before it arms a host-owned countdown; stall too long
 *  and the host commits the default ("Freeze up", index 1) via `controller.choose`. The
 *  countdown rides the game clock (see {@link ChoiceTimer}), so pausing the
 *  conversation must also pause the timer — the example gates it on the pause
 *  flag. `meta.timeoutMs` rides through to the presenter for a custom countdown. */
const ROOK: DialogueScript = {
  id: "rook",
  start: "n",
  speakers: { rook: { id: "rook", name: "Rook", color: 0xff6b6b } },
  nodes: {
    n: {
      id: "n",
      steps: [
        { kind: "say", speaker: "rook", text: "The guard's rounding the corner. Run or bluff — [b]fast[/b]!" },
        // Non-blocking command BEFORE the choice: it just arms the host timer.
        { kind: "command", commands: [{ type: "choice-timer", ms: ROOK_TIMEOUT_MS, default: 1 }] },
        {
          kind: "choice",
          speaker: "rook",
          text: "Well?",
          meta: { timeoutMs: ROOK_TIMEOUT_MS },
          options: [
            { text: "Bluff it out", target: "bluff" },
            { text: "Freeze up", target: "freeze" }, // index 1 — the timeout default
          ],
        },
      ],
    },
    bluff: {
      id: "bluff",
      steps: [{ kind: "say", speaker: "rook", text: "Ha — smooth. The guard waved us right through." }, { kind: "end" }],
    },
    freeze: {
      id: "freeze",
      steps: [{ kind: "say", speaker: "rook", text: "…You froze. We got lucky the guard was bored." }, { kind: "end" }],
    },
  },
};

const SAGE: DialogueScript = {
  id: "sage",
  start: "intro",
  speakers: { sage: { id: "sage", name: "Sage", color: 0x7ec8ff } },
  nodes: {
    intro: {
      id: "intro",
      steps: [
        {
          kind: "say",
          speaker: "sage",
          view: "bubble",
          text: "Down here I speak from a bubble — and it grows to fit however much I ramble, instead of clipping my words at a fixed size.",
        },
        {
          kind: "say",
          speaker: "sage",
          view: "bubble",
          text: "Hold [b]X[/b] to skip me, or press [b]V[/b] to let me talk on my own.",
        },
        { kind: "end" },
      ],
    },
  },
};

/** Ambient gossip — loops forever, each line auto-advancing, no input binding. */
const GOSSIP: DialogueScript = {
  id: "gossip",
  start: "a",
  speakers: {
    ann: { id: "ann", name: "Ann", color: 0xf5a168 },
    bert: { id: "bert", name: "Bert", color: 0xaaaaaa },
  },
  nodes: {
    a: {
      id: "a",
      steps: [
        {
          kind: "say",
          speaker: "ann",
          view: "bubble",
          text: "…and then the goblin tripped over its own feet!",
          autoAdvanceMs: 1600,
        },
        {
          kind: "say",
          speaker: "bert",
          view: "bubble",
          text: "No! In front of the whole guild?",
          autoAdvanceMs: 1500,
        },
        {
          kind: "say",
          speaker: "ann",
          view: "bubble",
          text: "Face first. I nearly dropped my mug.",
          autoAdvanceMs: 1600,
        },
        { kind: "goto", target: "a" },
      ],
    },
  },
};

// ── world entities (all Graphics, no assets) ─────────────────────────────────

/** WASD/arrow movement, clamped to the (mutable) walkable bounds; idles while a
 *  conversation owns input (you can still walk while merely eavesdropping). */
class PlayerMover extends Component {
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
    const step = (PLAYER_SPEED * dt) / 1000;
    const p = this.transform.position;
    this.transform.setPosition(
      MathUtils.clamp(p.x + (dx / len) * step, this.bounds.minX, this.bounds.maxX),
      MathUtils.clamp(p.y + (dy / len) * step, this.bounds.minY, this.bounds.maxY),
    );
  }
}

/** Floating "press F" prompt + interact trigger when the player is in range. */
class ProximityInteract extends Component {
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
class ProximityZone extends Component {
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
class Gate extends Component {
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
function spawnNpc(
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

// ── HUD (screen space): hint, live gold + items, auto toggle, ff/skip ring ────

class Hud extends Component {
  private readonly input = this.service(InputManagerKey);
  private auto = false;
  private autoLabel!: TextComponent;
  private status!: TextComponent;
  private lastStatus = "";
  private meter!: GraphicsComponent;
  /** Last-drawn meter state — redraw only on change (idle frames skip the
   *  Graphics clear+refill entirely). */
  private meterFf = false;
  private meterSkipHeld = false;
  private meterSkipT = -1;

  /** Set by the scene once the controller exists (toggled by the V key). */
  onAutoToggle?: (on: boolean) => void;

  constructor(
    private readonly getGold: () => number,
    private readonly getItems: () => readonly string[],
  ) {
    super();
  }

  onAdd(): void {
    this.spawnText(
      12,
      12,
      "WASD move · F talk · hold J fast · hold X skip · V auto · P pause · H hide",
      13,
      0xb8b8c0,
      { x: 0, y: 0 },
    );
    this.status = this.spawnText(12, 34, this.statusText(), 14, 0xffe08a, { x: 0, y: 0 });
    this.autoLabel = this.spawnText(WIDTH - 12, 12, this.autoText(), 13, 0x8888aa, { x: 1, y: 0 });

    const meterEntity = this.scene.spawn("hud-meter");
    meterEntity.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 28) }));
    this.meter = meterEntity.add(new GraphicsComponent({ layer: HUD_LAYER }));
  }

  update(): void {
    // Live gold + items — redraw only when the text actually changes.
    const next = this.statusText();
    if (next !== this.lastStatus) {
      this.lastStatus = next;
      this.status.setText(next);
    }

    if (this.input.isJustPressed("auto")) {
      this.auto = !this.auto;
      this.onAutoToggle?.(this.auto);
      this.autoLabel.setText(this.autoText());
    }

    // Bottom-centre meter: fast-forward glyph while J held; skip ring while X held.
    const ff = this.input.isPressed("attack");
    const skipHeld = this.input.isPressed("skip");
    const skipT = MathUtils.clamp(this.input.getHoldDuration("skip") / SKIP_HOLD_MS, 0, 1);
    if (ff === this.meterFf && skipHeld === this.meterSkipHeld && skipT === this.meterSkipT) {
      return;
    }
    this.meterFf = ff;
    this.meterSkipHeld = skipHeld;
    this.meterSkipT = skipT;
    this.meter.graphics.clear(); // redrawn on change — don't accumulate
    this.meter.draw((g) => {
      if (ff) {
        g.poly([-9, -7, 0, 0, -9, 7]).fill({ color: 0xffffff, alpha: 0.9 });
        g.poly([1, -7, 10, 0, 1, 7]).fill({ color: 0xffffff, alpha: 0.9 });
      }
      if (skipHeld) {
        g.circle(0, 0, 13).stroke({ color: 0x333355, width: 3 });
        g.arc(0, 0, 13, -Math.PI / 2, -Math.PI / 2 + skipT * Math.PI * 2).stroke({
          color: skipT >= 1 ? 0x8ce06b : 0xffd866,
          width: 3,
        });
      }
    });
  }

  private statusText(): string {
    const items = this.getItems();
    const bag = items.length > 0 ? items.join(", ") : "(empty)";
    return `Gold: ${this.getGold()}    Items: ${bag}`;
  }

  private autoText(): string {
    return this.auto ? "AUTO ▶ ON" : "AUTO ❙❙ OFF";
  }

  private spawnText(
    x: number,
    y: number,
    text: string,
    size: number,
    fill: number,
    anchor: { x: number; y: number },
  ): TextComponent {
    const e = this.scene.spawn("hud-text");
    e.add(new Transform({ position: new Vec2(x, y) }));
    return e.add(
      new TextComponent({
        text,
        style: { fontSize: size, fill, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor,
      }),
    );
  }
}

// ── Inspector probe (keeps the example harness-clean for smoke tests) ─────────

class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoice(text: string): void {
    this.lastChoice = text;
  }

  serialize(): { lastLine: string; lineCount: number; lastChoice: string } {
    return { lastLine: this.lastLine, lineCount: this.lineCount, lastChoice: this.lastChoice };
  }
}

// ── Lifecycle levers on two keys (both persist across plays) ───────────────────

/**
 * P / H drive two of the three orthogonal lifecycle levers (the third —
 * `setInputEnabled` — focuses the ambient gossip below):
 *   • **P → `setPaused`** — freezes every conversation (typewriter, auto-advance,
 *     caret, input) behind a dim overlay with no state loss; press again to
 *     resume exactly where it left off. `lifecycle.paused` freezes the player
 *     too, so the whole world reads as paused.
 *   • **H → `setHidden`** — hides the dialogue UI mid-line and brings it back
 *     with its reveal progress intact (the bubble + caret, never an empty box).
 *     Gated to an active conversation so an idle press can't strand a
 *     later line hidden.
 */
class LifecycleControls extends Component {
  private readonly input = this.service(InputManagerKey);
  private overlay!: GraphicsComponent;
  private banner!: TextComponent;

  constructor(
    private readonly controllers: readonly DialogueController[],
    private readonly lifecycle: { paused: boolean; hidden: boolean },
  ) {
    super();
  }

  onAdd(): void {
    // Screen-space dim + PAUSED banner on the top HUD layer (above the dialogue
    // box), hidden until P. Toggled via `.visible` — DisplaySystem doesn't sync it.
    const dim = this.scene.spawn("pause-overlay");
    dim.add(new Transform());
    this.overlay = dim.add(
      new GraphicsComponent({ layer: HUD_LAYER }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x05060a, alpha: 0.55 });
      }),
    );
    this.overlay.graphics.visible = false;

    const banner = this.scene.spawn("pause-banner");
    banner.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT / 2) }));
    this.banner = banner.add(
      new TextComponent({
        text: "❙❙ PAUSED",
        style: { fontSize: 34, fill: 0xffe08a, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.banner.text.visible = false;
  }

  update(): void {
    if (this.input.isJustPressed("pause")) {
      this.lifecycle.paused = !this.lifecycle.paused;
      for (const c of this.controllers) c.setPaused(this.lifecycle.paused);
      this.overlay.graphics.visible = this.lifecycle.paused;
      this.banner.text.visible = this.lifecycle.paused;
    }
    if (this.input.isJustPressed("hide") && this.controllers.some((c) => c.isActive())) {
      this.lifecycle.hidden = !this.lifecycle.hidden;
      for (const c of this.controllers) c.setHidden(this.lifecycle.hidden);
    }
  }
}

// ── timed-choice recipe: host-owned countdown on the game clock ───────────────

/**
 * Timed choices aren't an engine feature — they're this recipe. A non-blocking
 * `choice-timer` command stashes `{ ms, default }`; the timer arms when the menu
 * is shown and commits the default option via `controller.choose` on expiry.
 * Two rules keep it honest:
 *
 *   • **Re-arm/cancel on every `DialogueChoiceShownEvent`** (and cancel on
 *     choice-made / ended). Without it, a timer armed for one menu could fire
 *     into a LATER, unrelated menu — the dangling-timer footgun.
 *   • **The countdown runs on `update(dt)` — the game clock** — so it must pause
 *     with the game. `setPaused` freezes the conversation but NOT this component,
 *     so the timer gates itself on the shared pause flag (pause your own timer).
 */
class ChoiceTimer extends Component {
  private remaining = -1; // ms left; < 0 = disarmed
  private pending: { ms: number; def: number } | undefined;
  private def = 0;
  private label!: TextComponent;

  constructor(
    private readonly controller: DialogueController,
    private readonly isPaused: () => boolean,
  ) {
    super();
  }

  onAdd(): void {
    const e = this.scene.spawn("dlg-timer");
    e.add(new Transform({ position: new Vec2(WIDTH / 2, 70) }));
    this.label = e.add(
      new TextComponent({
        text: "",
        style: { fontSize: 20, fill: 0xff6b6b, fontFamily: "sans-serif" },
        layer: HUD_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
    this.label.text.visible = false;

    this.entity.on(DialogueChoiceShownEvent, () => this.onShown());
    this.entity.on(DialogueChoiceMadeEvent, () => this.cancel());
    this.entity.on(DialogueEndedEvent, () => this.cancel());
  }

  /** The `choice-timer` command handler stashes its params here. */
  arm(ms: number, def: number): void {
    this.pending = { ms, def };
  }

  private onShown(): void {
    this.remaining = -1; // guard: drop any prior timer first…
    if (this.pending) {
      // …then re-arm only if THIS menu is timed.
      this.remaining = this.pending.ms;
      this.def = this.pending.def;
      this.pending = undefined;
    }
    this.refresh();
  }

  private cancel(): void {
    this.remaining = -1;
    this.pending = undefined;
    this.label.text.visible = false;
  }

  update(dt: number): void {
    if (this.remaining < 0 || this.isPaused()) return; // pause your own timer
    this.remaining -= dt;
    if (this.remaining <= 0) {
      const def = this.def;
      this.remaining = -1;
      this.label.text.visible = false;
      this.controller.choose(def); // commit the default on expiry
      return;
    }
    this.refresh();
  }

  private refresh(): void {
    if (this.remaining < 0) {
      this.label.text.visible = false;
      return;
    }
    this.label.setText(`⏳ ${Math.ceil(this.remaining / 1000)}s`);
    this.label.text.visible = true;
  }
}

// ── scene ────────────────────────────────────────────────────────────────────

class RoomScene extends Scene {
  readonly name = "dialogue-addon";
  readonly layers = LAYERS;

  /** Baked bitmap-font name; omit for the default canvas text. */
  constructor(private readonly bitmapFont?: string) {
    super();
  }

  onEnter(): void {
    this.drawTown();

    // Player.
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(140, 300) }));
    player.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.circle(0, 0, 13).fill({ color: 0x6be08a });
        g.circle(0, 0, 13).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
      }),
    );
    player.add(new DialogueActor({ speaker: "you", anchor: { x: 0, y: -20 } }));
    const playerPos = (): Vec2 => player.get(Transform).position;

    // Follow camera, clamped to the world so it never shows past the edges.
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
      follow: player.get(Transform),
      smoothing: 0.14,
      bounds: { minX: 0, minY: 0, maxX: WORLD_WIDTH, maxY: HEIGHT },
    });
    this.context.resolve(InputManagerKey).setCamera(cam);

    // Walkable bounds: gated at the gate until it opens.
    const bounds: Bounds = { minX: 40, maxX: GATE_X - 32, minY: 90, maxY: 360 };

    // The game state the dialogue bridges into.
    const state: GameState = { gold: 25, inventory: new Set<string>() };

    // Lifecycle flags (P pause / H hide), shared so the player freezes
    // with the conversation when paused.
    const lifecycle = { paused: false, hidden: false };

    // The locked gate (its `open-gate` handler extends the walkable bounds).
    const gateEntity = this.spawn("gate");
    gateEntity.add(new Transform({ position: new Vec2(GATE_X, 225) }));
    gateEntity.add(new GraphicsComponent({ layer: ROOM_LAYER }));
    const gate = gateEntity.add(
      new Gate(() => {
        bounds.maxX = WORLD_WIDTH - 40;
      }),
    );

    // ── the game-state seam, installed ONCE on the interactive controller ──
    const storage: VariableStorage = compose(
      // Two-way: the script can read AND spend `gold`; writes go back to the game.
      cells({ gold: { get: () => state.gold, set: (v) => (state.gold = Number(v)) } }),
      // Declared flags/counters (paid, opened, timesTalked) live here and persist.
      new MemoryVariableStorage(),
    );
    const functions: Record<string, DialogueFunction> = {
      has_item: (id) => state.inventory.has(String(id)),
    };
    // Forward-declared so the `choice-timer` handler (installed on the controller
    // below) can reach the ChoiceTimer component created after it.
    let choiceTimer: ChoiceTimer | undefined;
    const commands: Record<string, CommandHandler> = {
      "give-gold": (cmd) => {
        state.gold += Number(cmd.amount);
      },
      "give-item": (cmd) => {
        state.inventory.add(String(cmd.id));
      },
      "take-item": (cmd) => {
        state.inventory.delete(String(cmd.id));
      },
      "open-gate": () => gate.open(),
      // Timed-choice recipe: just stash the params; ChoiceTimer arms on show.
      "choice-timer": (cmd) => choiceTimer?.arm(Number(cmd.ms), Number(cmd.default)),
    };

    const bitmapFont = this.bitmapFont;
    const theme =
      bitmapFont !== undefined
        ? { ...defaultTheme(), bitmapFont, textSize: 14, lineHeight: 19 }
        : defaultTheme();
    const bubbleOpts = {
      worldLayer: BUBBLE_LAYER,
      ...(bitmapFont !== undefined ? { bubble: { maxWidth: 320 } } : {}),
    };
    const bundle = createMixedDialogue(theme, bubbleOpts);

    const host = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());
    const hud = host.add(new Hud(() => state.gold, () => [...state.inventory]));
    const interactive = host.add(
      new DialogueController({
        ...bundle,
        storage,
        functions,
        commands,
        input: fullControls(bundle.choices, { skipHoldMs: SKIP_HOLD_MS }),
      }),
    );
    hud.onAutoToggle = (on) => interactive.setAutoAdvance(on ? AUTO_ADVANCE_MS : null);
    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoice(e.text));

    // Host-owned timer for Rook's timed choice. Gated on `lifecycle.paused`
    // so P freezes the countdown along with the conversation.
    choiceTimer = host.add(new ChoiceTimer(interactive, () => lifecycle.paused));

    // The player idles while a conversation owns input, and while paused.
    const busy = (): boolean => interactive.isActive() || lifecycle.paused;
    player.add(new PlayerMover(bounds, busy));

    // Ambient controller (bubble) for the eavesdropped gossip. It has a REAL
    // polling binding, but focus is OFF (`setInputEnabled(false)`): the gossip
    // stays alive and auto-advances while consuming no device input — the
    // multi-instance "two conversations, one interactive" story. (This
    // previously used an empty `CompositeInputBinding([])` workaround.)
    const ambientBundle = createBubbleDialogue(theme, bubbleOpts);
    const ambient = this.spawn("ambient-host").add(
      new DialogueController({
        ...ambientBundle,
        input: fullControls(ambientBundle.choices),
      }),
    );
    ambient.setInputEnabled(false);

    // P pause / H hide — apply the lifecycle levers to BOTH conversations.
    host.add(new LifecycleControls([interactive, ambient], lifecycle));

    // ── townsfolk, left to right ──
    const talker = (
      x: number,
      color: number,
      name: string,
      label: string,
      script: DialogueScript,
    ): void => {
      const npc = spawnNpc(this, { x, y: 215, color, name });
      npc.add(
        new ProximityInteract({
          label,
          radius: 48,
          isBusy: busy,
          playerPos,
          onInteract: () => interactive.play(script),
        }),
      );
    };

    talker(280, 0xffd866, "Mira", "Talk to Mira (F)", MIRA);
    talker(520, 0x9ad17e, "Quinn", "Talk to the Quartermaster (F)", QUARTERMASTER);
    talker(760, 0xe6a3ff, "Vex", "Trade with Vex (F)", MERCHANT);
    talker(1040, 0xff6b6b, "Rook", "Talk to Rook (F)", ROOK);
    talker(GATE_X - 70, 0xff9a6b, "Bron", "Talk to the Guard (F)", GUARD);

    // Sage (bubble) on his own bench.
    const sage = spawnNpc(this, { x: 980, y: 300, color: 0x7ec8ff, name: "Sage", speaker: "sage" });
    sage.add(
      new ProximityInteract({
        label: "Talk to Sage (F)",
        radius: 48,
        isBusy: busy,
        playerPos,
        onInteract: () => interactive.play(SAGE),
      }),
    );

    // Eavesdrop pair: Ann & Bert chat on their own when you get close.
    spawnNpc(this, { x: 1110, y: 300, color: 0xf5a168, name: "Ann", speaker: "ann" });
    spawnNpc(this, { x: 1180, y: 300, color: 0xaaaaaa, name: "Bert", speaker: "bert" });
    const zone = this.spawn("gossip-zone");
    zone.add(new Transform({ position: new Vec2(1145, 310) }));
    zone.add(
      new ProximityZone({
        radius: 120,
        playerPos,
        onEnter: () => ambient.play(GOSSIP),
        onExit: () => ambient.stop(),
      }),
    );
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
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
        g.roundRect(GATE_X + 30, 80, WORLD_WIDTH - GATE_X - 70, 300, 10).fill({ color: 0x1d2233 });
        for (let x = 24; x <= WORLD_WIDTH - 24; x += 48) {
          g.moveTo(x, 70).lineTo(x, 390);
        }
        for (let y = 70; y <= 390; y += 48) {
          g.moveTo(24, y).lineTo(WORLD_WIDTH - 24, y);
        }
        g.stroke({ color: 0x222634, width: 1, alpha: 0.6 });
      }),
    );

    // A little "VAULT" sparkle beyond the gate.
    const vault = this.spawn("vault");
    vault.add(new Transform({ position: new Vec2(WORLD_WIDTH - 110, 225) }));
    vault.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(-26, -18, 52, 36, 5).fill({ color: 0xcaa24a }).stroke({ color: 0xffe08a, width: 2 });
        g.rect(-26, -4, 52, 4).fill({ color: 0x7a5e22 });
      }),
    );
    const vaultTag = this.spawn("vault-tag");
    vaultTag.add(new Transform({ position: new Vec2(WORLD_WIDTH - 110, 195) }));
    vaultTag.add(
      new TextComponent({
        text: "The Vault",
        style: { fontSize: 12, fill: 0xffe08a, fontFamily: "sans-serif" },
        layer: ROOM_LAYER,
        anchor: { x: 0.5, y: 0.5 },
      }),
    );
  }
}

async function main(): Promise<void> {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(WIDTH, HEIGHT),
    }),
  );
  engine.use(
    new InputPlugin({
      actions: {
        interact: ["Enter", "Space", "KeyF"],
        "move-up": ["ArrowUp", "KeyW"],
        "move-down": ["ArrowDown", "KeyS"],
        "move-left": ["ArrowLeft", "KeyA"],
        "move-right": ["ArrowRight", "KeyD"],
        attack: ["KeyJ"], // hold to fast-forward (FULL_ACTIONS.speed)
        skip: ["KeyX"], // hold to skip (FULL_ACTIONS.skip)
        auto: ["KeyV"], // toggle auto-advance
        pause: ["KeyP"], // setPaused — freeze the conversation + world
        hide: ["KeyH"], // setHidden — hide the dialogue UI mid-line
      },
      preventDefaultKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    }),
  );

  await engine.start();
  await engine.scenes.push(new RoomScene());
  wireFontToggle(engine);
}

/**
 * The "Font: Canvas / Bitmap" button under the canvas. Bakes a bitmap atlas
 * from the example `.ttf` on first use (32px glyphs, rendered at the bitmap
 * theme's 14px — exercising the measurement scaling), then rebuilds the town
 * with the other theme. A scene swap (not a live restyle): presenters take
 * their font at construction, and the game state resets with the fresh scene.
 */
function wireFontToggle(engine: Engine): void {
  const button = document.getElementById("font-toggle");
  if (!(button instanceof HTMLButtonElement)) return;
  injectStyles(`
    .controls button {
      background: #222; border: 1px solid #444; border-radius: 4px;
      padding: 2px 10px; font-size: 0.85rem; color: #fff; cursor: pointer;
    }
    .controls button:hover { border-color: #4a4a8a; }
  `);

  let bitmap = false;
  let fontName: string | undefined;
  button.addEventListener("click", () => {
    void (async () => {
      button.disabled = true;
      bitmap = !bitmap;
      fontName ??= await installBitmapFont("/assets/Kenney Future.ttf", {
        name: "Kenney Bitmap",
      });
      await engine.scenes.replace(new RoomScene(bitmap ? fontName : undefined));
      button.textContent = bitmap ? "Font: Bitmap" : "Font: Canvas";
      button.disabled = false;
    })();
  });
}

main().catch(console.error);

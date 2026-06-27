/**
 * @yagejs-addons/dialogue — a walkable town that drives the game-state model.
 *
 * Zero bundled ART assets: the town, the player, and the NPCs are all Graphics;
 * the dialogue presenters are `defaultTheme()` (Graphics chrome + canvas text).
 * The one bundled asset is Sage's voice-over — real synthesized speech under
 * `public/assets/voice/` (see the voice channel below). The level is wider than
 * the canvas, so a **follow camera** scrolls as you walk.
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
 *   • Captain Vow (box) — the box presenter's per-line layout: a `meta.position:
 *                         top` alert moves the frame + text to the top, a
 *                         line-driven **in-box avatar** (`meta.portrait`/`side`)
 *                         reflows the body text around her portrait, and a
 *                         six-option briefing GROWS the frame to fit the menu.
 *   • Mira (box)        — markup + **reveal-driven events**: a per-glyph
 *                         typewriter click (`onRevealTick`, whitespace-filtered),
 *                         positional `[sfx=…/]` cues and a `[screenShake/]` marker
 *                         (`DialogueRevealMarkerEvent` — the host plays a tone /
 *                         shakes the camera; the addon name-matches nothing), and
 *                         the effect+hold idiom `[sfx=chime/][pause=500/]` (fire,
 *                         then hold while it plays — source order is the timing).
 *                         Plus a **cycling counter** (`timesTalked` persists, so
 *                         she greets you differently each visit).
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
 *   • Sage (bubble)     — no `view` hint: the default route floats him in a
 *                         bubble because he has a registered actor (speaker-aware).
 *                         He's also the **voiced** NPC: each line carries a `voice`
 *                         id played as a real clip over `@yagejs/audio`, gating
 *                         auto-advance until the voice finishes.
 *   • Ann & Bert        — stand near them to **eavesdrop** an ambient gossip loop
 *                         (a second controller kept alive but input-disabled via
 *                         `setInputEnabled(false)` — the focus seam).
 *   • Pip the Locksmith — the one NPC authored in the **compact DSL** (not YAML):
 *                         a conditional jump (`-> regreet if: pip_seen`) re-greets
 *                         a returning customer, with a `declare`d flag, line-driven
 *                         `#portrait:`/`#side:` avatars, and `set` / `do` against
 *                         the same shared storage.
 *
 * The HUD shows your live gold + items. Hold **J** to fast-forward, hold **X** to
 * skip, press **V** to toggle auto-advance; the pointer works too. The three
 * lifecycle levers ride two keys: **P** pauses (the conversation freezes
 * intact behind a dim overlay — `setPaused`) and **H** hides the dialogue UI
 * mid-line, restoring it at the same reveal point (`setHidden`). The
 * **Font** button swaps every presenter to a baked bitmap font and back.
 *
 * Two **registered channels** ride alongside the built-in presenter trio — the
 * open-ended extensibility seam, each added with zero addon change via the
 * controller's `channels` option:
 *   • a built-in `createVoiceChannel` voice-over — reads Sage's per-line `voice`
 *     id and plays it over `@yagejs/audio` (a "voice" channel). It **gates
 *     auto-advance until the clip ends** (so with **V** on, Sage waits for his own
 *     voice — `max(clipEnd, revealEnd)`), **P** pauses the clip with the
 *     conversation, and the gate releases via `@yagejs/audio`'s `onEnd` (no
 *     polling). With `onSkip: "ring"`, completing the typewriter does NOT cut the
 *     voice — it's stopped only when you move to the next line.
 *   • a custom `TranscriptChannel` — a `Mountable` observer implementing only
 *     `present`, logging each line the moment it appears (no waiting for the
 *     typewriter) to a small semi-opaque HUD panel; a channel that gates nothing.
 *
 * Eight scripts live in plain **YAML data files** under `./dialogue/` (a designer
 * edits them without touching code), imported via Vite's `?raw` suffix and parsed
 * by `loadYaml` (the `/yaml` subpath). Conditions and `set` values are plain string
 * expressions (`"gold >= 50 and not has_item('rusty-key')"`, `"gold - 50"`) instead
 * of hand-built trees — `loadYaml` runs them through the same string→expression
 * parser the JSON loader uses. Pip's script (`./dialogue/locksmith.dlg`) is the
 * same idea in the **compact DSL**: `loadCompact` (the root entry, no `yaml` dep)
 * over a terse, line-oriented format that compiles to the identical frozen IR.
 *
 * Export split: runner / controller / events / input / the storage kit come from
 * the pixi-free root entry; YAML authoring from `/yaml`; presenters + theme from
 * `/presenters`.
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
import { AudioPlugin, AudioManagerKey, sound } from "@yagejs/audio";
import {
  createVoiceChannel,
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueEndedEvent,
  DialogueRevealMarkerEvent,
  cells,
  compose,
  fullControls,
  loadCompact,
  splitGraphemes,
  MemoryVariableStorage,
  type CommandHandler,
  type DialogueExtraChannel,
  type DialogueFunction,
  type DialogueScript,
  type Mountable,
  type PresentedLine,
  type VariableStorage,
} from "@yagejs-addons/dialogue";
// YAML authoring lives behind the `/yaml` subpath so non-YAML games don't bundle
// the parser; it returns the same validated, frozen `DialogueScript`.
import { loadYaml } from "@yagejs-addons/dialogue/yaml";
// The dialogue itself lives in plain `.yaml` data files (a designer edits these
// without touching code); Vite's `?raw` suffix imports each as a string.
import miraYaml from "./dialogue/mira.yaml?raw";
import quartermasterYaml from "./dialogue/quartermaster.yaml?raw";
import merchantYaml from "./dialogue/merchant.yaml?raw";
import guardYaml from "./dialogue/guard.yaml?raw";
import rookYaml from "./dialogue/rook.yaml?raw";
import sageYaml from "./dialogue/sage.yaml?raw";
import captainYaml from "./dialogue/captain.yaml?raw";
import gossipYaml from "./dialogue/gossip.yaml?raw";
// One NPC's script is authored in the compact DSL instead of YAML — loaded with
// `loadCompact` from the root entry (no `yaml` dep), same validated/frozen IR.
import locksmithCompact from "./dialogue/locksmith.dlg?raw";
import {
  defaultTheme,
  createMixedDialogue,
  createBubbleDialogue,
  DialogueActor,
  InBoxAvatarPresenter,
  BubbleAvatarPresenter,
  DIALOGUE_LAYERS,
  DIALOGUE_LAYER_AVATAR,
  type DialogueTheme,
} from "@yagejs-addons/dialogue/presenters";
import { Assets, Texture } from "pixi.js";
import { injectStyles, setupGameContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;
const WORLD_WIDTH = 1600; // wider than the canvas → the camera scrolls

const SKIP_HOLD_MS = 600; // hold X this long to confirm a skip
const AUTO_ADVANCE_MS = 1500; // delay between lines when auto-advance is on
const PLAYER_SPEED = 165; // px/sec

// The key price (50) and Rook's timeout (5000ms) now live in the dialogue data
// files (`merchant.yaml` / `rook.yaml`).
const GATE_X = 1410; // the locked gate; blocks progress until unlocked

/** Portrait texture keys for the avatars (drawn on a canvas in onEnter, so the
 *  demo stays asset-free). The Captain uses two expressions in the box; Sage
 *  uses one beside his bubble. */
const FACE_NEUTRAL = "cap-neutral";
const FACE_STERN = "cap-stern";
const FACE_SAGE = "sage-face";
const FACE_PIP_SMILE = "pip-smile";
const FACE_PIP_THINK = "pip-think";

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

// ── scripts — authored in `./dialogue/*.yaml`, parsed by `loadYaml` ──────────
//
// The dialogue lives in plain YAML data files (imported above via Vite `?raw`),
// each mirroring the JSON `DialogueScript` and all content-only
// (storage/functions/commands live on the host). Conditions and `set` values are
// plain string expressions (`gold >= 50 and not has_item('rusty-key')`,
// `gold - 50`) — `loadYaml` parses them into the IR and validates at module load,
// so a malformed file throws here rather than at first `play`. The portrait keys
// (`cap-stern` / `cap-neutral` / `sage-face`) are the texture keys the scene
// registers in `Assets` below.

/** Mira — markup effects + a persistent visit counter (cycling NPC). */
const MIRA = loadYaml(miraYaml);
/** Quartermaster — a one-time stipend via `give-gold`, gated on a declared flag. */
const QUARTERMASTER = loadYaml(quartermasterYaml);
/** Vex — buys the rusty key for gold via an expression-gated option that writes
 *  through the two-way `gold` cell and hands over the item. */
const MERCHANT = loadYaml(merchantYaml);
/** Bron — opens the gate only with the key (a function gate), spends it, and
 *  fires a world-consequence command. */
const GUARD = loadYaml(guardYaml);
/** Rook — a TIMED choice (a recipe, not an engine feature): a non-blocking
 *  `choice-timer` command arms a host-owned countdown on the game clock; stall too
 *  long and {@link ChoiceTimer} commits the default ("Freeze up", index 1).
 *  `meta.timeoutMs` rides through to the presenter for a custom countdown. */
const ROOK = loadYaml(rookYaml);
/** Sage — NO `view` hint on his lines: the default route floats him in a bubble
 *  anyway because he has a registered {@link DialogueActor} (speaker-aware). His
 *  `meta.portrait` drives the bubble-side avatar, the diegetic counterpart to the
 *  Captain's in-box one. */
const SAGE = loadYaml(sageYaml);
/** Captain Vow — the box presenter's per-line layout: a `meta.position: "top"`
 *  alert (frame + body move up together), a line-driven reflowing in-box avatar
 *  (`meta.portrait` / `meta.side`, the `InBoxAvatarPresenter` wired into the
 *  bundle), and a six-option briefing that GROWS the frame to fit the menu. */
const CAPTAIN = loadYaml(captainYaml);
/** Ambient gossip — loops forever, each line auto-advancing, no input binding. */
const GOSSIP = loadYaml(gossipYaml);
/** Pip — the one NPC authored in the **compact DSL** (`./dialogue/locksmith.dlg`,
 *  parsed by `loadCompact`, not `loadYaml`). Shows the compact-only conveniences:
 *  a `declare`d visit flag + a conditional jump (`-> regreet if: pip_seen`) that
 *  re-greets a returning customer, line-driven `#portrait:`/`#side:` avatars, a
 *  `#line:` i18n key, per-line `speed=`, and `set` / `do` against the SAME shared
 *  storage the YAML NPCs use. It compiles to the identical frozen IR. */
const LOCKSMITH = loadCompact(locksmithCompact);

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

// ── extra channels: a built-in voice-over + a custom transcript ────────────────
//
// Channels a host *registers* on the conversation, alongside the built-in
// presenter trio (text / choices / avatar / chrome). They're wired through the
// controller's `channels` option below. The addon owns no audio and no transcript
// UI — these are the GAME's, added with zero addon change.

/** Sage's voice clips — real synthesized speech (macOS `say`, the Daniel voice),
 *  preloaded by the scene. The map turns each opaque `voice` id (authored in the
 *  YAML) into its clip; a host maps voice ids to assets exactly like this. */
const VOICE: Record<string, ReturnType<typeof sound>> = {
  vo_sage_ramble: sound("/assets/voice/sage_ramble.mp3"),
  vo_sage_controls: sound("/assets/voice/sage_controls.mp3"),
  vo_sage_gate: sound("/assets/voice/sage_gate.mp3"),
  vo_sage_bye: sound("/assets/voice/sage_bye.mp3"),
};

/**
 * A tiny asset-free WebAudio synth for the **reveal-events** demo: a soft
 * per-grapheme typewriter `tick()` (wired to the controller's `onRevealTick`) and
 * a named `cue(name)` played at an inline `[sfx=name/]` marker (wired to
 * `DialogueRevealMarkerEvent`). A real game would play `@yagejs/audio` clips like
 * Sage's voice above; synth keeps the showcase asset-free. The `AudioContext` is
 * created lazily and `resume()`d — by the time you reach an NPC, a keypress has
 * already satisfied the browser's autoplay gesture requirement.
 */
class BlipSynth {
  private ctx: AudioContext | undefined;
  private lastTick = 0;

  private ac(): AudioContext | undefined {
    if (this.ctx === undefined && typeof AudioContext !== "undefined") {
      this.ctx = new AudioContext();
    }
    void this.ctx?.resume();
    return this.ctx;
  }

  private blip(freq: number, ms: number, gain: number, type: OscillatorType): void {
    const ctx = this.ac();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000);
  }

  /** Per-grapheme typewriter click — rate-limited so a fast reveal stays subtle. */
  tick(): void {
    const ctx = this.ac();
    if (!ctx || ctx.currentTime - this.lastTick < 0.028) return;
    this.lastTick = ctx.currentTime;
    this.blip(620, 13, 0.035, "square");
  }

  /** A named positional cue (`[sfx=name/]`) — a distinct tone per name. */
  cue(name: string): void {
    const tones: Record<string, [number, number, number, OscillatorType]> = {
      chime: [1320, 240, 0.16, "sine"],
      page: [360, 80, 0.12, "triangle"],
    };
    const [f, ms, gain, type] = tones[name] ?? [880, 100, 0.12, "sine"];
    this.blip(f, ms, gain, type);
  }
}

// The voice channel's host half is wired inline in `onEnter` (it just plays the
// line's clip over @yagejs/audio); see `createVoiceChannel({ play })` below.

/**
 * A CUSTOM extra channel — the "another channel" a game adds with zero addon
 * change. It implements ONLY `present` (a pure observer: it never gates
 * auto-advance and hands the session nothing back), logging each line the moment
 * it APPEARS (not waiting for the typewriter) to a small semi-opaque HUD panel. It
 * also implements {@link Mountable}, so the controller mounts it on the scene in
 * `onAdd` and disposes it in `onDestroy`, exactly like a presenter.
 */
class TranscriptChannel implements DialogueExtraChannel, Mountable {
  private static readonly MAX = 3;
  private static readonly W = 286; // panel width
  private static readonly PAD = 8;
  private static readonly ROW = 16; // line height
  private readonly lines: string[] = [];
  private bg: Entity | undefined;
  private textEntity: Entity | undefined;
  private panel: TextComponent | undefined;

  mount(scene: Scene): void {
    const { W, PAD, ROW, MAX } = TranscriptChannel;
    const h = PAD * 2 + ROW * MAX;
    // Top-left, under the gold/items line: clear of the bottom box AND the speech
    // bubbles (which float over the centre/right NPCs).
    const x = 12;
    const y = 52;
    // A semi-opaque backing panel keeps the log legible over the playfield.
    this.bg = scene.spawn("transcript-bg");
    this.bg.add(new Transform({ position: new Vec2(x, y) }));
    this.bg.add(
      new GraphicsComponent({ layer: HUD_LAYER }).draw((g) => {
        g.roundRect(0, 0, W, h, 6)
          .fill({ color: 0x0a0c16, alpha: 0.6 })
          .stroke({ color: 0x2a3146, width: 1, alpha: 0.8 });
      }),
    );
    // Text on top — spawned after the panel, so it renders above it in the layer.
    this.textEntity = scene.spawn("transcript-text");
    this.textEntity.add(new Transform({ position: new Vec2(x + PAD, y + PAD) }));
    this.panel = this.textEntity.add(
      new TextComponent({
        text: "",
        style: { fontSize: 11, fill: 0xaab2c6, fontFamily: "sans-serif", lineHeight: ROW },
        layer: HUD_LAYER,
        anchor: { x: 0, y: 0 },
      }),
    );
  }

  dispose(): void {
    this.bg?.destroy();
    this.textEntity?.destroy();
    this.bg = undefined;
    this.textEntity = undefined;
    this.panel = undefined;
  }

  /** Fires when a say line is PRESENTED — logged at once, not on reveal. */
  present(line: PresentedLine): void {
    const body = line.text.runs.map((r) => r.text).join("");
    const who = line.speaker?.name ? `${line.speaker.name}: ` : "";
    this.lines.push(this.clip(`${who}${body}`, 42));
    if (this.lines.length > TranscriptChannel.MAX) this.lines.shift();
    this.panel?.setText(this.lines.join("\n"));
  }

  /** Clip a row to a single line. */
  private clip(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
  }
}

// ── theme presets (cycled by the "Theme" button) ─────────────────────────────

/** A canvas-drawn nine-slice frame (a coloured `border`-px ring around a fill)
 *  for the textured preset — keeps the demo asset-free. The `border` must equal
 *  the nine-slice insets so the corners map 1:1. */
function makeFrameTexture(edge: number, fill: number, border: number): Texture {
  const size = 48;
  const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = hex(edge);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = hex(fill);
    ctx.fillRect(border, border, size - 2 * border, size - 2 * border);
  }
  return Texture.from(canvas);
}

/** A simple canvas-drawn face for the Captain's in-box avatar — keeps the demo
 *  asset-free. `stern` angles the brows + frowns; otherwise a neutral look. */
function makeFace(skin: number, stern: boolean): Texture {
  const s = 72;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
    ctx.fillStyle = hex(skin);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#15151f";
    for (const ex of [0.36, 0.64]) {
      ctx.beginPath();
      ctx.arc(s * ex, s * 0.44, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#15151f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const browY = stern ? 0.38 : 0.32; // inner brow drops for a scowl
    ctx.moveTo(s * 0.28, s * 0.34);
    ctx.lineTo(s * 0.44, s * browY);
    ctx.moveTo(s * 0.72, s * 0.34);
    ctx.lineTo(s * 0.56, s * browY);
    ctx.stroke();
    ctx.beginPath();
    if (stern) ctx.arc(s / 2, s * 0.82, 9, Math.PI * 1.15, Math.PI * 1.85); // frown
    else ctx.arc(s / 2, s * 0.62, 9, Math.PI * 0.15, Math.PI * 0.85); // smile
    ctx.stroke();
  }
  return Texture.from(canvas);
}

// Built once, then registered under their `meta.portrait` keys per scene mount.
let faceNeutral: Texture | undefined;
let faceStern: Texture | undefined;
let faceSage: Texture | undefined;
let facePipSmile: Texture | undefined;
let facePipThink: Texture | undefined;

const insets = (n: number): { left: number; top: number; right: number; bottom: number } => ({
  left: n,
  top: n,
  right: n,
  bottom: n,
});
// The bubble is small, so it wears a thinner border than the wide box frame.
const FRAME_BORDER = 12;
const BUBBLE_BORDER = 6;
// Built once on first use of the textured preset, then reused across rebuilds.
let frameTex: Texture | undefined;
let bubbleTex: Texture | undefined;

interface ThemePreset {
  readonly label: string;
  readonly build: () => DialogueTheme;
}

/** The presets the "Theme" button cycles. "Warm" recolours every knob through
 *  the theme (no presenter subclassed); "Textured" swaps the box + bubble chrome
 *  to a nine-slice via `theme.textured`. */
const THEME_PRESETS: readonly ThemePreset[] = [
  { label: "Default", build: () => defaultTheme() },
  {
    label: "Warm",
    build: () => ({
      ...defaultTheme(),
      frameColor: 0x2b1d12,
      borderColor: 0xb8894e,
      nameColor: 0xffcf8a,
      textColor: 0xf3e6cf,
      choiceColor: 0xcdba97,
      choiceSelectedColor: 0xffd98a,
      highlightColor: 0x7a5a2a,
      caret: { blinkMs: 200, size: { width: 9, height: 6 } },
      choiceGap: 8,
    }),
  },
  {
    label: "Textured",
    build: () => {
      frameTex ??= makeFrameTexture(0x8a6d3b, 0x2b2417, FRAME_BORDER);
      bubbleTex ??= makeFrameTexture(0x8a6d3b, 0x241d12, BUBBLE_BORDER);
      return {
        ...defaultTheme(),
        nameColor: 0xffcf8a,
        textColor: 0xf3e6cf,
        textured: {
          default: {
            frame: { texture: frameTex, insets: insets(FRAME_BORDER) },
            bubble: { texture: bubbleTex, insets: insets(BUBBLE_BORDER) },
          },
        },
      };
    },
  },
];

// ── scene ────────────────────────────────────────────────────────────────────

class RoomScene extends Scene {
  readonly name = "dialogue-addon";
  readonly layers = LAYERS;
  /** Preload Sage's voice clips so `audio.play` resolves them synchronously. */
  readonly preload = Object.values(VOICE);

  /** `themeBuild` picks the look (cycled by the Theme button); `bitmapFont` (the
   *  Font button) layers a baked atlas on top. Both rebuild the scene. */
  constructor(
    private readonly themeBuild: () => DialogueTheme = defaultTheme,
    private readonly bitmapFont?: string,
  ) {
    super();
  }

  onEnter(): void {
    this.drawTown();

    // Register the portraits under their `meta.portrait` keys (the renderer's
    // Assets is up by now), so the avatars resolve them synchronously — a host
    // preloads avatar art the same way.
    faceNeutral ??= makeFace(0xe8c9a0, false);
    faceStern ??= makeFace(0xe8c9a0, true);
    faceSage ??= makeFace(0x9fc6e8, false);
    facePipSmile ??= makeFace(0xffcf9a, false);
    facePipThink ??= makeFace(0xffcf9a, true);
    Assets.cache.set(FACE_NEUTRAL, faceNeutral);
    Assets.cache.set(FACE_STERN, faceStern);
    Assets.cache.set(FACE_SAGE, faceSage);
    Assets.cache.set(FACE_PIP_SMILE, facePipSmile);
    Assets.cache.set(FACE_PIP_THINK, facePipThink);

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
    const base = this.themeBuild();
    const theme: DialogueTheme =
      bitmapFont !== undefined
        ? { ...base, bitmapFont, textSize: 14, lineHeight: 19 }
        : base;
    // A textured bubble gets extra inner padding so its text clears the
    // nine-slice border the small bubble would otherwise crowd.
    const texturedBubble = theme.textured?.["default"]?.bubble !== undefined;
    const bubbleOpts = {
      worldLayer: BUBBLE_LAYER,
      bubble: {
        ...(bitmapFont !== undefined ? { maxWidth: 320 } : {}),
        ...(texturedBubble ? { padding: 12 } : {}),
      },
    };
    const bundle = createMixedDialogue(theme, {
      ...bubbleOpts,
      // Line-driven avatars per side, routed by the same route as the chrome/
      // text/choices: an in-box reflowing portrait for box speakers (the
      // Captain), and a portrait beside the bubble for bubble speakers (Sage).
      avatar: {
        box: (layout) =>
          new InBoxAvatarPresenter(layout, {
            layer: DIALOGUE_LAYER_AVATAR,
            width: 84,
            scale: 0.8,
            align: "top",
            background: { color: 0x2a2438, alpha: 0.9, radius: 10 },
          }),
        bubble: (layout) =>
          new BubbleAvatarPresenter(layout, {
            layer: BUBBLE_LAYER,
            size: 56,
            scale: 0.68,
            align: "top",
            background: { color: 0x14233a, alpha: 0.92, radius: 8 },
          }),
      },
    });

    const host = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());
    const hud = host.add(new Hud(() => state.gold, () => [...state.inventory]));

    // Two registered extra channels (the open-ended companion to the trio):
    //  • a BUILT-IN voice-over channel — plays each line's `voice` clip over
    //    @yagejs/audio and gates auto-advance until it ends; and
    //  • a CUSTOM transcript channel — a pure observer logging lines as they appear.
    // Both ride the controller's `channels` option and need zero addon change.
    const audio = this.context.resolve(AudioManagerKey);
    const voice = createVoiceChannel({
      // `ring`: completing the typewriter doesn't cut the voice — it plays on, and
      // is stopped only when the next line presents (or the conversation clears).
      onSkip: "ring",
      play: (id, onEnded) => {
        const asset = VOICE[id];
        if (!asset) {
          onEnded(); // unknown id → don't gate (degrade gracefully)
          return { stop() {}, pause() {}, resume() {} };
        }
        // `onEnd` releases the auto-advance gate the instant the clip finishes.
        const h = audio.play(asset.path, { channel: "voice", onEnd: onEnded });
        return {
          stop: () => h.stop(),
          pause: () => (h.paused = true), // P pauses the conversation → pauses the voice
          resume: () => (h.paused = false),
        };
      },
    });
    const transcript = new TranscriptChannel();

    // ── reveal-driven events (Feature 3) ──────────────────────────────────────
    // `onRevealTick` is a per-grapheme CALLBACK (not an entity event — it fires
    // hundreds of times a line); the host filters whitespace itself. Inline
    // `[name k=v/]` markers arrive as `DialogueRevealMarkerEvent` on the entity
    // bus. Mira's lines carry `[sfx=chime/]` / `[sfx=page/]` audio cues and a
    // `[screenShake/]` (named so it doesn't shadow the `[shake]…[/shake]` styling
    // effect) — the host decides what each opaque name means.
    const blip = new BlipSynth();
    let lineGraphemes: string[] = [];

    const interactive = host.add(
      new DialogueController({
        ...bundle,
        storage,
        functions,
        commands,
        input: fullControls(bundle.choices, { skipHoldMs: SKIP_HOLD_MS }),
        channels: [voice, transcript],
        // A typewriter click per revealed glyph — `index` is a raw grapheme index
        // (whitespace included), so we look it up and skip spaces.
        onRevealTick: (index) => {
          const g = lineGraphemes[index];
          if (g !== undefined && g.trim() !== "") blip.tick();
        },
      }),
    );
    hud.onAutoToggle = (on) => interactive.setAutoAdvance(on ? AUTO_ADVANCE_MS : null);
    host.on(DialogueLineEvent, (e) => {
      probe.onLine(e.text);
      // `onRevealTick` indexes the parsed line in graphemes; the event's plain
      // (markup-stripped) text shares that basis, so split it for the lookup.
      lineGraphemes = splitGraphemes(e.text);
    });
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoice(e.text));
    // The addon name-matches NO marker — the game does. Marker names are
    // lower-cased by the parser (`[screenShake/]` → `"screenshake"`), so match the
    // lower-case form. `viaSkip` markers (drained by a skip) are suppressed so a
    // fast-forward doesn't fire a loud one-shot.
    host.on(DialogueRevealMarkerEvent, ({ marker, viaSkip }) => {
      if (viaSkip) return;
      if (marker.name === "screenshake") cam.shake(7, 320);
      else if (marker.name === "sfx") blip.cue(marker.props["sfx"] ?? "");
    });

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

    talker(200, 0x86c5ff, "Vow", "Captain Vow (F)", CAPTAIN);
    talker(320, 0xffd866, "Mira", "Talk to Mira (F)", MIRA);
    talker(520, 0x9ad17e, "Quinn", "Talk to the Quartermaster (F)", QUARTERMASTER);
    talker(640, 0xffb86b, "Pip", "Talk to Pip the Locksmith (F)", LOCKSMITH);
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
  // A dedicated "voice" channel for Sage's clips (own volume, mute, pause).
  engine.use(new AudioPlugin({ channels: { voice: { volume: 1 } } }));

  await engine.start();
  await engine.scenes.push(new RoomScene());
  wireControls(engine);
}

/**
 * The "Font" + "Theme" buttons under the canvas. Each rebuilds the town with a
 * scene swap (not a live restyle: presenters take their font/theme at
 * construction, and the game state resets with the fresh scene). Font bakes the
 * bitmap atlas on first use (32px glyphs rendered at the bitmap theme's 14px —
 * exercising the measurement scaling) and layers it on the current theme; Theme
 * cycles {@link THEME_PRESETS} — default → warm recolour → textured nine-slice.
 */
function wireControls(engine: Engine): void {
  injectStyles(`
    .controls button {
      background: #222; border: 1px solid #444; border-radius: 4px;
      padding: 2px 10px; font-size: 0.85rem; color: #fff; cursor: pointer;
    }
    .controls button:hover { border-color: #4a4a8a; }
  `);

  let bitmap = false;
  let fontName: string | undefined;
  let themeIndex = 0;
  let themeBuild: () => DialogueTheme = THEME_PRESETS[0]?.build ?? defaultTheme;
  const rebuild = (): Promise<void> =>
    engine.scenes.replace(new RoomScene(themeBuild, bitmap ? fontName : undefined));

  const fontBtn = document.getElementById("font-toggle");
  if (fontBtn instanceof HTMLButtonElement) {
    fontBtn.addEventListener("click", () => {
      void (async () => {
        fontBtn.disabled = true;
        bitmap = !bitmap;
        fontName ??= await installBitmapFont("/assets/Kenney Future.ttf", {
          name: "Kenney Bitmap",
        });
        await rebuild();
        fontBtn.textContent = bitmap ? "Font: Bitmap" : "Font: Canvas";
        fontBtn.disabled = false;
      })();
    });
  }

  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn instanceof HTMLButtonElement) {
    themeBtn.addEventListener("click", () => {
      void (async () => {
        themeBtn.disabled = true;
        themeIndex = (themeIndex + 1) % THEME_PRESETS.length;
        const preset = THEME_PRESETS[themeIndex];
        if (preset) {
          themeBuild = preset.build;
          await rebuild();
          themeBtn.textContent = `Theme: ${preset.label}`;
        }
        themeBtn.disabled = false;
      })();
    });
  }
}

main().catch(console.error);

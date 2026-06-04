/**
 * @yagejs-addons/dialogue — a small walkable room (the first YAGE addon).
 *
 * Zero bundled assets: the room, the player, and the NPCs are all Graphics; the
 * dialogue presenters are `defaultTheme()` (Graphics chrome + canvas text). Walk
 * up to an NPC and press F to talk; each starts a different conversation:
 *
 *   • Mira (box)   — `[wave]`/`[shake]` effects, a clickable `[term=mana]`
 *                    glossary span (underlined; tap → tooltip, no accidental
 *                    advance), timed `[pause]` / `[speed]` markup, a branch.
 *   • Sage (bubble) — a long line that the speech bubble now grows to fit.
 *
 * Stand near Ann & Bert to **eavesdrop**: a proximity zone starts an ambient,
 * auto-advancing, input-less gossip loop that stops when you walk away.
 *
 * Controls demo: hold **J** to fast-forward, hold **X** to skip (a ring fills),
 * press **V** to toggle auto-advance, and the pointer works too (click to
 * advance, click/hover choices, hover/tap the `mana` term).
 *
 * Export split: runner / controller / events / input come from the pixi-free
 * root entry; presenters + theme come from the `/presenters` subpath.
 */

import {
  Engine,
  Scene,
  Component,
  Transform,
  Vec2,
  type Entity,
} from "@yagejs/core";
import {
  RendererPlugin,
  CameraEntity,
  GraphicsComponent,
  TextComponent,
  measureWrappedText,
  type LayerDef,
} from "@yagejs/renderer";
import { InputPlugin, InputManagerKey } from "@yagejs/input";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceMadeEvent,
  CompositeInputBinding,
  fullControls,
  type DialogueScript,
  type TermActivation,
} from "@yagejs-addons/dialogue";
import {
  defaultTheme,
  createMixedDialogue,
  createBubbleDialogue,
  DialogueActor,
  DIALOGUE_LAYERS,
} from "@yagejs-addons/dialogue/presenters";
import { setupGameContainer } from "./shared.js";

const WIDTH = 800;
const HEIGHT = 600;

const SKIP_HOLD_MS = 600; // hold X this long to confirm a skip
const AUTO_ADVANCE_MS = 1500; // delay between lines when auto-advance is on
const PLAYER_SPEED = 150; // px/sec
const TIP_FONT = 13;
const TIP_LINE = 17;
const TIP_WRAP = 260; // term-tooltip wrap width (px)
const TIP_PAD = 8;

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

/** Walkable area (world coords); leaves headroom for the bottom dialogue box. */
const BOUNDS = { minX: 40, maxX: WIDTH - 40, minY: 90, maxY: 360 };

/** Glossary the game owns — the addon only emits the opaque term id. */
const GLOSSARY: Record<string, string> = {
  mana: "Mana — the energy that powers spells. Regenerates while you rest.",
};

// ── scripts ──────────────────────────────────────────────────────────────────

const MIRA: DialogueScript = {
  id: "mira",
  start: "intro",
  speakers: { mira: { id: "mira", name: "Mira", color: 0xffd866 } },
  nodes: {
    intro: {
      id: "intro",
      steps: [
        {
          kind: "say",
          speaker: "mira",
          text: "Welcome! This box can [wave]wave[/wave] and [shake]shout[/shake].",
        },
        {
          kind: "say",
          speaker: "mira",
          text: "Magic here runs on [term=mana]mana[/term] — hover or tap that word.",
        },
        {
          kind: "say",
          speaker: "mira",
          text: "Timing matters:[pause=400] this part is [speed=0.4]slow[/speed].",
        },
        {
          kind: "choice",
          speaker: "mira",
          text: "Want the tour?",
          options: [
            { text: "Tell me more", target: "more" },
            { text: "I'm good", target: "bye" },
          ],
        },
      ],
    },
    more: {
      id: "more",
      steps: [
        {
          kind: "say",
          speaker: "mira",
          text: "Branching, effects, glossary terms, timed reveals — one script.",
        },
        { kind: "goto", target: "bye" },
      ],
    },
    bye: {
      id: "bye",
      steps: [
        { kind: "say", speaker: "mira", text: "Safe travels!" },
        { kind: "end" },
      ],
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** WASD/arrow movement, clamped to the room; idles while a conversation owns
 *  input (you can still walk while merely eavesdropping). */
class PlayerMover extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly transform = this.sibling(Transform);

  constructor(private readonly isBusy: () => boolean) {
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
      clamp(p.x + (dx / len) * step, BOUNDS.minX, BOUNDS.maxX),
      clamp(p.y + (dy / len) * step, BOUNDS.minY, BOUNDS.maxY),
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
    tip.add(new Transform({ position: new Vec2(here.x, here.y - 34) }));
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

/** Spawn a coloured dot NPC (+ optional speaker actor for bubbles). */
function spawnNpc(
  scene: Scene,
  opts: {
    readonly x: number;
    readonly y: number;
    readonly color: number;
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
  if (opts.speaker) {
    npc.add(new DialogueActor({ speaker: opts.speaker, anchor: { x: 0, y: -22 } }));
  }
  return npc;
}

// ── HUD (screen space): hint, auto toggle, fast-forward + skip ring, tooltip ──

class Hud extends Component {
  private readonly input = this.service(InputManagerKey);
  private auto = false;
  private autoLabel!: TextComponent;
  private meter!: GraphicsComponent;
  private tipBg!: GraphicsComponent;
  private tipText!: TextComponent;
  private tipTimer = 0;

  /** Set by the scene once the controller exists (toggled by the V key). */
  onAutoToggle?: (on: boolean) => void;

  onAdd(): void {
    this.spawnText(
      12,
      12,
      "WASD/Arrows move · F talk · hold J fast · hold X skip · V auto · click too",
      13,
      0xb8b8c0,
      { x: 0, y: 0 },
    );
    this.autoLabel = this.spawnText(
      WIDTH - 12,
      12,
      this.autoText(),
      13,
      0x8888aa,
      { x: 1, y: 0 },
    );

    const meterEntity = this.scene.spawn("hud-meter");
    meterEntity.add(new Transform({ position: new Vec2(WIDTH / 2, HEIGHT - 28) }));
    this.meter = meterEntity.add(new GraphicsComponent({ layer: HUD_LAYER }));

    const bg = this.scene.spawn("hud-tip-bg");
    bg.add(new Transform());
    this.tipBg = bg.add(new GraphicsComponent({ layer: HUD_LAYER }));
    this.tipBg.graphics.visible = false;

    const tip = this.scene.spawn("hud-tip-text");
    tip.add(new Transform());
    this.tipText = tip.add(
      new TextComponent({
        text: "",
        style: {
          fontSize: TIP_FONT,
          fill: 0xffffff,
          fontFamily: "sans-serif",
          lineHeight: TIP_LINE,
          wordWrap: true,
          wordWrapWidth: TIP_WRAP,
        },
        layer: HUD_LAYER,
        anchor: { x: 0, y: 0 },
      }),
    );
    this.tipText.text.visible = false;
  }

  /** Show a glossary tooltip near a screen position, sized to the text (auto-hides). */
  showTerm(e: TermActivation): void {
    const text = GLOSSARY[e.id];
    if (!text) return;
    const m = measureWrappedText(text, {
      fontSize: TIP_FONT,
      lineHeight: TIP_LINE,
      wordWrapWidth: TIP_WRAP,
      fontFamily: "sans-serif",
    });
    const w = m.width + 2 * TIP_PAD;
    const h = m.height + 2 * TIP_PAD;
    const x = clamp(e.screen.x + 14, 8, WIDTH - w - 8);
    const y = clamp(e.screen.y + 14, 8, HEIGHT - h - 8);
    this.tipText.setText(text);
    this.tipText.entity.get(Transform).setPosition(x + TIP_PAD, y + TIP_PAD);
    this.tipText.text.visible = true;
    this.tipBg.entity.get(Transform).setPosition(x, y);
    this.tipBg.graphics.clear();
    this.tipBg.draw((g) => {
      g.roundRect(0, 0, w, h, 6)
        .fill({ color: 0x111122, alpha: 0.95 })
        .stroke({ color: 0x4a4a8a, width: 1 });
    });
    this.tipBg.graphics.visible = true;
    this.tipTimer = 2600;
  }

  update(dt: number): void {
    if (this.input.isJustPressed("auto")) {
      this.auto = !this.auto;
      this.onAutoToggle?.(this.auto);
      this.autoLabel.setText(this.autoText());
    }

    // Bottom-centre meter: fast-forward glyph while J held; skip ring while X held.
    const ff = this.input.isPressed("attack");
    const skipHeld = this.input.isPressed("skip");
    const skipT = clamp(this.input.getHoldDuration("skip") / SKIP_HOLD_MS, 0, 1);
    this.meter.graphics.clear(); // redrawn every frame — don't accumulate
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

    if (this.tipTimer > 0) {
      this.tipTimer -= dt;
      if (this.tipTimer <= 0) {
        this.tipBg.graphics.visible = false;
        this.tipText.text.visible = false;
      }
    }
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

// ── Inspector probe (keeps the example harness-clean for the e2e smoke test) ──

class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";
  lastTerm = "";

  onLine(text: string): void {
    this.lastLine = text;
    this.lineCount++;
  }
  onChoice(text: string): void {
    this.lastChoice = text;
  }
  onTerm(id: string): void {
    this.lastTerm = id;
  }

  serialize(): {
    lastLine: string;
    lineCount: number;
    lastChoice: string;
    lastTerm: string;
  } {
    return {
      lastLine: this.lastLine,
      lineCount: this.lineCount,
      lastChoice: this.lastChoice,
      lastTerm: this.lastTerm,
    };
  }
}

// ── scene ────────────────────────────────────────────────────────────────────

class RoomScene extends Scene {
  readonly name = "dialogue-addon";
  readonly layers = LAYERS;

  onEnter(): void {
    const cam = this.spawn(CameraEntity, {
      position: new Vec2(WIDTH / 2, HEIGHT / 2),
    });
    this.context.resolve(InputManagerKey).setCamera(cam);
    this.drawRoom();

    // Player.
    const player = this.spawn("player");
    player.add(new Transform({ position: new Vec2(WIDTH / 2, 300) }));
    player.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.circle(0, 0, 13).fill({ color: 0x6be08a });
        g.circle(0, 0, 13).stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
      }),
    );
    player.add(new DialogueActor({ speaker: "you", anchor: { x: 0, y: -20 } }));
    const playerPos = (): Vec2 => player.get(Transform).position;

    // Interactive controller (box + bubble), shared by Mira and Sage.
    const theme = defaultTheme();
    const bundle = createMixedDialogue(theme, { worldLayer: BUBBLE_LAYER });
    const host = this.spawn("dialogue-host");
    const probe = host.add(new DialogueProbe());
    const hud = host.add(new Hud());
    const interactive = host.add(
      new DialogueController({
        ...bundle,
        input: fullControls(bundle.choices, { skipHoldMs: SKIP_HOLD_MS }),
        onTermActivate: (e) => {
          probe.onTerm(e.id);
          hud.showTerm(e);
        },
      }),
    );
    hud.onAutoToggle = (on) =>
      interactive.setAutoAdvance(on ? AUTO_ADVANCE_MS : null);
    host.on(DialogueLineEvent, (e) => probe.onLine(e.text));
    host.on(DialogueChoiceMadeEvent, (e) => probe.onChoice(e.text));

    const busy = (): boolean => interactive.isActive();
    player.add(new PlayerMover(busy));

    // Ambient controller (bubble, no input) for the eavesdropped gossip.
    const ambient = this.spawn("ambient-host").add(
      new DialogueController({
        ...createBubbleDialogue(theme, { worldLayer: BUBBLE_LAYER }),
        input: new CompositeInputBinding([]),
      }),
    );

    // Interactable NPCs.
    const mira = spawnNpc(this, { x: 230, y: 200, color: 0xffd866 });
    mira.add(
      new ProximityInteract({
        label: "Talk to Mira (F)",
        radius: 46,
        isBusy: busy,
        playerPos,
        onInteract: () => interactive.play(MIRA),
      }),
    );
    const sage = spawnNpc(this, { x: 570, y: 230, color: 0x7ec8ff, speaker: "sage" });
    sage.add(
      new ProximityInteract({
        label: "Talk to Sage (F)",
        radius: 46,
        isBusy: busy,
        playerPos,
        onInteract: () => interactive.play(SAGE),
      }),
    );

    // Eavesdrop pair: Ann & Bert chat on their own when you get close. Placed
    // with headroom above so their bubbles stay inside the room.
    spawnNpc(this, { x: 360, y: 205, color: 0xf5a168, speaker: "ann" });
    spawnNpc(this, { x: 430, y: 205, color: 0xaaaaaa, speaker: "bert" });
    const zone = this.spawn("gossip-zone");
    zone.add(new Transform({ position: new Vec2(395, 215) }));
    zone.add(
      new ProximityZone({
        radius: 110,
        playerPos,
        onEnter: () => ambient.play(GOSSIP),
        onExit: () => ambient.stop(),
      }),
    );
  }

  onExit(): void {
    this.context.resolve(InputManagerKey).clearCamera();
  }

  private drawRoom(): void {
    const floor = this.spawn("room");
    floor.add(new Transform());
    floor.add(
      new GraphicsComponent({ layer: ROOM_LAYER }).draw((g) => {
        g.roundRect(24, 70, WIDTH - 48, 320, 12)
          .fill({ color: 0x16181f })
          .stroke({ color: 0x33384a, width: 2 });
        for (let x = 24; x <= WIDTH - 24; x += 48) {
          g.moveTo(x, 70).lineTo(x, 390);
        }
        for (let y = 70; y <= 390; y += 48) {
          g.moveTo(24, y).lineTo(WIDTH - 24, y);
        }
        g.stroke({ color: 0x222634, width: 1, alpha: 0.6 });
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
      },
      preventDefaultKeys: [
        "Space",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ],
    }),
  );

  await engine.start();
  await engine.scenes.push(new RoomScene());
}

main().catch(console.error);

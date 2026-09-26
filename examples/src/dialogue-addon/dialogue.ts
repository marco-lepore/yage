import {
  Component,
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  type ProcessSlot,
} from "@yagejs/core";
import {
  GraphicsComponent,
  type CameraEntity,
  type TextComponent,
} from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import { AudioManagerKey } from "@yagejs/audio";
import {
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueEndedEvent,
  DialogueRevealMarkerEvent,
  cells,
  compose,
  dialogueControls,
  splitGraphemes,
  MemoryVariableStorage,
  type DialogueScript,
} from "@yagejs-addons/dialogue";
import {
  createMixedDialogue,
  createBubbleDialogue,
  InBoxAvatarPresenter,
  BubbleAvatarPresenter,
  DIALOGUE_LAYER_AVATAR,
  type BubbleDialogueOptions,
  type DialogueTheme,
} from "@yagejs-addons/dialogue/presenters";
import {
  WIDTH,
  HEIGHT,
  HUD_LAYER,
  BUBBLE_LAYER,
  SKIP_HOLD,
  AUTO_ADVANCE,
  PLAYER_KEY,
  TownPaused,
} from "./constants.js";
import { BlipSynth, TranscriptChannel, createSageVoice } from "./channels.js";
import { spawnHudText, type Purse } from "./hud.js";
import type { Gate, PlayerEntity } from "./town.js";

/** Bubble settings both conversations share. A bitmap font gets a wider
 *  bubble, and a textured bubble gets extra padding so its text clears the
 *  nine-slice border. */
function bubbleOptions(
  theme: DialogueTheme,
): Pick<BubbleDialogueOptions, "worldLayer" | "bubble"> {
  return {
    worldLayer: BUBBLE_LAYER,
    bubble: {
      ...(theme.bitmapFont !== undefined ? { maxWidth: 320 } : {}),
      ...(theme.textured?.["default"]?.bubble !== undefined
        ? { padding: 12 }
        : {}),
    },
  };
}

// ── components on the dialogue host ──────────────────────────────────────────

/** What the conversation showed last, for e2e tests and the Inspector
 *  (`inspector.getComponentData(id, "DialogueProbe")`). */
export class DialogueProbe extends Component {
  lastLine = "";
  lineCount = 0;
  lastChoice = "";

  onAdd(): void {
    this.listen(this.entity, DialogueLineEvent, ({ text }) => {
      this.lastLine = text;
      this.lineCount++;
    });
    this.listen(this.entity, DialogueChoiceMadeEvent, ({ text }) => {
      this.lastChoice = text;
    });
  }
}

/**
 * Sound and camera cues timed by the typewriter. The controller calls
 * {@link tick} for every revealed grapheme (its `onRevealTick` option, a
 * callback rather than an event because it fires hundreds of times a line).
 * Inline `[name k=v/]` markers arrive as `DialogueRevealMarkerEvent`. The addon
 * gives no marker a meaning, so this component does: Mira's `[sfx=chime/]` and
 * `[sfx=page/]` play a tone and her `[screenShake/]` shakes the camera. (The
 * name avoids the `[shake]…[/shake]` text effect.)
 */
export class RevealEffects extends Component {
  private readonly blip = new BlipSynth();
  /** The current line in graphemes: the same indexing `tick` receives. */
  private graphemes: readonly string[] = [];

  constructor(private readonly camera: CameraEntity) {
    super();
  }

  onAdd(): void {
    // The event carries the line's plain text (markup stripped), which splits
    // into the graphemes the reveal counts.
    this.listen(this.entity, DialogueLineEvent, ({ text }) => {
      this.graphemes = splitGraphemes(text);
    });
    // Marker names arrive lower-cased (`[screenShake/]` → "screenshake"). A
    // skip drains the line's remaining markers with `viaSkip` set; those are
    // dropped so a fast-forward doesn't fire a burst of cues.
    this.listen(
      this.entity,
      DialogueRevealMarkerEvent,
      ({ marker, viaSkip }) => {
        if (viaSkip) return;
        if (marker.name === "screenshake") this.camera.shake(7, 0.32);
        else if (marker.name === "sfx")
          this.blip.cue(marker.props["sfx"] ?? "");
      },
    );
  }

  onDestroy(): void {
    this.blip.close();
  }

  /** A click per revealed glyph. `index` counts whitespace too; spaces stay
   *  silent. */
  tick(index: number): void {
    const g = this.graphemes[index];
    if (g !== undefined && g.trim() !== "") this.blip.tick();
  }
}

/**
 * Rook's timed choice. Timed choices aren't an addon feature; this component
 * is the recipe. The script's `choice-timer` command passes a time limit and a
 * default option to {@link arm}; the countdown starts when the next menu
 * appears and commits the default with `controller.choose` when it runs out.
 *
 * - Every `DialogueChoiceShownEvent` cancels the running countdown before it
 *   starts a new one, and a choice or the end of the conversation cancels it.
 *   Otherwise a countdown started for one menu could pick an option in a
 *   later one.
 * - `setPaused` freezes the conversation but not this component's process
 *   slot, so the slot pauses itself on `TownPaused`.
 */
export class ChoiceTimer extends Component {
  private readonly controller = this.sibling(DialogueController);
  private readonly processes = this.sibling(ProcessComponent);
  private countdown!: ProcessSlot;
  /** Armed by the command, waiting for its menu. */
  private pending: { seconds: number; option: number } | undefined;
  private seconds = 0;
  private option = 0;

  constructor(private readonly label: TextComponent) {
    super();
  }

  onAdd(): void {
    this.countdown = this.processes.slot({
      update: () => this.refresh(),
      onComplete: () => {
        this.label.visible = false;
        this.controller.choose(this.option);
      },
    });
    this.listen(this.entity, DialogueChoiceShownEvent, () => this.onShown());
    this.listen(this.entity, DialogueChoiceMadeEvent, () => this.cancel());
    this.listen(this.entity, DialogueEndedEvent, () => this.cancel());
    this.listen(this.entity, TownPaused, ({ paused }) => {
      if (paused) this.countdown.pause();
      else this.countdown.resume();
    });
  }

  /** Called by the `choice-timer` command: time the next menu. */
  arm(seconds: number, option: number): void {
    this.pending = { seconds, option };
  }

  private onShown(): void {
    this.countdown.cancel();
    if (this.pending) {
      this.seconds = this.pending.seconds;
      this.option = this.pending.option;
      this.pending = undefined;
      this.countdown.start({ duration: this.seconds });
    }
    this.refresh();
  }

  private cancel(): void {
    this.countdown.cancel();
    this.pending = undefined;
    this.label.visible = false;
  }

  private refresh(): void {
    if (this.countdown.completed) {
      this.label.visible = false;
      return;
    }
    const left = this.seconds - this.countdown.elapsed;
    this.label.setText(`⏳ ${Math.ceil(left)}s`);
    this.label.visible = true;
  }
}

/** The HUD pieces {@link DialogueToggles} shows its state on. */
export interface ToggleView {
  readonly autoLabel: TextComponent;
  readonly dim: GraphicsComponent;
  readonly banner: TextComponent;
}

/**
 * V, P and H act on the conversations:
 *
 * - **V → `setAutoAdvance`** on the player's conversation: each line moves on
 *   by itself `AUTO_ADVANCE` seconds after it finishes revealing.
 * - **P → `setPaused`** on every conversation: the typewriter, auto-advance,
 *   caret and input freeze behind a dim overlay, with no state lost, and pick
 *   up where they left off on the next press. The host emits `TownPaused`,
 *   and the player stands still while paused.
 * - **H → `setHidden`** on every conversation: the dialogue UI disappears
 *   mid-line and comes back at the same reveal point. It only toggles while a
 *   conversation runs, so an idle press can't leave a later line hidden.
 *
 * Pause and hide last across conversations until pressed again. A third
 * control, `setInputEnabled`, switches a live input binding on and off; the
 * gossip doesn't need it because it has no binding at all (`input: null`).
 */
export class DialogueToggles extends Component {
  private readonly input = this.service(InputManagerKey);
  private readonly controller = this.sibling(DialogueController);
  private auto = false;
  private _paused = false;
  private hidden = false;

  constructor(private readonly view: ToggleView) {
    super();
  }

  get paused(): boolean {
    return this._paused;
  }

  update(): void {
    if (this.input.isJustPressed("auto")) {
      this.auto = !this.auto;
      this.controller.setAutoAdvance(this.auto ? AUTO_ADVANCE : null);
      this.view.autoLabel.setText(autoText(this.auto));
    }
    if (this.input.isJustPressed("pause")) {
      this._paused = !this._paused;
      for (const c of this.conversations()) c.setPaused(this._paused);
      this.view.dim.visible = this._paused;
      this.view.banner.visible = this._paused;
      this.entity.emit(TownPaused, { paused: this._paused });
    }
    if (this.input.isJustPressed("hide")) {
      const conversations = this.conversations();
      if (conversations.some((c) => c.isActive())) {
        this.hidden = !this.hidden;
        for (const c of conversations) c.setHidden(this.hidden);
      }
    }
  }

  /** Every conversation in the scene: the player's and the gossip. */
  private conversations(): DialogueController[] {
    return this.scene
      .findEntities({ filter: (e) => e.has(DialogueController) })
      .map((e) => e.get(DialogueController));
  }
}

function autoText(on: boolean): string {
  return on ? "AUTO ▶ ON" : "AUTO ❙❙ OFF";
}

// ── the player's conversations ───────────────────────────────────────────────

export interface DialogueHostParams {
  readonly theme: DialogueTheme;
  readonly camera: CameraEntity;
  readonly purse: Purse;
  readonly gate: Gate;
}

/**
 * The player's conversations. One `DialogueController` serves every NPC: the
 * storage, functions and commands are installed here once, and an NPC's
 * `play(script)` brings only content.
 *
 * - **storage**: `gold` is a two-way cell into the {@link Purse}, so a script
 *   reads it and spends it (`set gold = gold - 50`). Declared flags and
 *   counters (`paid`, `opened`, `timesTalked`) live in the memory store and
 *   persist across conversations.
 * - **functions**: `has_item("rusty-key")`, a read that takes an argument, for
 *   conditions.
 * - **commands**: the game decides what `give-gold`, `give-item`, `take-item`,
 *   `open-gate` and `choice-timer` do.
 *
 * Spawn it with `{ key: DIALOGUE_KEY }`; NPCs and the player find it with
 * `scene.findByKey`.
 */
export class DialogueHostEntity extends Entity {
  controller!: DialogueController;
  toggles!: DialogueToggles;

  /** True while the player stands still: a conversation owns the input, or P
   *  paused the town. Overhearing the gossip doesn't count. */
  get busy(): boolean {
    return this.controller.isActive() || this.toggles.paused;
  }

  setup({ theme, camera, purse, gate }: DialogueHostParams): void {
    this.add(new ProcessComponent());
    this.add(new DialogueProbe());
    const effects = this.add(new RevealEffects(camera));

    const bundle = createMixedDialogue(theme, {
      ...bubbleOptions(theme),
      // Line-driven avatars, routed per line like the chrome, text and
      // choices: a portrait inside the box that the text reflows around (the
      // Captain, Pip), and one beside the bubble (Sage).
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
    this.controller = this.add(
      new DialogueController({
        ...bundle,
        storage: compose(
          cells({
            gold: {
              get: () => purse.gold,
              set: (v) => (purse.gold = Number(v)),
            },
          }),
          new MemoryVariableStorage(),
        ),
        functions: { has_item: (id) => purse.has(String(id)) },
        commands: {
          "give-gold": (cmd) => {
            purse.gold += Number(cmd.amount);
          },
          "give-item": (cmd) => purse.give(String(cmd.id)),
          "take-item": (cmd) => purse.take(String(cmd.id)),
          "open-gate": () => gate.open(),
          "choice-timer": (cmd) =>
            this.get(ChoiceTimer).arm(Number(cmd.seconds), Number(cmd.default)),
        },
        input: dialogueControls(bundle.choices, { skipHold: SKIP_HOLD }),
        // Two extra channels beside the presenters (see channels.ts).
        channels: [
          createSageVoice(this.scene.use(AudioManagerKey)),
          new TranscriptChannel(),
        ],
        onRevealTick: (index) => effects.tick(index),
      }),
    );

    // Spawned after the controller, so the dim overlay covers the transcript
    // panel it mounts, and the banner sits above the overlay.
    const autoLabel = spawnHudText(this, "auto", {
      x: WIDTH - 12,
      y: 12,
      text: autoText(false),
      size: 13,
      fill: 0x8888aa,
      anchor: { x: 1, y: 0 },
    });
    const timerLabel = spawnHudText(this, "timer", {
      x: WIDTH / 2,
      y: 70,
      text: "",
      size: 20,
      fill: 0xff6b6b,
      anchor: { x: 0.5, y: 0.5 },
      visible: false,
    });
    const dim = this.spawnChild("dim");
    dim.add(new Transform());
    const dimGraphics = dim.add(
      new GraphicsComponent({ layer: HUD_LAYER, visible: false }).draw((g) => {
        g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x05060a, alpha: 0.55 });
      }),
    );
    const banner = spawnHudText(this, "paused", {
      x: WIDTH / 2,
      y: HEIGHT / 2,
      text: "❙❙ PAUSED",
      size: 34,
      fill: 0xffe08a,
      anchor: { x: 0.5, y: 0.5 },
      visible: false,
    });

    this.add(new ChoiceTimer(timerLabel));
    this.toggles = this.add(
      new DialogueToggles({ autoLabel, dim: dimGraphics, banner }),
    );
  }
}

// ── the gossip you overhear ──────────────────────────────────────────────────

/** Plays a script while the player is within `radius`, and stops it when the
 *  player walks away. */
export class Eavesdrop extends Component {
  private readonly controller = this.sibling(DialogueController);
  private readonly transform = this.sibling(Transform);
  private inside = false;

  constructor(
    private readonly radius: number,
    private readonly script: DialogueScript,
  ) {
    super();
  }

  update(): void {
    const player = this.scene.findByKey<PlayerEntity>(PLAYER_KEY);
    if (!player) return;
    const near =
      this.transform.position.distance(player.get(Transform).position) <=
      this.radius;
    if (near && !this.inside) {
      this.inside = true;
      this.controller.play(this.script);
    } else if (!near && this.inside) {
      this.inside = false;
      this.controller.stop();
    }
  }
}

/**
 * Ann and Bert's gossip loop, overheard near their bench. A second
 * `DialogueController` with `input: null` has no input binding at all: the
 * gossip runs and auto-advances while the player's own conversation keeps the
 * keys. Two conversations run; only one listens to the player.
 */
export class GossipEntity extends Entity {
  setup(params: {
    theme: DialogueTheme;
    script: DialogueScript;
    x: number;
    y: number;
    radius: number;
  }): void {
    const { theme, script, x, y, radius } = params;
    this.add(new Transform({ position: new Vec2(x, y) }));
    this.add(
      new DialogueController({
        ...createBubbleDialogue(theme, bubbleOptions(theme)),
        input: null,
      }),
    );
    this.add(new Eavesdrop(radius, script));
  }
}

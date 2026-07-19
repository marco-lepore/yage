import { Scene, Transform, Vec2 } from "@yagejs/core";
import { CameraEntity, GraphicsComponent, TextComponent } from "@yagejs/renderer";
import { InputManagerKey } from "@yagejs/input";
import { AudioManagerKey } from "@yagejs/audio";
import {
  createVoiceChannel,
  DialogueController,
  DialogueLineEvent,
  DialogueChoiceMadeEvent,
  DialogueRevealMarkerEvent,
  cells,
  compose,
  dialogueControls,
  splitGraphemes,
  MemoryVariableStorage,
  type CommandHandler,
  type DialogueFunction,
  type DialogueScript,
  type VariableStorage,
} from "@yagejs-addons/dialogue";
import {
  defaultDialogueTheme,
  createMixedDialogue,
  createBubbleDialogue,
  DialogueActor,
  InBoxAvatarPresenter,
  BubbleAvatarPresenter,
  DIALOGUE_LAYER_AVATAR,
  type DialogueTheme,
} from "@yagejs-addons/dialogue/presenters";
import {
  WIDTH,
  HEIGHT,
  WORLD_WIDTH,
  SKIP_HOLD,
  AUTO_ADVANCE,
  GATE_X,
  ROOM_LAYER,
  BUBBLE_LAYER,
  LAYERS,
  type Bounds,
  type GameState,
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
import { PlayerMover, ProximityInteract, ProximityZone, Gate, spawnNpc } from "./town.js";
import { Hud, DialogueProbe, LifecycleControls, ChoiceTimer } from "./hud.js";
import { VOICE, BlipSynth, TranscriptChannel } from "./channels.js";
import { registerPortraitTextures } from "./theme.js";

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

  onEnter(): void {
    this.drawTown();

    // Register the portraits under their `meta.portrait` keys (the renderer's
    // Assets is up by now), so the avatars resolve them synchronously — a host
    // preloads avatar art the same way.
    registerPortraitTextures();

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
      "choice-timer": (cmd) => choiceTimer?.arm(Number(cmd.seconds), Number(cmd.default)),
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
        input: dialogueControls(bundle.choices, { skipHold: SKIP_HOLD }),
        channels: [voice, transcript],
        // A typewriter click per revealed glyph — `index` is a raw grapheme index
        // (whitespace included), so we look it up and skip spaces.
        onRevealTick: (index) => {
          const g = lineGraphemes[index];
          if (g !== undefined && g.trim() !== "") blip.tick();
        },
      }),
    );
    hud.onAutoToggle = (on) => interactive.setAutoAdvance(on ? AUTO_ADVANCE : null);
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

    // Ambient controller (bubble) for the eavesdropped gossip. `input: null`
    // attaches no device binding at all: the gossip stays alive and
    // auto-advances while the interactive conversation keeps the input —
    // two conversations run, only one listens to the player.
    const ambientBundle = createBubbleDialogue(theme, bubbleOpts);
    const ambient = this.spawn("ambient-host").add(
      new DialogueController({ ...ambientBundle, input: null }),
    );

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
